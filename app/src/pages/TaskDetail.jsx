// S4 任务详情：状态 stepper + 事件时间线 + 候选推荐（可点击喂 CTR）+ 角色操作
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams } from 'react-router-dom'
import { useState } from 'react'
import { api } from '../lib/api'
import { toEthNum, depositOf } from '../lib/contracts'
import { shortAddr, stateBadge, timeAgo, fmtPct } from '../lib/format'
import { Card, Tag, Badge, Empty, Btn } from '../components/ui'
import { useTx } from '../components/Wallet'

// stepper：绿=已完成 蓝=进行中 灰=未到（disputed/cancelled 单独显示）
const STEPS = [
  ['matching', '匹配中'],
  ['running', '进行中'],
  ['review', '待验收'],
  ['settled', '已结算'],
]

export default function TaskDetail() {
  const { id } = useParams()
  const qc = useQueryClient()
  const { send, pending, lastError } = useTx()
  const [agentIdInput, setAgentIdInput] = useState('1')

  const { data: t } = useQuery({ queryKey: ['task', id], queryFn: () => api.task(id) })
  if (!t) return <Empty>加载中…</Empty>

  const refresh = () => qc.invalidateQueries({ queryKey: ['task', id] })
  const stepIdx = STEPS.findIndex(([k]) => k === t.state)
  const abnormal = ['disputed', 'cancelled'].includes(t.state)
  const busy = !!pending
  const act = (label, fn) => (
    <Btn disabled={busy} onClick={async () => { const r = await fn(); if (r.ok) refresh() }}>
      {pending?.doing === label ? `⏳ ${label}…` : label}
    </Btn>
  )

  return (
    <div className="space-y-5">
      {/* 状态条 */}
      <Card className="space-y-4">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-xl font-bold">{t.title}</h1>
            <div className="mt-1 text-xs text-slate-500">
              #{t.id} · 雇主 {shortAddr(t.publisher)}
              {t.agentAddr && ` · Agent #${t.agentId}（${shortAddr(t.agentAddr)}）`}
            </div>
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <Badge cls={stateBadge(t.state).cls}>{stateBadge(t.state).label}</Badge>
            <span className="font-semibold text-cyan">{toEthNum(t.priceWei)} ETH</span>
            {t.deadline && !abnormal && (() => {
              const left = Math.max(0, t.deadline - Date.now() / 1000)
              return (
                <span className="text-[11px] text-slate-500">
                  ⏳ 剩 {Math.floor(left / 86400)}d {Math.floor((left % 86400) / 3600)}h
                </span>
              )
            })()}
          </div>
        </div>

        {/* 信息条（设计稿：tags / Price / Deadline / Publisher 卡） */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-line pt-3 text-xs text-slate-400">
          <span>📅 截止 {t.deadline ? new Date(t.deadline * 1000).toLocaleString() : '—'}</span>
          <span>👤 雇主 {shortAddr(t.publisher)}</span>
          {t.agentAddr && <span>🤖 Agent #{t.agentId}（{shortAddr(t.agentAddr)}）</span>}
          <span>🔒 托管 {toEthNum(t.priceWei)} ETH · 保证金 6% · 手续费 0.1% · 仲裁费 0.5%</span>
          <div className="flex flex-wrap gap-1">
            {(Array.isArray(t.tags) ? t.tags : String(t.tags || '').split(',')).filter(Boolean).map((tag) => (
              <Tag key={tag}>{tag}</Tag>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-1">
          {STEPS.map(([k, label], i) => (
            <div key={k} className="flex flex-1 items-center gap-1">
              <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs ${
                abnormal ? 'border-line text-slate-600'
                : i < stepIdx ? 'border-mint bg-mint/20 text-mint'
                : i === stepIdx ? 'border-cyan bg-cyan/20 text-cyan animate-pulse'
                : 'border-line text-slate-600'}`}>
                {i + 1}
              </div>
              <span className={`text-xs ${i === stepIdx && !abnormal ? 'text-cyan' : 'text-slate-500'}`}>{label}</span>
              {i < STEPS.length - 1 && <div className="h-px flex-1 bg-line" />}
            </div>
          ))}
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* 候选推荐（S5 引擎产出，可点击喂在线学习） */}
        <Card className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-semibold">推荐候选</h2>
              <p className="text-[11px] text-slate-500">V0 标签召回 → V1 相似度 cos → V2 pCTR 排序，取 Top3</p>
            </div>
            <Btn size="sm" tone="ghost" disabled={busy} onClick={async () => { await api.dispatch(t.id); refresh() }}>
              重新匹配
            </Btn>
          </div>
          {!t.candidates?.length ? (
            <Empty>还没有推荐（点"重新匹配"触发三层漏斗）</Empty>
          ) : (
            t.candidates.map((c) => (
              <div key={c.agentId} className="rounded-lg border border-line bg-night/50 p-3">
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-sm font-medium">#{c.position} {c.name}</span>
                  <span className="text-xs text-slate-500">pCTR {fmtPct(c.pctr)} · sim {c.sim.toFixed(2)}</span>
                </div>
                <div className="mb-2 flex flex-wrap gap-1">{(c.reasons || []).map((r) => <Tag key={r}>{r}</Tag>)}</div>
                <Btn size="sm" tone="cyan" onClick={async () => {
                  const r = await api.click(t.id, c.agentId)
                  alert(r.ok ? `已点击：pCTR ${r.pctrBefore} → ${r.pctrAfter}（在线学习了一步）` : r.error)
                  refresh()
                }}>👍 选 TA（喂 CTR）</Btn>
              </div>
            ))
          )}
        </Card>

        {/* 链上事件时间线（Relayer 落库的 task_events） */}
        <Card className="space-y-3">
          <h2 className="font-semibold">链上事件时间线</h2>
          {!t.events?.length ? (
            <Empty>暂无事件</Empty>
          ) : (
            <ol className="space-y-2 border-l border-line pl-4">
              {t.events.map((e, i) => (
                <li key={i} className="relative text-xs">
                  <span className="absolute -left-[21px] top-1 h-2 w-2 rounded-full bg-violet" />
                  <span className="font-medium text-slate-200">{e.name}</span>
                  <span className="ml-2 text-slate-500">块 {e.block || '—'} · {timeAgo(e.createdAt)}</span>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>

      {/* 交付物：Agent 执行体的真实产出（agent-runner 落库；null=还没好或纯挂牌） */}
      {t.deliverable && (
        <Card className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">📦 交付物 · Agent #{t.deliverable.agentId} 的真实产出</h2>
            <span className="text-[11px] text-slate-500">{timeAgo(t.deliverable.createdAt)}</span>
          </div>
          {t.deliverable.ok ? (
            <div className="space-y-2">
              <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-lg border border-line bg-night/50 p-3 font-mono text-xs leading-relaxed text-slate-300">
                {t.deliverable.output}
              </pre>
              {t.deliverable.truncated && (
                <div className="rounded-lg border border-amber/30 bg-amber/10 p-3 text-xs text-amber">
                  🔒 样章预览（前 {t.deliverable.previewChars} 字）——验收打款或仲裁裁决后解锁全文
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-lg border border-rose/30 bg-rose/10 p-3 text-xs text-rose">
              ❌ 执行体失败：{t.deliverable.error}（任务仍在进行中，工程师可手动交付补救）
            </div>
          )}
        </Card>
      )}

      {/* 角色操作面板（演示自演自接：一个钱包顶两个角色） */}
      <Card className="space-y-3">
        <h2 className="font-semibold">操作（当前钱包什么角色就点什么）</h2>
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1.5 text-xs text-slate-400">
            Agent#<input className="w-14 rounded border border-line bg-night px-1.5 py-0.5 text-xs" value={agentIdInput} onChange={(e) => setAgentIdInput(e.target.value)} />
          </span>
          {act(`接单(锁 ${(Number(depositOf(BigInt(t.priceWei))) / 1e18).toFixed(4)} ETH 保证金)`, () =>
            send('escrow', 'accept', {
              args: [BigInt(t.id), BigInt(agentIdInput || 1)],
              value: depositOf(BigInt(t.priceWei)),
            }, `接单(锁 ${(Number(depositOf(BigInt(t.priceWei))) / 1e18).toFixed(4)} ETH 保证金)`))}
          {act('交付 (submit)', () => send('escrow', 'submit', { args: [BigInt(t.id)] }, '交付 (submit)'))}
          {act('✅ 验收打款 (approve)', () => send('escrow', 'approve', { args: [BigInt(t.id)] }, '✅ 验收打款 (approve)'))}
          {act('⚠️ 开仲裁（0.5% 仲裁费裁决时从托管扣）', () =>
            send('escrow', 'openDispute', { args: [BigInt(t.id)] }, '⚠️ 开仲裁（0.5% 仲裁费裁决时从托管扣）'))}
        </div>
        {lastError && <div className="text-xs text-rose">❌ {lastError}</div>}
        <p className="text-[11px] text-slate-500">
          接单 = Agent 工程师视角 · 交付 = 工程师 · 验收/仲裁 = 雇主视角。保证金 6%、仲裁费 0.5%（规则全在合约里，和链下无关）
        </p>
      </Card>
    </div>
  )
}
