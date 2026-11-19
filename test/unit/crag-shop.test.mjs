import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { applyMigrations } from '../../src/lib/db/database.mjs'
import { sameOriginPost } from '../../src/lib/http/same-origin.mjs'
import { startGateway } from '../harness.mjs'

const PANEL = 'https://panel.example.test'
const BASE = '/api/panel/crag-shop'
const MIGRATIONS = new URL('../../src/lib/db/migrations/', import.meta.url)
const COMMERCE_MIGRATION = new URL('057_crag_shop_commerce.sql', MIGRATIONS)
const ACTIVATION_MIGRATION = new URL('058_crag_shop_activation.sql', MIGRATIONS)

test('shop migration numbering preserves applied schemas and orders from either parent', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crag-shop-migrations-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))

  for (const legacy of [true, false]) {
    const migrationsDir = path.join(root, legacy ? 'local' : 'upstream')
    fs.mkdirSync(migrationsDir)
    for (const name of fs.readdirSync(MIGRATIONS)) {
      if (name >= '057_' || (legacy && name === '055_account_lifetime_usage.sql')) continue
      const dest = legacy && name === '056_crag_shop_orders.sql' ? '055_crag_shop_orders.sql' : name
      fs.copyFileSync(new URL(name, MIGRATIONS), path.join(migrationsDir, dest))
    }
    if (legacy) {
      fs.copyFileSync(COMMERCE_MIGRATION, path.join(migrationsDir, '056_crag_shop_commerce.sql'))
      fs.copyFileSync(ACTIVATION_MIGRATION, path.join(migrationsDir, '057_crag_shop_activation.sql'))
    }

    const db = new DatabaseSync(':memory:')
    t.after(() => db.close())
    applyMigrations(db, { migrationsDir })
    db.prepare(`INSERT INTO crag_shop_orders (order_id, owner, request_id, sku, payment_method, reserved_at)
      VALUES ('fixture-order', ?, 'fixture-request', 'quarter', 'alipay', 1)`).run('panel:alice-id')
    if (legacy) {
      db.prepare(`UPDATE crag_shop_orders SET activation_vm_id = 'vm-ready', activation_fingerprint = ?,
        activation_phase = 'redeemed', activation_attempts = 2`).run('a'.repeat(64))
    }

    applyMigrations(db)
    assert.deepEqual(applyMigrations(db), [])
    assert.deepEqual(
      db
        .prepare("SELECT name FROM schema_migrations WHERE version BETWEEN '055' AND '058' ORDER BY version")
        .all()
        .map((r) => r.name),
      [
        '055_account_lifetime_usage.sql',
        '056_crag_shop_orders.sql',
        '057_crag_shop_commerce.sql',
        '058_crag_shop_activation.sql',
      ],
    )
    const saved = db.prepare("SELECT * FROM crag_shop_orders WHERE order_id = 'fixture-order'").get()
    assert.equal(saved.owner, 'panel:alice-id')
    assert.equal(saved.activation_vm_id, legacy ? 'vm-ready' : null)
    assert.equal(saved.activation_phase, legacy ? 'redeemed' : 'waiting')
    assert.equal(saved.activation_attempts, legacy ? 2 : 0)
    assert.equal(saved.dispatch_state, 'submitted')
  }
})

test('mutations reject cross-origin and forwarded-header authority', () => {
  const req = (headers) => ({ headers: { host: 'panel.example.test', ...headers } })
  assert.equal(sameOriginPost(req({ origin: PANEL, 'sec-fetch-site': 'same-origin' })), true)
  assert.equal(sameOriginPost(req({ origin: PANEL }), PANEL), false)
  assert.equal(
    sameOriginPost(req({ origin: PANEL, host: 'private.proxy', 'sec-fetch-site': 'same-origin' }), PANEL),
    true,
  )
  assert.equal(sameOriginPost({ ...req({ origin: PANEL }), socket: { encrypted: true } }, PANEL), true)
  assert.equal(sameOriginPost(req({ origin: 'http://panel.example.test' })), true)
  assert.equal(sameOriginPost(req({ origin: PANEL, 'sec-fetch-site': 'cross-site' }), PANEL), false)
  assert.equal(sameOriginPost(req({ origin: 'null', 'sec-fetch-site': 'same-origin' }), PANEL), false)
  assert.equal(
    sameOriginPost(
      req({
        origin: 'https://evil.example.test',
        'x-forwarded-host': 'evil.example.test',
        'x-forwarded-proto': 'https',
        'sec-fetch-site': 'same-origin',
      }),
    ),
    false,
  )
  assert.equal(sameOriginPost(req({})), false)
})


test('shop namespace is not found before authentication or OPTIONS dispatch', async (t) => {
  const gw = await startGateway()
  t.after(async () => {
    await gw.stop()
    fs.rmSync(gw.project, { recursive: true, force: true })
  })
  for (const headers of [{}, { authorization: 'Bearer invalid' }, { authorization: `Bearer ${gw.apiKey}` }]) {
    for (const [method, suffix] of [
      ['GET', ''], ['GET', '/plans'], ['GET', '/device/plans'], ['GET', '/activation-targets'],
      ['POST', '/quote'], ['POST', '/orders'], ['POST', '/device/orders/x/apply'],
      ['GET', '/orders/x'], ['POST', '/orders/x/claim'], ['POST', '/orders/x/apply-renewal'],
      ['HEAD', '/unknown'], ['OPTIONS', '/device/orders?probe=1'],
    ]) {
      const res = await fetch(`${gw.baseUrl}${BASE}${suffix}`, { method, headers })
      assert.equal(res.status, 404, `${method} ${BASE}${suffix}`)
      assert.equal(res.headers.get('cache-control'), 'no-store')
      await res.arrayBuffer()
    }
  }
  const status = `${gw.baseUrl}/api/panel/crag-subscription`
  assert.equal((await fetch(status)).status, 401)
  assert.equal((await fetch(status, { headers: { authorization: `Bearer ${gw.apiKey}` } })).status, 403)
  assert.equal((await fetch(status, { method: 'OPTIONS' })).status, 204)
})
