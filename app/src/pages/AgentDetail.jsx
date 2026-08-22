// S2 Agent 详情（照 Stitch 设计稿还原）：面包屑 + 头部（★分）+ 右侧价格卡/数据三卡 + Track Record 历史表
import { useQuery } from '@tanstack/react-query'
import { useAccount } from 'wagmi'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { api } from '../lib/api'
import { toEthNum } from '../lib/contracts'
import { shortAddr, stateBadge, timeAgo } from '../lib/format'
import { Card, Tag, Badge, Empty, ScoreBar, Btn } from '../components/ui'
import Enrich from '../components/Enrich'
import EndpointEdit from '../components/EndpointEdit'
import AutoAccept from '../components/AutoAccept'

// 五维分权重（PRD §5：完成 70 / 雇主评分 15 / 沟通 10 / 争议 2.5 / 规模 2.5）
const DIMS = [
  ['completion', '完成强度', 70],
  ['rating', '雇主评分', 15],
  ['resp', '沟通响应', 10],
  ['dispute', '争议率', 2.5],
  ['scale', '历史规模', 2.5],
]

export default function AgentDetail() {
  const { id } = useParams()
  const nav = useNavigate()
  const { address } = useAccount()
  const { data: a } = useQuery({ queryKey: ['agent', id], queryFn: () => api.agent(id) })
  const { data: tasks } = useQuery({ queryKey: ['tasks'], queryFn: () => api.tasks() })

  if (!a) return <Empty>加载中…</Empty>
  const myTasks = (tasks || []).filter((t) => t.agentId === a.id)
  const dims = a.scoreDims && a.scoreDims.completion != null ? a.scoreDims : null
  // 数据三卡（设计稿 Agent Score / Completion / Quality）：全部由真实历史算出，没历史就显示 –
  const settled = myTasks.filter((t) => t.state === 'settled').length
  const completion = myTasks.length ? Math.round((settled / myTasks.length) * 100) : null
  const stats = [
    { label: 'Agent Score', value: (a.score / 100).toFixed(2), hint: '链上信用分' },
    { label: 'Completion', value: completion == null ? '–' : `${completion}%`, hint: `${settled}/${myTasks.length} 单结算` },
    { label: 'Rating', value: dims ? (dims.rating / 20).toFixed(1) : '–', hint: '五维·雇主星级' },
  ]

  return (
    <div className="space-y-5">
      {/* 面包屑（设计稿：Agents / Writing / ScriptWriter Pro） */}
      <section className="flex items-center gap-1.5 text-xs text-slate-500">
        <Link to="/" className="hover:text-slate-300">Agents</Link>
        <span>›</span>
        <span>{a.category}</span>
        <span>›</span>
        <span className="text-slate-300">{a.name}</span>
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* 主卡：身份 + 简介 + tags */}
        <Card className="lg:col-span-2 space-y-4">
          <div className="flex items-start gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-cyan-500 text-xl font-bold text-white">
              {a.name[0]}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-bold">{a.name}</h1>
                <span className="text-xs text-amber">★ {(a.score / 100).toFixed(2)}</span>
                <Tag>{a.category}</Tag>
              </div>
              <div className="text-xs text-slate-500">
                工程师 {shortAddr(a.owner)} · 上架于 {timeAgo(a.registeredAt)}
              </div>
            </div>
          </div>
          <p className="text-sm text-slate-300">{a.description || '（工程师还没写简介）'}</p>
          {/* owner 本人可见:补/改简介 + 自动接单开关(纯链下 enrich,不发交易) */}
          {address && a.owner && address.toLowerCase() === a.owner.toLowerCase() && (
            <div className="flex flex-wrap items-center gap-2">
              <Enrich agentId={a.id} description={a.description} />
              <AutoAccept agentId={a.id} enabled={a.autoAccept} hasEndpoint={!!a.endpoint} />
              <EndpointEdit agentId={a.id} endpoint={a.endpoint} />
            </div>
          )}
          <div className="flex flex-wrap gap-1.5">{a.tags.map((t) => <Tag key={t}>{t}</Tag>)}</div>
          <div className="flex gap-2 border-t border-line pt-3">
            <Btn onClick={() => nav('/post')}>找 TA 做任务</Btn>
          </div>
        </Card>

        {/* 右侧栏：价格卡（设计稿 Purchase 卡）→ 数据三卡 → 五维评分 */}
        <div className="space-y-4">
          <Card className="text-center">
            <div className="text-2xl font-bold text-cyan">{toEthNum(a.priceWei)} ETH</div>
            <div className="text-[11px] text-slate-500">每次运行报价（链上 register 时写死）</div>
          </Card>
          <div className="grid grid-cols-3 gap-2">
            {stats.map((s) => (
              <Card key={s.label} className="p-2.5 text-center">
                <div className="text-sm font-bold">{s.value}</div>
                <div className="text-[10px] text-slate-500">{s.label}</div>
                <div className="text-[10px] text-slate-600">{s.hint}</div>
              </Card>
            ))}
          </div>
          <Card className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">五维评分</h2>
              <ScoreBar score={a.score} />
            </div>
            {dims ? (
              DIMS.map(([key, label, w]) => (
                <div key={key} className="space-y-1">
                  <div className="flex justify-between text-xs text-slate-400">
                    <span>{label}（权重 {w}%）</span>
                    <span>{(dims[key] / 100).toFixed(2)}</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded bg-night-3">
                    <div className="h-full bg-gradient-to-r from-violet to-cyan" style={{ width: `${dims[key]}%` }} />
                  </div>
                </div>
              ))
            ) : (
              <Empty>完成首单后生成（后端按历史任务聚合）</Empty>
            )}
            {dims && <p className="text-[11px] text-slate-500">{dims.note}</p>}
          </Card>
        </div>
      </div>

      {/* Track Record（设计稿：任务/价格/结果/评分 四列表） */}
      <section className="space-y-3">
        <h2 className="font-semibold">Track Record · 接过的任务（{myTasks.length}）</h2>
        {!myTasks.length ? (
          <Empty>还没接过单</Empty>
        ) : (
          <Card className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-slate-500">
                  <th className="px-4 py-2.5">任务</th>
                  <th className="px-4 py-2.5">价格</th>
                  <th className="px-4 py-2.5">结果</th>
                  <th className="px-4 py-2.5 text-right">评分</th>
                </tr>
              </thead>
              <tbody>
                {myTasks.map((t) => {
                  const sb = stateBadge(t.state)
                  const ok = t.state === 'settled'
                  return (
                    <tr key={t.id} className="border-b border-line/50 last:border-0 hover:bg-night-3/40">
                      <td className="px-4 py-2.5">
                        <Link to={`/task/${t.id}`} className="font-medium hover:text-violet">{t.title}</Link>
                        <div className="text-[11px] text-slate-500">{timeAgo(t.createdAt)}</div>
                      </td>
                      <td className="px-4 py-2.5 text-slate-300">{toEthNum(t.priceWei)} ETH</td>
                      <td className="px-4 py-2.5">{ok ? '✅' : '⏳'} <Badge cls={sb.cls}>{sb.label}</Badge></td>
                      <td className="px-4 py-2.5 text-right text-amber">{t.rating ? '★'.repeat(t.rating) : '–'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </Card>
        )}
      </section>
    </div>
  )
}
