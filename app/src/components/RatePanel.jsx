// 雇主侧验收面板:星级(1~5) + 验收打款一键完成(先落库再签链上),settled 漏评可补。
// 时序:先 POST /rate(链下先有星)→ 再 approve(链上打款)→ Relayer 听到 TaskApproved
// 立刻 rescore,这颗星已能算进五维分。真实产品里"先看样章→打星放款"就是这顺序。
import { useState } from 'react'
import { useAccount } from 'wagmi'
import { api } from '../lib/api'
import { Btn } from './ui'
import { useTx } from './Wallet'

export function Stars({ value, onChange, size = 'text-lg' }) {
  return (
    <span className={`flex items-center gap-0.5 ${size}`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n} type="button" disabled={!onChange}
          onClick={() => onChange?.(n)}
          className={`leading-none transition ${n <= value ? 'text-amber' : 'text-slate-600'} ${onChange ? 'hover:scale-110 cursor-pointer' : 'cursor-default'}`}
        >★</button>
      ))}
    </span>
  )
}

export function RatePanel({ task, onDone }) {
  const { address } = useAccount()
  const { send, pending } = useTx()
  const [stars, setStars] = useState(5)
  const [err, setErr] = useState(null)

  // 非雇主不显示;review=打星验收,settlled 未评=补评(其余态没有评分动作)
  const isPublisher = address && task.publisher &&
    address.toLowerCase() === task.publisher.toLowerCase()
  if (!isPublisher || !['review', 'settled'].includes(task.state)) return null
  if (task.state === 'settled' && task.rating != null) {
    return (
      <div className="flex items-center gap-2 border-t border-line pt-3 text-xs text-amber">
        雇主已评 <Stars value={task.rating} />
      </div>
    )
  }

  // 仲裁完结单：除"判 Agent 全款（=交付合格，等同验收）"外不走完整验收，
  // 不进雇主评分维（后端 rate 接口同款口径，这里只是不渲染入口）
  if (task.state === 'settled' && task.ruling && task.ruling !== 0) {
    const label = { 1: '判雇主全退', 2: '各打五十大板 Split' }[task.ruling]
    return (
      <div className="flex items-center gap-2 border-t border-line pt-3 text-xs text-slate-500">
        ⚖️ 仲裁完结单（{label}）——未走完整验收，不进雇主评分维
      </div>
    )
  }

  const rate = () => api.rateTask(task.id, stars, address).catch((e) => { throw new Error(e.message) })

  const approve = async () => {
    setErr(null)
    try { await rate() } catch (e) { setErr(`打星失败：${e.message}`); return }
    const r = await send('escrow', 'approve', { args: [BigInt(task.id)] }, '✅ 验收打款 (approve)')
    if (r.ok) onDone?.()
  }

  const backfill = async () => {
    setErr(null)
    try { await rate(); onDone?.() } catch (e) { setErr(e.message) }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
      <span className="text-xs text-slate-300">
        {task.state === 'review' ? '验收打星（随打款进五维分的雇主评分维）' : '这单漏评了，补一单的星：'}
      </span>
      <Stars value={stars} onChange={setStars} />
      {task.state === 'review' ? (
        <Btn disabled={!!pending} onClick={approve}>
          {pending?.doing === '✅ 验收打款 (approve)' ? '⏳ 验收打款…' : `✅ ${stars} 星验收打款`}
        </Btn>
      ) : (
        <Btn size="sm" onClick={backfill}>补评</Btn>
      )}
      {err && <span className="text-[11px] text-rose">{err}</span>}
    </div>
  )
}
