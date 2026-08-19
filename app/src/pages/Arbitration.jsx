// S7 仲裁中心（照 Stitch 设计稿还原）：案件头 + 争议概述 + 资金明细 + 证据链 + owner 裁决三选一
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import { toEthNum, feeOf, arbFeeOf, depositOf } from '../lib/contracts'
import { Card, Badge, Tag, Empty, Btn } from '../components/ui'
import { useTx } from '../components/Wallet'
import { stateBadge, timeAgo, shortAddr } from '../lib/format'

const RULINGS = [
  { v: 0, label: 'Agent 胜', desc: '全额打给 Agent（交付合格）' },
  { v: 1, label: '雇主胜', desc: '退款 + 罚没 Agent 15% 保证金' },
  { v: 2, label: '五五分', desc: '各拿一半，仲裁费销毁' },
]

export default function Arbitration() {
  const qc = useQueryClient()
  const { send, pending, lastError } = useTx()
  const { data: tasks } = useQuery({ queryKey: ['tasks'], queryFn: () => api.tasks() })

  const disputed = (tasks || []).filter((t) => t.state === 'disputed')
  const ruled = (tasks || []).filter((t) => t.state === 'settled' && (t.events || []).some((e) => e.name === 'TaskRuled'))
  const busy = !!pending

  async function rule(taskId, v) {
    const r = await send('escrow', 'executeRuling', { args: [BigInt(taskId), v] }, `裁决 #${taskId}`)
    if (r.ok) qc.invalidateQueries({ queryKey: ['tasks'] })
  }

  return (
    <div className="space-y-5">
      <section>
        <h1 className="text-xl font-bold">仲裁中心</h1>
        <p className="text-xs text-slate-500">开庭费 0.5%（开争议时押金）· 裁决人是合约 owner（第 11 步演示；生产换陪审团随机抽样）</p>
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold">🔴 待裁决（{disputed.length}）</h2>
        {!disputed.length ? (
          <Empty>没有争议在审。演示路径：任务页「开仲裁」→ 回这里裁决</Empty>
        ) : (
          disputed.map((t) => (
            <Card key={t.id} className="space-y-3 border-rose/30">
              {/* 案件头（设计稿：Case # / 双方 / Escrow 金额） */}
              <div className="flex items-start justify-between gap-3">
                <div>
                  <Link to={`/task/${t.id}`} className="font-medium hover:text-cyan">案件 #{t.id} · {t.title}</Link>
                  <div className="text-xs text-slate-500">
                    雇主 {shortAddr(t.publisher)} vs Agent #{t.agentId} · {timeAgo(t.createdAt)}
                  </div>
                </div>
                <Badge cls={stateBadge('disputed').cls}>托管 {toEthNum(t.priceWei)} ETH</Badge>
              </div>

              {/* 争议概述（设计稿 Dispute Overview） */}
              {t.description && (
                <p className="text-xs leading-relaxed text-slate-400">
                  📋 {String(t.description).slice(0, 120)}{String(t.description).length > 120 ? '…' : ''}
                </p>
              )}

              {/* 资金明细：全部按合约费率真算（设计稿用投票百分比，我们没有多陪审员——用真数据） */}
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500">
                <span>托管 {toEthNum(t.priceWei)} ETH</span>
                <span>平台手续费 0.1% = {(Number(feeOf(BigInt(t.priceWei))) / 1e18).toFixed(6)} ETH</span>
                <span>仲裁费 0.5% = {(Number(arbFeeOf(BigInt(t.priceWei))) / 1e18).toFixed(6)} ETH</span>
                <span>Agent 保证金 6% = {(Number(depositOf(BigInt(t.priceWei))) / 1e18).toFixed(4)} ETH（败诉罚没 15%）</span>
              </div>

              {/* 证据链（设计稿 Submitted Evidence：MVP 没有文件上传，链上事件就是证据） */}
              <div className="rounded-lg border border-line/60 bg-night/50 p-2">
                <div className="mb-1.5 text-[11px] text-slate-500">证据链（链上事件 · MVP 版无文件上传）</div>
                <div className="flex flex-wrap gap-1.5">
                  {(t.events || []).map((e, i) => <Tag key={i}>{e.name}</Tag>)}
                  {!t.events?.length && <span className="text-[11px] text-slate-600">—</span>}
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                {RULINGS.map((r) => (
                  <Btn key={r.v} size="sm" tone={r.v === 1 ? 'rose' : r.v === 0 ? 'mint' : 'ghost'} disabled={busy}
                    onClick={() => rule(t.id, r.v)} title={r.desc}>
                    {pending?.doing === `裁决 #${t.id}` ? '⏳' : `⚖️ ${r.label}`}
                  </Btn>
                ))}
              </div>
            </Card>
          ))
        )}
        {lastError && <p className="text-xs text-rose">❌ {lastError}（只有合约 owner 能裁决）</p>}
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold">📜 已裁决卷宗</h2>
        {!ruled.length ? (
          <Empty>还没有裁决记录</Empty>
        ) : (
          ruled.map((t) => {
            const ev = (t.events || []).find((e) => e.name === 'TaskRuled')
            const args = ev ? JSON.parse(ev.args || '{}') : {}
            const label = ['Agent 胜', '雇主胜', '五五分'][args.ruling] ?? '?'
            return (
              <Card key={t.id} className="flex items-center justify-between">
                <div>
                  <Link to={`/task/${t.id}`} className="text-sm hover:text-cyan">{t.title}</Link>
                  <div className="text-xs text-slate-500">#{t.id} · {timeAgo(ev?.createdAt || t.createdAt)}</div>
                </div>
                <Badge cls="border-line bg-night-3 text-slate-300">⚖️ {label}</Badge>
              </Card>
            )
          })
        )}
      </section>
    </div>
  )
}
