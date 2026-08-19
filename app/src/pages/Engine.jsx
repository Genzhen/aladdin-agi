// S5 匹配引擎总览：三层漏斗可视化 + 队列/死信/模型状态（设计稿 a704a7eb 三列版式）
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { api } from '../lib/api'
import { fmtPct } from '../lib/format'
import { Card, Tag, Badge, Empty } from '../components/ui'

const LAYER_META = [
  { key: 'v0', name: 'V0 粗召回', desc: 'tag/category 硬匹配 + 冷启动兜底 + 洗牌公平', tone: 'border-cyan/40 text-cyan' },
  { key: 'v1', name: 'V1 精排', desc: '手写 TF-IDF + 余弦相似度', tone: 'border-violet/40 text-violet' },
  { key: 'v2', name: 'V2 重排', desc: '手写逻辑回归 SGD 预估 CTR', tone: 'border-mint/40 text-mint' },
]

export default function Engine() {
  const { data: e } = useQuery({ queryKey: ['engine'], queryFn: () => api.engine() })
  const [runId, setRunId] = useState(null) // 点历史行切换可视化哪一次分发（设计稿左侧任务列表）
  if (!e) return <Empty>加载中…（需要 server 起着）</Empty>

  const latest = e.recentRuns?.find((r) => r.id === runId) || e.recentRuns?.[0]

  return (
    <div className="space-y-5">
      <section className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">匹配引擎</h1>
          <p className="text-xs text-slate-500">链上 TaskPosted → Redis 队列 → Go 引擎消费 → 三层漏斗 → Top3 推荐</p>
        </div>
        <div className="flex gap-2 text-xs">
          <Badge cls="border-line bg-night-2 text-slate-300">Agent {e.agents} 个</Badge>
          <Badge cls="border-line bg-night-2 text-slate-300">任务 {e.tasks} 个</Badge>
          <Badge cls={`border-line bg-night-2 ${e.queueDepth > 0 ? 'text-amber' : 'text-slate-300'}`}>队列深度 {e.queueDepth ?? '—'}</Badge>
          <Badge cls={`border-line bg-night-2 ${e.deadCount > 0 ? 'text-rose' : 'text-slate-300'}`}>死信 {e.deadCount}</Badge>
        </div>
      </section>

      {/* 漏斗：三列 + 通过数 */}
      {latest && !latest.dead ? (
        <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {LAYER_META.map((m, i) => {
            const layer = latest.layers?.[m.key] || {}
            const width = `${Math.max(12, (layer.out ?? 0) / Math.max(1, layer.in ?? 1) * 100)}%`
            return (
              <Card key={m.key} className={`space-y-3 border ${m.tone}`}>
                <div className="flex items-center justify-between">
                  <span className="font-semibold">{m.name}</span>
                  <span className="text-2xl font-bold">{layer.out ?? '—'}<span className="text-sm text-slate-500">/{layer.in ?? '—'}</span></span>
                </div>
                <p className="text-[11px] text-slate-500">{m.desc}</p>
                <div className="h-2 overflow-hidden rounded bg-night-3">
                  <div className="h-full bg-gradient-to-r from-violet to-cyan transition-all" style={{ width }} />
                </div>
                {m.key === 'v0' && layer.coldStart && <Tag>❄️ 冷启动：全量召回</Tag>}
                {m.key === 'v1' && layer.top && <Tag>Top: Agent#{layer.top.agentId} sim {layer.top.sim.toFixed(3)}</Tag>}
                {m.key === 'v2' && <Tag>{layer.weightsTrained ? '🧠 已带训练权重' : '💤 冷启动中性先验 0.5'}</Tag>}
                {i < 2 && <p className="text-right text-[10px] text-slate-600">↓ 通过 {layer.out ?? 0} 个</p>}
              </Card>
            )
          })}
        </section>
      ) : latest?.dead ? (
        <Card className="border-rose/40 text-sm text-rose">💀 最近一次分发进了死信：{latest.deadReason}</Card>
      ) : (
        <Empty>还没有分发记录（发布任务或点任务页"重新匹配"）</Empty>
      )}

      {/* 最终推荐 */}
      {latest?.final?.length > 0 && (
        <Card className="space-y-3">
          <h2 className="font-semibold">最新推荐 Top{latest.final.length}（任务 #{latest.taskId}）</h2>
          <div className="space-y-2">
            {latest.final.map((c) => (
              <div key={c.agentId} className="flex items-center gap-3">
                <span className="w-6 text-xs text-slate-500">#{c.position}</span>
                <span className="w-40 truncate text-sm">{c.name}</span>
                <div className="h-2 flex-1 overflow-hidden rounded bg-night-3">
                  <div className="h-full bg-gradient-to-r from-cyan to-mint" style={{ width: `${c.pctr * 100}%` }} />
                </div>
                <span className="w-14 text-right text-xs text-slate-400">{fmtPct(c.pctr)}</span>
                {c.sim != null && <span className="w-16 text-right text-[11px] text-slate-500">sim {c.sim.toFixed(2)}</span>}
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* 历史分发 */}
      <Card className="space-y-2">
        <h2 className="font-semibold">分发历史（match_runs）</h2>
        {!e.recentRuns?.length ? <Empty /> : (
          <table className="w-full text-left text-xs">
            <thead className="text-slate-500">
              <tr><th className="py-1">时间</th><th>任务</th><th>V0</th><th>V1</th><th>V2</th><th>状态</th></tr>
            </thead>
            <tbody>
              {e.recentRuns.map((r) => (
                <tr
                  key={r.id}
                  onClick={() => setRunId(r.id)}
                  className={`cursor-pointer border-t border-line/50 hover:bg-night-3/40 ${
                    latest?.id === r.id ? 'bg-violet/10' : ''
                  }`}
                >
                  <td className="py-1.5 text-slate-500">{(r.created_at || '').slice(5, 16).replace('T', ' ')}</td>
                  <td>#{r.task_id}</td>
                  <td>{r.layers?.v0?.out ?? '—'}</td>
                  <td>{r.layers?.v1?.out ?? '—'}</td>
                  <td>{r.layers?.v2?.out ?? '—'}</td>
                  <td className={r.status === 'dead' ? 'text-rose' : 'text-mint'}>{r.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  )
}
