import { useRef, useState, type ReactNode } from 'react'
import {
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { VIEW_TITLES } from '@/config/nav'
import { api, isApiError } from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { PageHeader } from '@/components/page-header'
import { meQueryOptions } from '@/features/auth/queries'
import {
  cragHostStatusLabels,
  cragHostStatusVariant,
  cragSlotsInUse,
} from '@/features/vm/crag-runtime-counts'
import {
  cragHostStatusQueryOptions,
  type CragHostStatus,
} from '@/features/vm/queries'

const hostRoot = '/api/panel/crag-subscription'
const dateTime = new Intl.DateTimeFormat('zh-CN', {
  dateStyle: 'medium',
  timeStyle: 'short',
})

function SubscriptionTime({ seconds }: { seconds: number }) {
  const date = new Date(seconds * 1000)
  if (!Number.isFinite(date.getTime())) return <>—</>
  return <time dateTime={date.toISOString()}>{dateTime.format(date)}</time>
}

function hostRedemptionError(error: unknown) {
  switch (isApiError(error) ? error.code : undefined) {
    case 'crag_subscription_invalid_request':
      return '请输入有效的订阅使用券'
    case 'redeem_unavailable':
      return '此码不可用于本机订阅或已失效'
    case 'host_redeem_conflict':
      return '此码与当前宿主机或订阅不匹配'
    case 'crag_subscription_host_package_unready':
      return '请先在内核页拉取可信 CRAG 发行包'
    default:
      return '兑换尚未确认，请刷新或继续同步'
  }
}

function quotaLabel(value: number | 'unlimited' | null | undefined) {
  return value === 'unlimited' ? '不限' : (value ?? '待核对')
}

function HostSummary({ status }: { status?: CragHostStatus }) {
  const runtime = status?.runtime
  const sku = status?.sku
  const planName = sku
    ? sku === 'custom'
      ? '自定义'
      : sku
    : status?.state === 'unredeemed'
      ? '未订阅'
      : status
        ? '未返回套餐'
        : '待核对'
  const fields: Array<[string, ReactNode]> = [
    [
      '订阅状态',
      <Badge variant={status ? cragHostStatusVariant[status.state] : 'outline'}>
        {status ? cragHostStatusLabels[status.state] : '状态待核对'}
      </Badge>,
    ],
    ['订阅套餐', planName],
    ['使用中的槽位', cragSlotsInUse(status) ?? '待核对'],
    ['订阅槽位额度', quotaLabel(status?.slot_limit)],
    [
      '到期',
      status?.expires_at == null ? (
        '—'
      ) : (
        <SubscriptionTime seconds={status.expires_at} />
      ),
    ],
  ]
  return (
    <section
      aria-label='CRAG 订阅与运行概况'
      className='overflow-hidden rounded-xl border bg-card'
    >
      <dl className='grid grid-cols-2 gap-px bg-border sm:grid-cols-3 lg:grid-cols-5'>
        {fields.map(([label, value]) => (
          <div key={label} className='min-w-0 bg-card px-4 py-3'>
            <dt className='text-xs text-muted-foreground'>{label}</dt>
            <dd className='mt-1 font-semibold wrap-anywhere tabular-nums'>
              {value}
            </dd>
          </div>
        ))}
      </dl>
      {runtime?.host_over_limit === true ? (
        <p role='alert' className='border-t px-4 py-2 text-sm text-destructive'>
          宿主订阅超额，仅超额槽暂停调度
        </p>
      ) : null}
      <div className='flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t px-4 py-2 text-sm'>
        <p className='min-w-0 text-muted-foreground'>
          本机与集群的 Docker、KVM 槽共享同一份订阅额度
        </p>
        <Button size='sm' variant='link' className='px-0' asChild>
          <Link to='/wrap'>前往内核页切换 VM 内核</Link>
        </Button>
      </div>
    </section>
  )
}

function HostOverview({ host }: { host: UseQueryResult<CragHostStatus> }) {
  const qc = useQueryClient()
  const [confirmUpgrade, setConfirmUpgrade] = useState(false)
  const [upgradeFailed, setUpgradeFailed] = useState(false)
  const [code, setCode] = useState('')
  const [notice, setNotice] = useState<{ text: string; error?: true }>()
  const [action, setAction] = useState<'redeem' | 'recover' | 'upgrade'>()
  const operating = useRef(false)
  const status = host.isError ? undefined : host.data
  const syncPending = host.data?.state === 'sync_pending'
  const reclaimPending = (status?.reclaim_pending_count ?? 0) > 0
  const canRecover =
    syncPending || (status?.reclaim_supported && reclaimPending)
  const upgrading = action === 'upgrade'

  async function updateHost(operation: 'redeem' | 'recover') {
    const redemptionCode = code.trim()
    if (operating.current) return
    if (operation === 'redeem' && (!redemptionCode || syncPending)) return
    if (operation === 'recover' && !canRecover) return
    operating.current = true
    setAction(operation)
    setNotice(undefined)
    const { queryKey } = cragHostStatusQueryOptions()
    try {
      const next = await api<CragHostStatus>(`${hostRoot}/${operation}`, {
        method: 'POST',
        body:
          operation === 'redeem'
            ? JSON.stringify({ redemption_code: redemptionCode })
            : '{}',
      })
      qc.setQueryData(queryKey, next)
      if (next.state === 'active' || next.state === 'expired') {
        setCode('')
        setNotice({
          text:
            operation === 'redeem'
              ? '订阅槽位额度已更新，未自动把 VM 切到 CRAG'
              : (next.reclaim_pending_count ?? 0) > 0
                ? '仍有绑定待回收确认'
                : '订阅状态已同步',
        })
      } else if (next.state !== 'sync_pending') {
        setNotice({ text: hostRedemptionError(undefined), error: true })
      }
    } catch (error) {
      setNotice({ text: hostRedemptionError(error), error: true })
    } finally {
      await qc.invalidateQueries({ queryKey })
      operating.current = false
      setAction(undefined)
    }
  }

  async function upgrade() {
    if (operating.current) return
    operating.current = true
    setAction('upgrade')
    setUpgradeFailed(false)
    try {
      await api(`${hostRoot}/upgrade`, {
        method: 'POST',
        body: '{}',
      })
      setConfirmUpgrade(false)
    } catch {
      setUpgradeFailed(true)
    } finally {
      await host.refetch()
      operating.current = false
      setAction(undefined)
    }
  }
  const probeFailed = status?.target_probe_failed && !status.ready
  return (
    <section
      aria-labelledby='crag-host-overview'
      className='space-y-3 rounded-lg border bg-card p-4'
    >
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <div className='flex flex-wrap items-center gap-2'>
          <h2 id='crag-host-overview' className='font-semibold'>
            本机订阅
          </h2>
        </div>
        <Button
          size='sm'
          variant='ghost'
          disabled={host.isFetching || !!action}
          onClick={() => void host.refetch()}
        >
          刷新本机订阅
        </Button>
      </div>
      {status ? (
        <>
          <dl className='grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm tabular-nums [&_dd]:wrap-anywhere [&_dt]:text-muted-foreground'>
            <dt>套餐编号 / 每期时长</dt>
            <dd>
              {status.sku ?? '—'} /{' '}
              {status.months != null ? `${status.months} 个月` : '—'}
            </dd>
            <dt>下次额度到期</dt>
            <dd>
              {status.expires_at == null ? (
                '—'
              ) : (
                <SubscriptionTime seconds={status.expires_at} />
              )}
            </dd>
            <dt>订阅总额度 / 已占用</dt>
            <dd>
              {quotaLabel(status.slot_limit)} / {quotaLabel(status.used_slots)}
            </dd>
            <dt>适用 VM / 已启用</dt>
            <dd>
              {quotaLabel(status.total_slots)} /{' '}
              {quotaLabel(status.enabled_slots)}
            </dd>
            <dt>订阅槽运行 / 还可运行</dt>
            <dd>
              {quotaLabel(status.runtime?.host_running_vms)} /{' '}
              {quotaLabel(status.runtime?.host_runtime_available)}
            </dd>
            <dt>权益修订号</dt>
            <dd>{status.revision ?? '—'}</dd>
          </dl>
          <details className='rounded-md border px-3 text-sm'>
            <summary className='cursor-pointer py-2 font-medium'>
              原始状态数据（JSON）
            </summary>
            <p className='text-xs text-muted-foreground'>
              仅显示面板状态响应，不含签名权益、兑换码或密钥。可能包含 VM ID。
            </p>
            <pre className='my-3 max-h-72 overflow-auto rounded bg-muted p-3 text-xs wrap-anywhere whitespace-pre-wrap'>
              {JSON.stringify(status, null, 2)}
            </pre>
          </details>
        </>
      ) : null}
      {reclaimPending && !status?.reclaim_supported ? (
        <p className='text-sm text-muted-foreground'>
          旧订阅的已删除绑定待启用槽位回收。
        </p>
      ) : null}
      {status?.upgrade_available && !status.reclaim_supported ? (
        <Button
          size='sm'
          variant='outline'
          disabled={!!action}
          onClick={() => setConfirmUpgrade(true)}
        >
          启用槽位回收
        </Button>
      ) : null}
      {status?.reclaim_supported ? (
        <p className='text-sm text-muted-foreground'>
          删除槽位或切回 cli-node 后，经回收确认释放绑定额度。仅停止不立即回收。
        </p>
      ) : null}
      <ConfirmDialog
        open={confirmUpgrade}
        onOpenChange={(open) => {
          if (!upgrading) {
            setConfirmUpgrade(open)
            setUpgradeFailed(false)
          }
        }}
        title='启用本机槽位回收？'
        confirmText='启用回收'
        cancelBtnText='取消'
        desc={
          upgradeFailed
            ? '未确认升级。请刷新本机订阅后检查状态。'
            : '启用后，本机订阅仅支持具备槽位回收能力的新版内核；旧内核不会接受新版宿主权益。'
        }
        isLoading={upgrading}
        handleConfirm={() => void upgrade()}
      />
      {probeFailed ? (
        <p role='status' className='text-sm text-muted-foreground'>
          槽位探测失败。请点击「刷新本机订阅」重试探测。
        </p>
      ) : null}
      <p className='text-sm text-muted-foreground empty:sr-only'>
        {syncPending
          ? '订阅状态待确认，请继续同步，无需再次兑换。'
          : host.isError || status?.state === 'unavailable'
            ? '无法确认本机权益，请刷新后重试。'
            : probeFailed
              ? ''
              : status && !status.ready
                ? '切换 VM 内核到 CRAG 不受额度限制；只有真正调度运行时才占用槽位。本机与集群的 VM 共享同一份槽位。'
                : '兑换只增加可用槽位，不会自动把 VM 切到 CRAG。切换内核随时可做，到内核页为目标 VM 操作即可。'}
      </p>
      {canRecover ? (
        <Button
          type='button'
          size='sm'
          variant='outline'
          disabled={!!action}
          onClick={() => void updateHost('recover')}
        >
          {action === 'recover' ? '正在同步…' : '继续同步'}
        </Button>
      ) : null}
      {!syncPending ? (
        <form
          aria-label='兑换订阅使用券'
          className='max-w-xl space-y-2 border-t pt-3'
          onSubmit={(event) => {
            event.preventDefault()
            void updateHost('redeem')
          }}
        >
          <label className='grid gap-1 text-sm'>
            订阅使用券
            <Input
              type='password'
              autoComplete='off'
              value={code}
              disabled={!!action}
              aria-describedby='crag-host-redeem-help'
              onChange={(event) => {
                setCode(event.target.value)
                setNotice(undefined)
              }}
            />
          </label>
          <p
            id='crag-host-redeem-help'
            className='text-sm text-muted-foreground'
          >
            每张码从兑换时独立计时，未到期额度相加；不绑定、不启动 VM。
          </p>
          <Button type='submit' size='sm' disabled={!code.trim() || !!action}>
            {action === 'redeem' ? '正在兑换…' : '兑换到本机'}
          </Button>
        </form>
      ) : null}
      {notice ? (
        <p
          role={notice.error ? 'alert' : 'status'}
          className={notice.error ? 'text-sm text-destructive' : 'text-sm'}
        >
          {notice.text}
        </p>
      ) : null}
    </section>
  )
}

function useHostStatus(enabled: boolean) {
  return useQuery({
    ...cragHostStatusQueryOptions(),
    enabled,
    refetchInterval: 10_000,
  })
}

export function CragSubscriptionPage() {
  const me = useQuery(meQueryOptions())
  const isAdmin = me.data?.role === 'admin' && !me.isError
  const host = useHostStatus(isAdmin)
  if (!me.data || me.isError) return null
  return (
    <PageHeader
      title={VIEW_TITLES['crag-subscription']}
      description='查看本机订阅状态、有效期与槽位额度。'
    >
      {isAdmin ? (
        <div className='space-y-4'>
          <HostSummary status={host.isError ? undefined : host.data} />
          <HostOverview key={me.data.user} host={host} />
        </div>
      ) : (
        <p className='text-sm text-muted-foreground'>请联系管理员管理本机订阅。</p>
      )}
    </PageHeader>
  )
}
