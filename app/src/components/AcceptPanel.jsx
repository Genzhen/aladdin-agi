// 工程师侧接单面板:列出当前钱包拥有的 active Agent,一键替 TA 锁保证金接单。
// 真实语义:接单是 Agent owner 的行为——谁接谁锁 6% 保证金、验收后款打给谁,
// agentId 从按钮自动带上(替代旧版手填输入框)。演示钱包拥有全部上架 Agent,
// 所以这里就是"工程师工作台"的最小形态。
import { useQuery } from '@tanstack/react-query'
import { useAccount } from 'wagmi'
import { api } from '../lib/api'
import { depositOf } from '../lib/contracts'
import { Btn } from './ui'
import { useTx } from './Wallet'

export function AcceptPanel({ task, onDone }) {
  const { address } = useAccount()
  const { send, pending, lastError } = useTx()
  // 必须箭头包裹：裸引用 api.agents 会被 React Query 传入 query 上下文对象 → /api/agents[object Object] 404
  const { data: agents } = useQuery({ queryKey: ['agents'], queryFn: () => api.agents() })

  const mine = (agents || []).filter(
    (a) => a.owner?.toLowerCase() === address?.toLowerCase() && a.status !== 'delisted',
  )
  const deposit = (Number(depositOf(BigInt(task.priceWei))) / 1e18).toFixed(4)

  if (task.state !== 'matching') return null // 只有匹配中才需要接单

  const accept = (a) =>
    send('escrow', 'accept', {
      args: [BigInt(task.id), BigInt(a.id)],
      value: depositOf(BigInt(task.priceWei)),
    }, `替 #${a.id} ${a.name} 接单`).then((r) => { if (r.ok) onDone?.() })

  return (
    <div className="space-y-2 border-t border-line pt-3">
      <div className="text-xs font-medium text-slate-300">
        🛠 工程师侧:替我的 Agent 接单(锁 {deposit} ETH 保证金,agentId 自动带上)
      </div>
      {!mine.length ? (
        <p className="text-[11px] text-slate-500">当前钱包没有 active 的 Agent——先去「上架我的 Agent」。</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {mine.map((a) => (
            <Btn key={a.id} size="sm" tone={a.endpoint ? 'cyan' : 'ghost'} disabled={!!pending} onClick={() => accept(a)}>
              {pending?.doing === `替 #${a.id} ${a.name} 接单` ? '⏳' : '🤝'} #{a.id} {a.name}
              {a.endpoint ? ' · 自动交付' : ' · 手动交付'}
            </Btn>
          ))}
        </div>
      )}
      {lastError && <div className="text-xs text-rose">❌ {lastError}</div>}
    </div>
  )
}
