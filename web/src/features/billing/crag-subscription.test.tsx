import type {
  ButtonHTMLAttributes,
  ComponentProps,
  ElementType,
  FormHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
} from 'react'
import type * as JsxDevRuntime from 'react/jsx-dev-runtime'
import type * as JsxRuntime from 'react/jsx-runtime'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, api } from '@/lib/api'
import type { CragHostStatus } from '@/features/vm/queries'
import { CragSubscriptionPage } from './crag-subscription'

type ConfirmProps = ComponentProps<
  typeof import('@/components/confirm-dialog').ConfirmDialog
>

const state = vi.hoisted(() => ({
  values: [] as unknown[],
  refs: [] as Array<{ current: unknown }>,
  cursor: 0,
  refCursor: 0,
  role: 'admin',
  user: 'alice',
  authenticated: true,
  hostStatus: undefined as CragHostStatus | undefined,
  hostRefetch: vi.fn(),
  upgradeConfirm: undefined as ConfirmProps | undefined,
  setQueryData: vi.fn(),
  invalidateQueries: vi.fn(),
  hostForm: undefined as FormHTMLAttributes<HTMLFormElement> | undefined,
  hostInput: undefined as InputHTMLAttributes<HTMLInputElement> | undefined,
  buttons: [] as ButtonHTMLAttributes<HTMLButtonElement>[],
}))

// Capture the host form handlers without a browser DOM.
function captureHostControls<Rest extends unknown[], Result>(
  jsx: (type: ElementType, props: unknown, ...rest: Rest) => Result
) {
  return (type: ElementType, props: unknown, ...rest: Rest) => {
    if (type === 'form') {
      const form = props as FormHTMLAttributes<HTMLFormElement>
      if (form['aria-label'] === '兑换订阅使用券') state.hostForm = form
    } else if (type === 'input') {
      const input = props as InputHTMLAttributes<HTMLInputElement>
      if (input['aria-describedby'] === 'crag-host-redeem-help')
        state.hostInput = input
    }
    return jsx(type, props, ...rest)
  }
}

vi.mock('react/jsx-runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof JsxRuntime>()
  return {
    ...actual,
    jsx: captureHostControls(actual.jsx),
    jsxs: captureHostControls(actual.jsxs),
  }
})
vi.mock('react/jsx-dev-runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof JsxDevRuntime>()
  return { ...actual, jsxDEV: captureHostControls(actual.jsxDEV) }
})

vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useState: (initial: unknown) => {
    const index = state.cursor++
    if (index >= state.values.length) state.values[index] = initial
    return [
      state.values[index],
      (next: unknown) => {
        state.values[index] =
          typeof next === 'function' ? next(state.values[index]) : next
      },
    ]
  },
  useRef: (initial: unknown) => {
    const index = state.refCursor++
    state.refs[index] ??= { current: initial }
    return state.refs[index]
  },
}))
vi.mock('@tanstack/react-query', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-query')>()),
  useQueryClient: () => ({
    setQueryData: state.setQueryData,
    invalidateQueries: state.invalidateQueries,
  }),
  useQuery: (options: { queryKey: readonly unknown[] }) => {
    if (options.queryKey.includes('me'))
      return {
        data: state.authenticated
          ? { user: state.user, role: state.role }
          : undefined,
        isError: !state.authenticated,
      }
    if (options.queryKey[0] === 'crag-host-subscription')
      return { data: state.hostStatus, refetch: state.hostRefetch }
    throw new Error('Unexpected query: ' + JSON.stringify(options.queryKey))
  },
}))
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
}))
vi.mock('@/components/page-header', () => ({
  PageHeader: ({
    title,
    description,
    children,
    extra,
  }: {
    title: string
    description: string
    children: ReactNode
    extra?: ReactNode
  }) => (
    <main>
      <h1>{title}</h1>
      <p>{description}</p>
      {extra}
      {children}
    </main>
  ),
}))
vi.mock('@/components/confirm-dialog', () => ({
  ConfirmDialog: (props: ConfirmProps) => {
    if (props.title === '启用本机槽位回收？') state.upgradeConfirm = props
    return null
  },
}))
vi.mock('@/components/ui/button', () => ({
  Button: (props: ButtonHTMLAttributes<HTMLButtonElement>) => {
    state.buttons.push(props)
    return <button disabled={props.disabled}>{props.children}</button>
  },
}))
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  api: vi.fn(),
}))

