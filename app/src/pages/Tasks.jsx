// S3.5 任务大厅：全平台任务公开列表。
// 这个入口曾是产品空洞——任务只能从"发单成功页"或"个人中心·我发的单"到达，
// Agent 工程师（另一个钱包）根本找不到别人的单子可接。双边市场"供给方逛需求"
// 的主路径在这里补齐：状态筛选 + 一屏行情 + 点击进详情接单。
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import { Card, Tag, Badge, Empty, Btn } from '../components/ui'
import { stateBadge, shortAddr, timeAgo } from '../lib/format'

// '' = 不筛（后端 GET /api/tasks?state= 直出全部）
const TABS = [
  ['', '全部'],
  ['matching', '匹配中'],
  ['running', '进行中'],
  ['review', '待验收'],
  ['disputed', '仲裁中'],
  ['settled', '已结算'],
]

export default function Tasks() {
  const [state, setState] = useState('')
  const { data: list, isLoading } = useQuery({
    queryKey: ['tasks', state],
    queryFn: () => api.tasks(state ? `?state=${state}` : ''),
  })
  const tasks = Array.isArray(list) ? list : list?.tasks || []

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold">📋 任务大厅</h1>
          <p className="mt-0.5 text-xs text-slate-500">
            全平台任务公开可逛——工程师找活接、雇主看行情，点进详情即可接单
          </p>
        </div>
        <Link to="/post"><Btn tone="mint">＋ 发布任务</Btn></Link>
      </Card>

      {/* 状态筛选：与任务状态机同词表 */}
      <div className="flex flex-wrap gap-1.5">
        {TABS.map(([k, label]) => (
          <button key={k || 'all'} onClick={() => setState(k)}
            className={`rounded-lg border px-3 py-1.5 text-xs transition ${
              state === k ? 'border-violet/50 bg-violet/20 text-violet' : 'border-line bg-night-2 text-slate-400 hover:text-slate-200'}`}>
            {label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <Empty>加载中…</Empty>
      ) : !tasks.length ? (
        <Empty>{state ? '这个状态下还没有任务' : '还没有任务，发第一单 →'}</Empty>
      ) : (
        <div className="space-y-2">
          {tasks.map((t) => (
            <Link key={t.id} to={`/task/${t.id}`}
              className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-lg border border-line/60 bg-night/40 p-3 transition hover:border-violet/40">
              <span className="font-mono text-xs text-slate-500">#{t.id}</span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-200">{t.title}</span>
              {t.category && <Tag>{t.category}</Tag>}
              <Badge cls={stateBadge(t.state).cls}>{stateBadge(t.state).label}</Badge>
              <span className="text-xs font-semibold text-cyan">{Number(t.priceEth).toFixed(3)} ETH</span>
              <span className="text-[11px] text-slate-500">
                {t.agentId ? `🤖 Agent#${t.agentId}` : '🔓 招募中'} · 雇主 {shortAddr(t.publisher)} · {timeAgo(t.createdAt)}
              </span>
            </Link>
          ))}
          <p className="pt-1 text-right text-[11px] text-slate-600">{tasks.length} 单 · 数据源 SQLite（链上事件的链下索引）</p>
        </div>
      )}
    </div>
  )
}
