// 陪审员席（第 11 步）：YD 质押 = 陪审资格。「权力要有价格」——
// MYT 是干活奖励（不赋权），YD 是治理/陪审门票（锁仓才有投票权）。
// 水龙头一次恰发 100 YD = 一张门票，演示链路：领水 → 授权 → 质押 → 进池等抽签。
// unstake 在被抽中审案期间会被合约挡住（activeCaseId ≠ 0）——人质在庭，跑不掉。
import { useAccount, useReadContract } from 'wagmi'
import { ADDR, ABI } from '../lib/contracts'
import { Btn } from './ui'
import { useTx } from './Wallet'

const fmtYd = (wei) => Number(wei || 0n) / 1e18 | 0

export function JuryDesk() {
  const { address } = useAccount()
  const { send, pending, lastError } = useTx()

  const reads = {
    count: useReadContract({ address: ADDR.JuryCourt, abi: ABI.court, functionName: 'jurorCount' }),
    pool: useReadContract({ address: ADDR.JuryCourt, abi: ABI.court, functionName: 'rewardPool' }),
    min: useReadContract({ address: ADDR.JuryCourt, abi: ABI.court, functionName: 'MIN_STAKE' }),
    ydBal: useReadContract({
      address: ADDR.YidengToken, abi: ABI.yd, functionName: 'balanceOf',
      args: address ? [address] : undefined, query: { enabled: !!address },
    }),
    me: useReadContract({
      address: ADDR.JuryCourt, abi: ABI.court, functionName: 'jurors',
      args: address ? [address] : undefined, query: { enabled: !!address },
    }),
  }
  const refetchAll = () => Object.values(reads).forEach((r) => r.refetch())

  const min = reads.min.data
  const mine = reads.me.data // { stake, activeCaseId }
  const staked = Number(mine?.stake || 0n) > 0
  const inCase = Number(mine?.activeCaseId || 0n) > 0
  const busy = !!pending

  // 两笔交易：先 ERC20 approve，再 court.stake——和 acceptTask 押保证金同一模式
  const stakeAll = async () => {
    let r = await send('yd', 'approve', { args: [ADDR.JuryCourt, min] }, '授权 100 YD')
    if (!r.ok) return
    r = await send('court', 'stake', { args: [min] }, '质押入陪审池')
    if (r.ok) refetchAll()
  }
  const do_ = async (label, contract, fn, args) => {
    const r = await send(contract, fn, { args }, label)
    if (r.ok) refetchAll()
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-500">
        <span>🏛️ 陪审池 {Number(reads.count.data || 0n)} 人</span>
        <span>🎁 奖池 {fmtYd(reads.pool.data)} YD</span>
        <span>🎫 门槛 {fmtYd(min)} YD（水龙头 24h 一次恰好发一张门票）</span>
      </div>

      {!address ? (
        <p className="text-xs text-slate-500">连接钱包后可质押 YD 成为陪审员</p>
      ) : (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-lg border border-line bg-night-2 px-2.5 py-1 text-xs text-slate-300">
              💛 {fmtYd(reads.ydBal.data)} YD
            </span>
            {staked ? (
              <span className="rounded-lg border border-mint/30 bg-night-2 px-2.5 py-1 text-xs text-mint">
                已质押 {fmtYd(mine.stake)} YD · {inCase ? `正在审理案件 #${Number(mine.activeCaseId)}` : '空闲待抽签'}
              </span>
            ) : (
              <Btn size="sm" tone="cyan" disabled={busy || !min} onClick={stakeAll}>
                {busy ? '⏳' : '🎟️ 质押 100 YD 当陪审员'}
              </Btn>
            )}
            <Btn size="sm" disabled={busy}
              onClick={() => do_('YD 领水', 'yd', 'faucet', [])}>
              💧 领 100 YD
            </Btn>
            {staked && (
              <Btn size="sm" disabled={busy || inCase}
                title={inCase ? '正在审案，合约锁定质押（人质在庭）' : '退出陪审池，取回全部质押'}
                onClick={() => do_('退出陪审池', 'court', 'unstake', [mine.stake])}>
                🚪 退出质押
              </Btn>
            )}
          </div>
          {lastError && <p className="text-xs text-rose">❌ {lastError}</p>}
        </div>
      )}
    </div>
  )
}