function render() {
  state.cursor = 0
  state.refCursor = 0
  state.buttons = []
  state.hostForm = undefined
  state.hostInput = undefined
  state.upgradeConfirm = undefined
  return renderToStaticMarkup(<CragSubscriptionPage />)
}

function click(label: string) {
  const button = state.buttons.find((button) => button.children === label)
  expect(button).toBeDefined()
  button?.onClick?.({} as never)
}

function fillHostCode(value: string) {
  expect(state.hostInput).toBeDefined()
  state.hostInput?.onChange?.({ target: { value } } as never)
  return render()
}

function submitHostCode() {
  expect(state.hostForm).toBeDefined()
  state.hostForm?.onSubmit?.({ preventDefault: vi.fn() } as never)
}

async function settle() {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

beforeEach(() => {
  state.role = 'admin'
  state.user = 'alice'
  state.authenticated = true
  state.refs = []
  state.hostStatus = undefined
  state.hostRefetch.mockReset()
  state.hostRefetch.mockResolvedValue(undefined)
  state.setQueryData.mockReset()
  state.setQueryData.mockImplementation((_key, data: CragHostStatus) => {
    state.hostStatus = data
  })
  state.invalidateQueries.mockReset()
  state.values = []
  vi.mocked(api).mockReset()
})

describe('CRAG host license management', () => {
  it('shows the entitlement expiry and refreshes it on demand', () => {
    state.hostStatus = { state: 'active', ready: true, expires_at: 1_900_000_000 }
    const html = render()
    expect(html).toContain(new Date(1_900_000_000_000).toISOString())
    expect(html).toContain('兑换到本机')
    expect(html).not.toMatch(/订单|结账|支付/)
    click('刷新本机订阅')
    expect(state.hostRefetch).toHaveBeenCalledTimes(1)
  })

  it('shows the slot probe failure without hiding the signed entitlement', () => {
    for (const [status, label] of [
      ['active', '订阅有效'],
      ['expired', '已到期'],
    ] as const) {
      state.hostStatus = {
        state: status,
        ready: false,
        target_probe_failed: true,
      }
      const html = render()
      expect(html).toContain(label)
      expect(html).toContain('探测失败')
      expect(html).toContain('刷新本机订阅」重试探测')
      expect(html).not.toContain('当前没有可绑定的 CRAG 槽位')
    }
  })

  it('shows only the shared remaining capacity, not separate per-license counts', () => {
    state.hostStatus = {
      state: 'active',
      ready: false,
      // state=active 意味着有 claims，真实 API 必带 slot_limit
      // （crag-subscription.mjs 的 `...(claims && { slot_limit })`）。
      slot_limit: 2,
      available_seats: 1,
      activated_slots: [
        { vm_id: 'vm-licensed', scope: 'device', expires_at: 1_900_000_000 },
      ],
    }
    const html = render()
    // 这份响应只有绑定数据、没有运行态，所以「使用中」诚实地显示待核对 ——
    // 真值只认真正运行中的 CRAG 内核，不从绑定数反推。
    expect(html).toMatch(/使用中的槽位<\/dt><dd[^>]*>待核对/)
    expect(html).toMatch(/订阅槽位额度<\/dt><dd[^>]*>2/)
    expect(html).toContain('原始状态数据（JSON）')
    expect(html).toContain('vm-licensed')
    expect(html).not.toContain('已绑定 / 可绑定应用锁')
  })

  it('redeems a trimmed host code without a ready slot', async () => {
    state.hostStatus = { state: 'unredeemed', ready: false }
    const active: CragHostStatus = {
      state: 'active',
      ready: false,
      slot_limit: 2,
      used_slots: 0,
      available_slots: 2,
      available_seats: 2,
    }
    vi.mocked(api).mockResolvedValueOnce(active)

    const html = render()
    expect(html).toContain('切换 VM 内核到 CRAG 不受额度限制')
    expect(html).toContain('订阅使用券')
    expect(html).toContain(
      '每张码从兑换时独立计时，未到期额度相加；不绑定、不启动 VM。'
    )
    expect(state.hostInput?.type).toBe('password')
    fillHostCode('   ')
    expect(
      state.buttons.find((button) => button.children === '兑换到本机')?.disabled
    ).toBe(true)
    submitHostCode()
    expect(api).not.toHaveBeenCalled()

    const code = `CRAGR1.${'a'.repeat(43)}`
    fillHostCode(` ${code} `)
    expect(
      state.buttons.find((button) => button.children === '兑换到本机')?.disabled
    ).toBe(false)
    submitHostCode()
    submitHostCode()
    expect(api).toHaveBeenCalledExactlyOnceWith(
      '/api/panel/crag-subscription/redeem',
      { method: 'POST', body: JSON.stringify({ redemption_code: code }) }
    )
    expect(render()).toContain('正在兑换…')
    expect(state.hostInput?.disabled).toBe(true)

    await settle()
    const updated = render()
    expect(updated).toContain('订阅有效')
    expect(updated).toContain('订阅槽位额度已更新，未自动把 VM 切到 CRAG')
    expect(updated).toMatch(/使用中的槽位<\/dt><dd[^>]*>待核对/)
    expect(updated).toMatch(/订阅槽位额度<\/dt><dd[^>]*>2/)
    expect(updated).not.toContain(code)
    expect(state.hostInput?.value).toBe('')
    expect(state.setQueryData).toHaveBeenCalledExactlyOnceWith(
      ['crag-host-subscription'],
      active
    )
    expect(state.invalidateQueries).toHaveBeenCalledExactlyOnceWith({
      queryKey: ['crag-host-subscription'],
    })
  })

  it('keeps deleted H1 bindings pending until an explicit upgrade refresh confirms capacity', async () => {
    state.hostStatus = {
      state: 'active',
      ready: true,
      reclaim_supported: false,
      upgrade_available: true,
      slot_limit: 1,
      available_seats: 0,
      reclaim_pending_count: 1,
    }
    state.hostRefetch.mockImplementationOnce(async () => {
      state.hostStatus = {
        ...state.hostStatus!,
        reclaim_supported: true,
        upgrade_available: false,
        available_seats: 1,
        reclaim_pending_count: 0,
      }
    })
    const pending = render()
    // 回收流程的响应不带运行态，「使用中」显示待核对；本用例的主题是回收流程
    // 本身（下方断言覆盖），容量看订阅槽位额度。
    expect(pending).toMatch(/订阅槽位额度<\/dt><dd[^>]*>1/)
    // 待回收绑定不再作为数字展示（真值只认运行中，过期绑定本就不计入）。
    // 回收流程仍可用，由下方的说明与按钮断言覆盖。
    expect(pending).toContain('旧订阅的已删除绑定待启用槽位回收')
    expect(pending).not.toContain('继续同步')
    expect(api).not.toHaveBeenCalled()
    click('启用槽位回收')
    render()
    expect(state.upgradeConfirm?.open).toBe(true)
    state.upgradeConfirm?.handleConfirm?.()
    await settle()
    expect(api).toHaveBeenCalledExactlyOnceWith(
      '/api/panel/crag-subscription/upgrade',
      { method: 'POST', body: '{}' }
    )
    expect(state.hostRefetch).toHaveBeenCalledTimes(1)
    const updated = render()
    expect(updated).toMatch(/订阅槽位额度<\/dt><dd[^>]*>1/)
    expect(updated).not.toContain('待回收绑定')
    expect(updated).not.toContain('旧订阅的已删除绑定')
  })

  it('can recover confirmed deletion records on an active H2 subscription without redeeming again', async () => {
    state.hostStatus = {
      state: 'active',
      ready: true,
      reclaim_supported: true,
      slot_limit: 1,
      available_seats: 0,
      reclaim_pending_count: 1,
    }
    vi.mocked(api).mockResolvedValueOnce({
      ...state.hostStatus,
      available_seats: 1,
      reclaim_pending_count: 0,
    })
    expect(render()).toContain('继续同步')
    expect(state.hostInput).toBeDefined()
    click('继续同步')
    await settle()
    expect(api).toHaveBeenCalledExactlyOnceWith(
      '/api/panel/crag-subscription/recover',
      { method: 'POST', body: '{}' }
    )
    const updated = render()
    expect(updated).toMatch(/订阅槽位额度<\/dt><dd[^>]*>1/)
    expect(updated).not.toContain('待回收绑定')
    expect(updated).not.toContain('继续同步')
    expect(updated).toContain('订阅状态已同步')
    expect(state.invalidateQueries).toHaveBeenCalledExactlyOnceWith({
      queryKey: ['crag-host-subscription'],
    })
  })

  it('does not describe a successful H1 sync as reclaiming deleted bindings', async () => {
    state.hostStatus = {
      state: 'sync_pending',
      ready: true,
      reclaim_supported: false,
      reclaim_pending_count: 1,
    }
    vi.mocked(api).mockResolvedValueOnce({
      ...state.hostStatus,
      state: 'active',
      slot_limit: 1,
      available_seats: 0,
    })
    render()
    click('继续同步')
    await settle()
    const updated = render()
    expect(updated).toContain('仍有绑定待回收确认')
    expect(updated).toMatch(/订阅槽位额度<\/dt><dd[^>]*>1/)
    expect(updated).not.toContain('订阅状态已同步')
  })

  it.each([
    ['crag_subscription_invalid_request', '请输入有效的订阅使用券'],
    ['redeem_unavailable', '此码不可用于本机订阅或已失效'],
    ['host_redeem_conflict', '此码与当前宿主机或订阅不匹配'],
    [
      'crag_subscription_host_package_unready',
      '请先在内核页拉取可信 CRAG 发行包',
    ],
    ['unknown', '兑换尚未确认，请刷新或继续同步'],
  ])(
    'keeps the code for retry and reports a safe error for %s',
    async (error, message) => {
      vi.mocked(api).mockRejectedValueOnce(
        new ApiError('private response', 409, error)
      )
      render()
      const code = `CRAGR1.${'b'.repeat(43)}`
      fillHostCode(code)
      submitHostCode()
      await settle()
      const html = render()
      expect(html).toMatch(/role="alert"[^>]*>/)
      expect(html).toContain(`${message}</p>`)
      expect(html).not.toContain('private response')
      expect(state.hostInput?.value).toBe(code)
      expect(state.hostInput?.disabled).toBe(false)
      expect(state.setQueryData).not.toHaveBeenCalled()
      expect(state.invalidateQueries).toHaveBeenCalledExactlyOnceWith({
        queryKey: ['crag-host-subscription'],
      })
    }
  )

  it('lets only admins recover a pending host sync without resubmitting a code', async () => {
    const pending = { state: 'sync_pending', ready: false } as const
    state.hostStatus = pending
    state.role = 'user'
    const buyer = render()
    expect(buyer).not.toContain('订阅使用券')
    expect(buyer).not.toContain('兑换到本机')
    expect(buyer).not.toContain('继续同步')
    expect(api).not.toHaveBeenCalled()

    state.role = 'admin'
    vi.mocked(api).mockResolvedValueOnce(pending)
    expect(render()).not.toContain('兑换到本机')
    click('继续同步')
    await settle()
    const waiting = render()
    expect(api).toHaveBeenCalledExactlyOnceWith(
      '/api/panel/crag-subscription/recover',
      { method: 'POST', body: '{}' }
    )
    expect(waiting).toContain('订阅状态待确认，请继续同步，无需再次兑换')
    expect(waiting).not.toContain('宿主机额度已更新')

    const active = { state: 'active', ready: false, slot_limit: 3 }
    vi.mocked(api).mockResolvedValueOnce(active)
    click('继续同步')
    await settle()
    const recovered = render()
    expect(recovered).toContain('订阅状态已同步')
    expect(recovered).not.toContain('继续同步')
    expect(recovered).toContain('兑换到本机')
    expect(state.setQueryData).toHaveBeenLastCalledWith(
      ['crag-host-subscription'],
      active
    )
    expect(state.invalidateQueries).toHaveBeenCalledTimes(2)
  })
})
