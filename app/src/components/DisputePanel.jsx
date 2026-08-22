// 平台仲裁面板：disputed 态且当前钱包 = escrow.owner()（平台仲裁人）才渲染。
// 三选项对应合约 Ruling 枚举：0 AgentWins=全款+退保证金（等同验收）/
// 1 PublisherWins=价款全退+罚没保证金赔雇主 / 2 Split=价款对半、保证金退 Agent。
// 真权限在链上 onlyOwner——前端隐藏只是体验，不是安全边界。
// Relayer 听 TaskRuled → 落 settled + 双方空投 + rescore，这里只管签裁决交易。
import { useAccount, useReadContract } from 'wagmi'
import { ADDR, ABI } from '../lib/contracts'
import { Btn } from './ui'
import { useTx } from './Wallet'

const RULINGS = [
  { v: 2, label: '⚖️ 各打五十大板（对半 Split）', tone: 'cyan' },
  { v: 0, label: '🔧 判 Agent 全款' },
  { v: 1, label: '🛡️ 判雇主全退（罚没保证金）' },
]

export function DisputePanel({ task, onDone }) {
  const { address } = useAccount()
  const { send, pending } = useTx()
  const { data: owner } = useReadContract({
    address: ADDR.TaskEscrow,
    abi: ABI.escrow,
    functionName: 'owner',
  })

  if (task.state !== 'disputed') return null
  const isArbiter = address && owner && address.toLowerCase() === owner.toLowerCase()
  if (!isArbiter) return null

  const rule = async (ruling) => {
    const r = await send('escrow', 'executeRuling', { args: [BigInt(task.id), ruling] }, `裁决 #${task.id}`)
    if (r.ok) onDone?.()
  }

  return (
    <div className="space-y-2 border-t border-line pt-3">
      <span className="text-xs text-amber">🧑‍⚖️ 平台裁决（仲裁费 0.5% 从托管扣，裁决即终局 → 已结算）：</span>
      <div className="flex flex-wrap items-center gap-2">
        {RULINGS.map(({ v, label, tone }) => (
          <Btn key={v} size="sm" tone={tone} disabled={!!pending} onClick={() => rule(v)}>
            {pending ? '⏳ 裁决中…' : label}
          </Btn>
        ))}
      </div>
    </div>
  )
}
