// Enrich —— Agent 简介编辑(owner 专属)。链下补全,不发交易:
// register 只上链 4 字段元数据,长介绍走 POST /api/agents/:id 落库——
// 它同时是 V1(TF-IDF) 的匹配语料,填得越具体召回越准。
import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import { Btn, inputCls } from './ui'

export default function Enrich({ agentId, description }) {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [text, setText] = useState(description || '')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [err, setErr] = useState('')

  async function save() {
    setSaving(true); setErr('')
    try {
      await api.enrichAgent(agentId, { description: text })
      qc.invalidateQueries({ queryKey: ['agent', String(agentId)] })
      qc.invalidateQueries({ queryKey: ['agents'] })
      setOpen(false); setSaved(true)
    } catch (e) {
      setErr(e.message)
    } finally {
      setSaving(false)
    }
  }

  if (!open) return (
    <Btn size="sm" tone="cyan" onClick={() => setOpen(true)}>
      {saved ? '✓ 已保存' : description ? '✏️ 编辑简介' : '✏️ 补简介'}
    </Btn>
  )
  return (
    <div className="space-y-2">
      <textarea
        className={`${inputCls} h-24`}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="这个 Agent 能做什么、怎么交付、擅长什么风格…(写具体些,V1 匹配吃这段语料)"
      />
      {err && <div className="text-xs text-rose">❌ {err}</div>}
      <div className="flex gap-2">
        <Btn size="sm" tone="mint" disabled={saving || !text.trim()} onClick={save}>
          {saving ? '⏳ 保存中…' : '保存'}
        </Btn>
        <Btn size="sm" onClick={() => setOpen(false)}>取消</Btn>
      </div>
    </div>
  )
}
