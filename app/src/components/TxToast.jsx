// 全局交易反馈条：订阅 useTx 广播的阶段事件，右上角悬浮显示交易进度。
// 治两个病：① 点击后到钱包弹窗间的无声期（用户以为没点上，反复点=重复提交）；
// ② 签名后等上链期间页面毫无动静。进行中阶段常驻，终态 5s 后自动消失。
import { useEffect, useRef, useState } from 'react'
import { onTxEvent } from './Wallet'

const PHASES = {
  preparing: { icon: '⏳', cls: 'text-cyan', text: '正在准备交易（模拟 + 估气）…' },
  signing: { icon: '🦊', cls: 'text-amber', text: '请在钱包里确认' },
  mining: { icon: '⛏️', cls: 'text-cyan', text: '已广播，等待上链…' },
  done: { icon: '✅', cls: 'text-mint', text: '交易完成' },
  error: { icon: '❌', cls: 'text-rose', text: '交易失败' },
}
const SEP_URL = 'https://sepolia.etherscan.io/tx/'

export default function TxToast() {
  const [tx, setTx] = useState(null)
  const timer = useRef(null)

  useEffect(() => onTxEvent((e) => {
    clearTimeout(timer.current)
    setTx(e)
    if (e.phase === 'done' || e.phase === 'error') {
      timer.current = setTimeout(() => setTx(null), 5000)
    }
  }), [])

  if (!tx) return null
  const p = PHASES[tx.phase] || PHASES.preparing
  const running = !['done', 'error'].includes(tx.phase)
  return (
    <div className="fixed right-4 top-4 z-50 w-72 rounded-lg border border-line bg-night-2/95 p-3 shadow-xl backdrop-blur">
      <div className="flex items-center gap-2">
        <span className={running ? 'animate-pulse' : ''}>{p.icon}</span>
        <span className={`text-xs font-medium ${p.cls}`}>
          {p.text}{tx.phase === 'done' && tx.ok === false ? '（链上 revert）' : ''}
        </span>
      </div>
      <div className="mt-1 truncate text-[11px] text-slate-400" title={tx.label}>{tx.label}</div>
      {tx.hash && (
        <a
          href={SEP_URL + tx.hash} target="_blank" rel="noreferrer"
          className="mt-0.5 block truncate text-[11px] text-cyan hover:underline"
        >↗ {tx.hash}</a>
      )}
      {tx.phase === 'error' && (
        <div className="mt-1 line-clamp-3 break-all text-[11px] text-rose/90">{tx.error}</div>
      )}
    </div>
  )
}
