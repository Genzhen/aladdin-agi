// ManualDeliverPanel.jsx —— 工程师手动交付补救（真案 #24 催生）
// 执行体的输入护栏拒收（description 太短）或超时未回时，任务卡在 running、
// 托管款和保证金都锁着。链上「交付 (submit)」按钮操作卡里一直有，但没有
// 交付物内容的入口——雇主验收时只看得到一坨失败报错。这里补上闭环：
// 贴内容 → 落库（覆盖失败记录，Deliverable 卡自动渲染）→ 同一点击签 submit。
import { useAccount } from 'wagmi'
import { useState } from 'react'
import { api } from '../lib/api'
import { Btn, inputCls } from './ui'
import { useTx } from './Wallet'

export function ManualDeliverPanel({ task, onDone }) {
  const { address } = useAccount()
  const { send, pending } = useTx()
  const [content, setContent] = useState('')
  const [err, setErr] = useState('')

  // 只在执行体明确失败(ok=false)后亮：还在跑(无记录)或已成功都不需要人抢活；
  // 手动交付是接单钱包的权力（合约 submit 校验 msg.sender==接单者，UI 提前对齐）
  if (task.state !== 'running' || task.deliverable?.ok !== false) return null
  if (!address || address.toLowerCase() !== (task.agentAddr || '').toLowerCase()) return null

  const len = content.trim().length

  const deliver = async () => {
    setErr('')
    try {
      await api.manualDeliver(task.id, content.trim(), address) // ① 内容先落库（链下本体）
    } catch (e) {
      setErr(e.message)
      return
    }
    // ② 链上翻转 running→review（成功后 Relayer 落状态，卡片随即渲染交付物）
    const r = await send('escrow', 'submit', { args: [BigInt(task.id)] }, `手动交付 #${task.id}`)
    if (r.ok) onDone?.()
  }

  return (
    <div className="space-y-2 border-t border-line pt-3">
      <div className="text-xs font-medium text-slate-300">🧑‍🔧 手动交付补救（执行体失败，由你交活）</div>
      <textarea
        className={`${inputCls} h-24 font-mono`}
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder={'贴交付物：完整 HTML 自动沙箱预览、SVG 成图、其余按文本展示。例：<!DOCTYPE html>…CSS 动画…'}
      />
      <div className="flex items-center gap-2">
        <Btn size="sm" tone="cyan" disabled={!!pending || len < 15} onClick={deliver}>
          {pending ? `⏳ ${pending.doing}…` : '📦 落库并上链 submit'}
        </Btn>
        <span className={`text-[11px] ${len < 15 ? 'text-amber' : 'text-mint'}`}>
          {len < 15 ? `还差 ${15 - len} 字` : `✓ ${len} 字`}
        </span>
      </div>
      {err && <div className="text-xs text-rose">❌ {err}</div>}
    </div>
  )
}
