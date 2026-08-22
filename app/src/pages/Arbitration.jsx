// S7 仲裁中心 → 陪审法庭（第 11 步重构）。旧版"owner 三按钮"已废弃：
// escrow 所有权已移交 JuryCourt，平台不再人工裁决——任何人在 DisputePanel
// 上开庭/宣判，被抽中的陪审员投票。本页 = 公开 docket：
// 陪审员席（质押入口）+ 在审案件（人人可见的庭审进度）+ 已裁决卷宗。
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import { toEthNum, feeOf, arbFeeOf, depositOf } from '../lib/contracts'
import { Card, Badge, Tag, Empty } from '../components/ui'
import { DisputePanel } from '../components/DisputePanel'
import { JuryDesk } from '../components/JuryDesk'
import { stateBadge, timeAgo, shortAddr } from '../lib/format'

export default function Arbitration() {
  const qc = useQueryClient()
  const { data: tasks } = useQuery({ queryKey: ['tasks'], queryFn: () => api.tasks() })
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['tasks'] })
    qc.invalidateQueries({ queryKey: ['case-events'] })
  }

  const disputed = (tasks || []).filter((t) => t.state === 'disputed')
  // ruling 字段来自库（Relayer 听 TaskRuled 落的）：null=正常验收，非空=裁结局
  const ruled = (tasks || []).filter((t) => t.state === 'settled' && t.ruling !== null && t.ruling !== undefined)

  // 列表端点不带 events（详情才带）——只给少数相关案件补拉证据链，
  // 顺带拿 CaseRuled 的多数方/罚没人数
  const wanted = [...disputed, ...ruled].map((t) => t.id)
  const { data: evMap } = useQuery({
    queryKey: ['case-events', wanted.join(',')],
    queryFn: async () => Object.fromEntries(
      await Promise.all(wanted.map((id) => api.task(id).then((d) => [id, d.events || []]))),
    ),
    enabled: wanted.length > 0,
  })
  const eventsOf = (t) => evMap?.[t.id] || []

  return (
    <div className="space-y-5">
      <section>
        <h1 className="text-xl font-bold">🏛️ 陪审法庭</h1>
        <p className="text-xs text-slate-500">
          质押 100 YD 进陪审池 · 随机抽 3 人合议庭 · 多数票裁决：多数方分仲裁费 + YD 奖励，少数方罚没 15% 质押
        </p>
      </section>

      <Card className="space-y-3">
        <h2 className="font-semibold">🎫 陪审员席</h2>
        <JuryDesk />
      </Card>

      <section className="space-y-3">
        <h2 className="font-semibold">🔴 在审案件（{disputed.length}）</h2>
        {!disputed.length ? (
          <Empty>没有案件在审。演示路径：任务页「开仲裁」→ 提交陪审团 → 三票 → 宣判</Empty>
        ) : (
          disputed.map((t) => (
            <Card key={t.id} className="space-y-3 border-rose/30">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <Link to={`/task/${t.id}`} className="font-medium hover:text-cyan">案件 #{t.id} · {t.title}</Link>
                  <div className="text-xs text-slate-500">
                    雇主 {shortAddr(t.publisher)} vs Agent #{t.agentId} · {timeAgo(t.createdAt)}
                  </div>
                </div>
                <Badge cls={stateBadge('disputed').cls}>托管 {toEthNum(t.priceWei)} ETH</Badge>
              </div>

              {t.description && (
                <p className="text-xs leading-relaxed text-slate-400">
                  📋 {String(t.description).slice(0, 120)}{String(t.description).length > 120 ? '…' : ''}
                </p>
              )}

              {/* 资金明细按合约费率真算——裁决后钱去哪儿一目了然 */}
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500">
                <span>托管 {toEthNum(t.priceWei)} ETH</span>
                <span>平台手续费 0.1% = {(Number(feeOf(BigInt(t.priceWei))) / 1e18).toFixed(6)} ETH</span>
                <span>仲裁费 0.5% = {(Number(arbFeeOf(BigInt(t.priceWei))) / 1e18).toFixed(6)} ETH（归多数方陪审员）</span>
                <span>Agent 保证金 6% = {(Number(depositOf(BigInt(t.priceWei))) / 1e18).toFixed(4)} ETH</span>
              </div>

              {/* 庭审进度 + 开庭/投票/宣判按钮（所有人可见可用） */}
              <DisputePanel task={t} onDone={refresh} />

              {/* 证据链：Relayer 把 CaseOpened/VoteCast/CaseRuled 也落进来，叙事完整 */}
              <div className="rounded-lg border border-line/60 bg-night/50 p-2">
                <div className="mb-1.5 text-[11px] text-slate-500">证据链（链上事件）</div>
                <div className="flex flex-wrap gap-1.5">
                  {eventsOf(t).map((e, i) => <Tag key={i}>{e.name}</Tag>)}
                  {!eventsOf(t).length && <span className="text-[11px] text-slate-600">—</span>}
                </div>
              </div>
            </Card>
          ))
        )}
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold">📜 已裁决卷宗</h2>
        {!ruled.length ? (
          <Empty>还没有宣判记录</Empty>
        ) : (
          ruled.map((t) => {
            const label = ['Agent 胜', '雇主胜', '五五分'][t.ruling] ?? '?'
            // 陪审庭宣判的案件有 CaseRuled：多数方人数 / 被罚人数；没有 = 旧机制平台裁决
            const crEv = eventsOf(t).find((e) => e.name === 'CaseRuled')
            const cr = crEv ? JSON.parse(crEv.args || '{}') : null
            return (
              <Card key={t.id} className="flex items-center justify-between">
                <div>
                  <Link to={`/task/${t.id}`} className="text-sm hover:text-cyan">{t.title}</Link>
                  <div className="text-xs text-slate-500">
                    #{t.id} · {timeAgo(crEv?.created_at || t.createdAt)}
                    {cr ? ` · 合议庭 ${cr.winnerCount}✓ vs ${3 - cr.winnerCount}✗ · 罚没 ${cr.slashedCount} 人` : ' · 平台裁决（旧机制）'}
                  </div>
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
