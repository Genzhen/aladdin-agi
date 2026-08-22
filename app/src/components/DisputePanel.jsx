// 陪审法庭案件卡（第 11 步重构）：disputed 任务就地开庭，**所有人可见**。
// 旧版是"owner 才能看的三按钮"——仲裁黑箱；现在雇主/工程师/围观群众
// 在同一张卡上看到 抽签 → 明票 → 倒计时 → 宣判 全过程。
// 去中心化执行：openCase / closeCase 任何人可点（拿 gas 费做公益），投票只有被抽中的陪审员能投。
// 真相源 = 链上 getCase（坑#22：struct 数组成员自动 getter 拿不到，合约手写了 getCase）。
// 明票是教学取舍：生产换 commit-reveal（合约头部"生产替换点"注释）。
import { useAccount, useReadContract } from 'wagmi'
import { useEffect, useState } from 'react'
import { ADDR, ABI } from '../lib/contracts'
import { Btn } from './ui'
import { useTx } from './Wallet'
import { shortAddr } from '../lib/format'

const VERDICTS = ['🔧 Agent 胜', '🛡️ 雇主胜', '⚖️ 对半分'] // 与合约 Ruling 枚举 0/1/2 对齐
const PHASES = ['🌱 待开庭', '🗳️ 投票中', '✅ 已宣判']

const fmtLeft = (sec) => {
  if (sec <= 0) return '⏰ 投票期已过（可宣判）'
  const m = Math.floor(sec / 60)
  return `剩 ${m}:${String(sec % 60).padStart(2, '0')}`
}

export function DisputePanel({ task, onDone }) {
  const { address } = useAccount()
  const { send, pending } = useTx()
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000))
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000)
    return () => clearInterval(t)
  }, [])

  const { data: c, refetch } = useReadContract({
    address: ADDR.JuryCourt,
    abi: ABI.court,
    functionName: 'getCase',
    args: [BigInt(task.id)],
    query: { enabled: task.state === 'disputed', refetchInterval: 12_000 }, // 陪审员在别处投票，12s 内同步
  })

  const act = async (label, contract, fn, args) => {
    const r = await send(contract, fn, { args }, label)
    if (r.ok) { refetch(); onDone?.() }
  }

  if (task.state !== 'disputed') return null
  const phase = c ? Number(c.phase) : 0
  const mySlot = address && c
    ? c.panel.findIndex((p) => p && p.toLowerCase() === address.toLowerCase())
    : -1
  const votedN = c ? c.voted.filter(Boolean).length : 0
  const expired = c && now >= Number(c.voteEnds)
  const busy = !!pending

  return (
    <div className="space-y-2.5 border-t border-line pt-3">
      <div className="flex items-center justify-between">
        <span className="text-xs text-amber">🧑‍⚖️ 陪审法庭 · {PHASES[phase] || PHASES[0]}</span>
        {phase === 1 && c && (
          <span className="text-[11px] text-slate-500">已投 {votedN}/3 · {fmtLeft(Number(c.voteEnds) - now)}</span>
        )}
      </div>

      {/* phase 0：争议已立案、托管冻结，等任何人来"按开庭铃" */}
      {phase === 0 && (
        <div className="space-y-2">
          <p className="text-xs leading-relaxed text-slate-500">
            争议已立案，托管金冻结。开庭将从质押 ≥100 YD 的陪审池随机抽 3 人（排除双方当事人），
            多数票定裁决；多数方平分仲裁费 + YD 奖励，少数方罚没 15% 质押。
          </p>
          <Btn size="sm" tone="cyan" disabled={busy}
            onClick={() => act(`开庭 #${task.id}`, 'court', 'openCase', [BigInt(task.id)])}>
            🎲 提交陪审团（任何人可点）
          </Btn>
        </div>
      )}

      {/* phase 1：合议庭明票公示 + 我的投票位 */}
      {phase === 1 && c && (
        <div className="space-y-2">
          <div className="space-y-1 rounded-lg border border-line/60 bg-night/50 p-2">
            {c.panel.map((p, i) => (
              <div key={i} className="flex items-center justify-between text-[11px]">
                <span className={i === mySlot ? 'text-cyan' : 'text-slate-400'}>
                  陪审员{i + 1} · {shortAddr(p)}{i === mySlot ? '（你）' : ''}
                </span>
                <span className={c.voted[i] ? 'text-mint' : 'text-slate-600'}>
                  {c.voted[i] ? VERDICTS[Number(c.votes[i])] : '🤫 未投'}
                </span>
              </div>
            ))}
          </div>

          {mySlot >= 0 && !c.voted[mySlot] && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] text-cyan">你被抽中了，请投票：</span>
              {VERDICTS.map((label, v) => (
                <Btn key={v} size="sm" disabled={busy}
                  onClick={() => act(`投 ${label}`, 'court', 'castVote', [BigInt(task.id), v])}>
                  {label}
                </Btn>
              ))}
            </div>
          )}
          {mySlot >= 0 && c.voted[mySlot] && (
            <p className="text-[11px] text-mint">✅ 你已投 {VERDICTS[Number(c.votes[mySlot])]}，等其余陪审员或到期宣判</p>
          )}

          {(votedN === 3 || expired) && (
            <Btn size="sm" tone="cyan" disabled={busy}
              onClick={() => act(`宣判 #${task.id}`, 'court', 'closeCase', [BigInt(task.id)])}>
              ⚖️ 宣判并结算（任何人可点）
            </Btn>
          )}
        </div>
      )}

      {/* phase 2：一般只闪现一瞬——closeCase 同笔交易里 escrow 已结算，Relayer 落库后本卡卸载 */}
      {phase === 2 && c && (
        <p className="text-xs text-mint">
          ✅ 裁决：{VERDICTS[Number(c.finalRuling)]} · 结算已随宣判执行（多数方分仲裁费 + YD 奖励，少数方罚没）
        </p>
      )}
    </div>
  )
}
