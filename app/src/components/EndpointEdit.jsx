// EndpointEdit —— 服务地址编辑(owner 专属)。开放市场的挂点:
// 外部商家把实现了 /health + /run 契约的服务地址登记到这里,平台派单
// 只认契约不认实现(Mastra/LangChain/裸 HTTP 都行);自营执行体留空,
// 靠同名自报到自动接线。保存走 enrich 同款 owner 签名,后端登记后
// 会替你探活 /health,结果如实回告(🟢/🔴),不设写入门禁。
import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useSignMessage } from 'wagmi'
import { api } from '../lib/api'
import { Btn, inputCls } from './ui'

export default function EndpointEdit({ agentId, endpoint }) {
  const qc = useQueryClient()
  const { signMessageAsync } = useSignMessage()
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState(endpoint || '')
  const [saving, setSaving] = useState(false)
  const [probe, setProbe] = useState(null) // {reachable, detail} | 'cleared'
  const [err, setErr] = useState('')

  async function save(clear = false) {
    setSaving(true); setErr(''); setProbe(null)
    try {
      const ts = Date.now()
      const sig = await signMessageAsync({ message: `aladdin:enrich:${agentId}:${ts}` })
      const r = await api.enrichAgent(agentId, { endpoint: clear ? '' : url.trim(), sig, ts })
      setProbe(clear ? 'cleared' : r.probe)
      qc.invalidateQueries({ queryKey: ['agent', String(agentId)] })
      qc.invalidateQueries({ queryKey: ['agents'] })
      if (!clear) setOpen(false)
    } catch (e) {
      setErr(e.message)
    } finally {
      setSaving(false)
    }
  }

  if (!open) return (
    <Btn size="sm" tone="ghost" onClick={() => setOpen(true)}>
      🔌 {endpoint ? '改服务地址' : '登记服务地址'}
    </Btn>
  )
  return (
    <div className="space-y-2">
      <input
        className={inputCls}
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="https://your-agent.example.com （需实现 GET /health + POST /run）"
      />
      {err && <div className="text-xs text-rose">❌ {err}</div>}
      {probe === 'cleared' && <div className="text-xs text-amber">已撤下服务地址（回到无执行体状态）</div>}
      {probe && probe !== 'cleared' && (
        <div className={`text-xs ${probe.reachable ? 'text-mint' : 'text-amber'}`}>
          {probe.reachable ? `🟢 平台已探活 /health（${probe.detail}）——派单通道就绪` : `🔴 探活失败（${probe.detail}）——地址已登记但派单会失败，请检查服务`}
        </div>
      )}
      <div className="flex gap-2">
        <Btn size="sm" tone="cyan" disabled={saving || !url.trim()} onClick={() => save(false)}>
          {saving ? '⏳ 登记中…' : '登记并探活'}
        </Btn>
        {endpoint && <Btn size="sm" disabled={saving} onClick={() => save(true)}>撤下</Btn>}
        <Btn size="sm" onClick={() => setOpen(false)}>取消</Btn>
      </div>
    </div>
  )
}
