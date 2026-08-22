// S6 个人中心：钱包概览 + 我的 Agent / 我发的单 / 仲裁战绩 / MYT 空投
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAccount } from 'wagmi'
import { api } from '../lib/api'
import { toEthNum } from '../lib/contracts'
import { shortAddr, stateBadge, timeAgo } from '../lib/format'
import { Card, Badge, Empty, Btn, ScoreBar } from '../components/ui'
import { useTx } from '../components/Wallet'
import { Link } from 'react-router-dom'

const REWARDS = { agent_listed: '上架奖励', task_published: '发单奖励', task_done: '完单奖励' }

export default function Profile() {
  const { address, isConnected } = useAccount()
  const qc = useQueryClient()
  const { send, pending, lastError } = useTx()

  const { data: agents } = useQuery({ queryKey: ['agents'], queryFn: () => api.agents() })
  const { data: tasks } = useQuery({ queryKey: ['tasks'], queryFn: () => api.tasks() })
  const { data: pending0 } = useQuery({ queryKey: ['airdrop'], queryFn: () => api.airdropPending(), enabled: !!address })

  if (!isConnected) return <Empty>先连接钱包（右上角）</Empty>
  const me = address.toLowerCase()
  const myAgents = (agents || []).filter((a) => a.owner === me)
  const published = (tasks || []).filter((t) => t.publisher === me)
  const mine = [...published]
  const ruledCases = (tasks || []).filter((t) => (t.events || []).some((e) => e.name === 'TaskRuled')).length
  // 空投：同地址聚合（一次 airdrop 批量转账）
  const byAddr = new Map()
  ;(pending0 || []).forEach((r) => byAddr.set((r.addr || '').toLowerCase(), (byAddr.get((r.addr || '').toLowerCase()) || 0n) + BigInt(r.amount_wei)))
  const airdropAddrs = [...byAddr.keys()]
  const airdropTotal = [...byAddr.values()].reduce((s, v) => s + v, 0n)

  return (
    <div className="space-y-5">
      {/* 头部钱包卡（设计稿：地址 + MYT 余额 + Total deposits）——数字全实时 */}
      <Card className="flex flex-wrap items-center gap-x-8 gap-y-3">
        <div>
          <div className="text-[11px] text-slate-500">当前钱包</div>
          <code className="text-sm text-slate-300">{shortAddr(address)}</code>
        </div>
        <div>
          <div className="text-[11px] text-slate-500">MYT 待领</div>
          <div className="text-sm font-semibold text-cyan">{Number(byAddr.get(me) || 0n) / 1e18}</div>
        </div>
        <div>
          <div className="text-[11px] text-slate-500">累计托管（我发的单）</div>
          <div className="text-sm font-semibold">{(Number(published.reduce((s, t) => s + BigInt(t.priceWei || 0), 0n)) / 1e18).toFixed(3)} ETH</div>
        </div>
        <div>
          <div className="text-[11px] text-slate-500">链上已裁决案件</div>
          <div className="text-sm font-semibold">{ruledCases}</div>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="space-y-2">
          <h2 className="font-semibold">我的 Agent（{myAgents.length}）</h2>
          {!myAgents.length ? <Empty>还没上架（市场页「上架我的 Agent」一键登记）</Empty> : myAgents.map((a) => (
            <Link key={a.id} to={`/agent/${a.id}`} className="flex items-center justify-between rounded-lg border border-line/60 p-2 hover:border-violet/40">
              <span className="text-sm">{a.name}</span>
              <ScoreBar score={a.score} />
            </Link>
          ))}
        </Card>

        <Card className="space-y-2">
          <h2 className="font-semibold">我发布的任务（{published.length}）</h2>
          {!published.length ? <Empty>还没发过单</Empty> : published.map((t) => (
            <Link key={t.id} to={`/task/${t.id}`} className="flex items-center justify-between rounded-lg border border-line/60 p-2 hover:border-violet/40">
              <span className="truncate text-sm">{t.title}</span>
              <Badge cls={stateBadge(t.state).cls}>{stateBadge(t.state).label}</Badge>
            </Link>
          ))}
        </Card>

        <Card className="space-y-2">
          <h2 className="font-semibold">任务总览</h2>
          {['matching', 'running', 'review', 'settled', 'disputed'].map((s) => (
            <div key={s} className="flex items-center justify-between text-xs">
              <span className="text-slate-500">{stateBadge(s).label}</span>
              <span>{mine.filter((t) => t.state === s).length}</span>
            </div>
          ))}
          <div className="border-t border-line pt-2 text-xs text-slate-500">
            最近 {mine[0] ? `${timeAgo(mine[0].createdAt)} · ${(mine[0].title || '').slice(0, 12)}…` : '—'}
          </div>
        </Card>

        {/* 仲裁员战绩（设计稿 Juror Leaderboard：有真实数据的给数字，没有的诚实标"待"） */}
        <Card className="space-y-2">
          <h2 className="font-semibold">⚖️ 仲裁员战绩</h2>
          {[
            ['已裁决案件', String(ruledCases)],
            ['裁决模式', '单裁决人（owner）MVP'],
            ['MYT 裁决奖励', '—（待经济模型）'],
            ['陪审团随机抽样', '—（生产替换点）'],
          ].map(([k, v]) => (
            <div key={k} className="flex items-center justify-between text-xs">
              <span className="text-slate-500">{k}</span>
              <span className={v.startsWith('—') ? 'text-slate-600' : 'text-slate-300'}>{v}</span>
            </div>
          ))}
        </Card>
      </div>

      {/* 空投面板：owner 一键批量发放 */}
      <Card className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">🎁 MYT 空投待发（{airdropAddrs.length} 笔 / 共 {Number(airdropTotal) / 1e18} MYT）</h2>
          <Btn tone="mint" disabled={!airdropAddrs.length || !!pending}
            onClick={async () => {
              const r = await send('token', 'airdrop', {
                args: [airdropAddrs, [...byAddr.values()]],
              }, `空投 ${airdropAddrs.length} 笔`)
              if (r.ok) { await api.airdropSent(r.hash, airdropAddrs); qc.invalidateQueries({ queryKey: ['airdrop'] }) }
            }}>
            {pending ? '⏳ 发放中…' : '空投发放（owner）'}
          </Btn>
        </div>
        {!airdropAddrs.length ? <Empty>没有待发奖励（上架 +10 / 发单 +5 / 完单 +20 MYT，完成动作后自动记账）</Empty> : (
          <table className="w-full text-left text-xs">
            <thead className="text-slate-500"><tr><th className="py-1">地址</th><th>原因</th><th className="text-right">数量</th></tr></thead>
            <tbody>
              {(pending0 || []).slice(0, 8).map((r, i) => (
                <tr key={i} className="border-t border-line/50">
                  <td className="py-1.5">{shortAddr(r.addr)}</td>
                  <td>{REWARDS[r.reason] || r.reason} #{r.ref_id}</td>
                  <td className="text-right text-cyan">{Number(r.amount_wei) / 1e18} MYT</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {lastError && <p className="text-xs text-rose">❌ {lastError}</p>}
      </Card>
    </div>
  )
}
