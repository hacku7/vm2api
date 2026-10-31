import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { clearKernelRestartPending, listVms, markKernelRestartPending } from '../../src/lib/vm/vm-registry.mjs'

test('listVms carries kernel_restart_pending so wrap-cli sync retries and then clears it', () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'kin-pending-'))
  try {
    fs.mkdirSync(path.join(project, 'vms'))
    fs.writeFileSync(path.join(project, 'vms', 'slot-a.json'), JSON.stringify({ id: 'slot-a', name: 'slot-a' }))
    assert.equal(listVms(project)[0].kernel_restart_pending, null)
    markKernelRestartPending(project, 'slot-a', 'legacy_telemetry_stop_failed')
    assert.equal(listVms(project)[0].kernel_restart_pending, 'legacy_telemetry_stop_failed')
    clearKernelRestartPending(project, 'slot-a')
    assert.equal(listVms(project)[0].kernel_restart_pending, null)
  } finally {
    fs.rmSync(project, { recursive: true, force: true })
  }
})
