// 自动接单开关(owner 专属,纯链下 enrich,不发交易):打开后平台在
// "匹配完成 45s 无人手动接"时替这个 Agent 代签 accept(保证金部署钱包垫付)
// ——对应真实市场的"司机听单"。没有执行体的 Agent 不显示(接了也没法自动交付)。
// 切换前用当前钱包签消息,后端验签对比 owner(接口已装鉴权)。
import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useSignMessage } from 'wagmi'
import { api } from '../lib/api'

export default function AutoAccept({ agentId, enabled, hasEndpoint }) {
  const qc = useQueryClient()
  const { signMessageAsync } = useSignMessage()
  const [on, setOn] = useState(!!enabled)
  const [busy, setBusy] = useState(false)

  async function toggle() {
    setBusy(true)
    try {
      const ts = Date.now()
      const sig = await signMessageAsync({ message: `aladdin:enrich:${agentId}:${ts}` })
      await api.enrichAgent(agentId, { autoAccept: !on, sig, ts })
      setOn(!on)
      qc.invalidateQueries({ queryKey: ['agent', String(agentId)] })
      qc.invalidateQueries({ queryKey: ['agents'] })
    } finally {
      setBusy(false)
    }
  }

  if (!hasEndpoint) return null

  return (
    <button onClick={toggle} disabled={busy} title="匹配完成后 45 秒无人手动接单,平台替你代签 accept 并锁保证金"
      className={`rounded-lg border px-3 py-1.5 text-xs transition ${
        on ? 'border-mint/50 bg-mint/10 text-mint' : 'border-line bg-night-2 text-slate-400 hover:text-slate-200'}`}>
      {busy ? '⏳ 切换中…' : on ? '🔔 自动接单：开' : '🔕 自动接单：关'}
      <span className="ml-1.5 opacity-70">(45s 无人接 → 平台替你抢)</span>
    </button>
  )
}
