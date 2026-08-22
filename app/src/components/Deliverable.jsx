// Deliverable.jsx —— 交付物卡片：视觉交付物解锁后直接渲染，不再只给一坨代码
//   SVG   → <img dataURI> 直接成图（img 上下文里 SVG 脚本不执行，安全）
//   网站  → sandbox iframe 活预览（可交互；不给 allow-same-origin=摸不到父页面）
//   截断  → 维持源码样章 <pre>——防白嫖门控（结算前只放 200 字）在前端的表现
import { timeAgo } from '../lib/format'
import { Card } from './ui'

// 内容判型：出口约定来自执行体（<svg…</svg> / <!DOCTYPE html…</html>）
function classify(output, truncated) {
  if (truncated) return { kind: 'text' }
  const raw = String(output)
  const svgEnd = raw.indexOf('</svg>')
  if (raw.trimStart().startsWith('<svg') && svgEnd > 0) {
    return { kind: 'svg', svg: raw.slice(raw.indexOf('<svg'), svgEnd + 6) }
  }
  const htmlEnd = raw.toLowerCase().lastIndexOf('</html>')
  if (/^\s*(<!doctype html|<html)/i.test(raw) && htmlEnd > 0) {
    return { kind: 'html', html: raw.slice(0, htmlEnd + 7) }
  }
  return { kind: 'text' }
}

// --- 分隔符后面的设计说明 / 构建报告
const notesOf = (output) => {
  const raw = String(output)
  const i = raw.indexOf('\n---\n')
  return i > 0 ? raw.slice(i + 5).trim() : ''
}

const srcPre = (text) => (
  <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-lg border border-line bg-night/50 p-3 font-mono text-xs leading-relaxed text-slate-300">{text}</pre>
)

export function Deliverable({ dv }) {
  if (!dv) return null
  const c = classify(dv.output, dv.truncated)
  const notes = dv.ok ? notesOf(dv.output) : ''

  return (
    <Card className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">{dv.manual ? '🧑‍🔧 手动交付 · 工程师补救的活' : `📦 交付物 · Agent #${dv.agentId} 的真实产出`}</h2>
        <span className="text-[11px] text-slate-500">{timeAgo(dv.createdAt)}</span>
      </div>

      {!dv.ok ? (
        <div className="rounded-lg border border-rose/30 bg-rose/10 p-3 text-xs text-rose">
          ❌ 执行体失败：{dv.error}（任务仍在进行中——接单钱包在下方操作区「手动交付补救」）
        </div>
      ) : c.kind === 'svg' ? (
        <div className="space-y-2">
          <div className="flex justify-center overflow-hidden rounded-lg border border-line bg-white p-2">
            <img src={`data:image/svg+xml;utf8,${encodeURIComponent(c.svg)}`} alt="SVG 视觉交付物" className="max-h-[560px] w-auto max-w-full" />
          </div>
          {notes && <div className="whitespace-pre-wrap rounded-lg border border-line bg-night/50 p-3 text-xs leading-relaxed text-slate-400">{notes}</div>}
          <details><summary className="cursor-pointer text-[11px] text-slate-500">查看 SVG 源码</summary>{srcPre(c.svg)}</details>
        </div>
      ) : c.kind === 'html' ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-[11px] text-slate-500">
            <span>单文件网站 · 沙箱预览（可交互）</span>
            <button
              className="text-cyan hover:underline"
              onClick={() => window.open(URL.createObjectURL(new Blob([c.html], { type: 'text/html' })), '_blank')}
            >🔗 新窗口全屏打开</button>
          </div>
          <iframe title="网站交付物预览" sandbox="allow-scripts" srcDoc={c.html} className="h-[520px] w-full rounded-lg border border-line bg-white" />
          {notes && <div className="whitespace-pre-wrap rounded-lg border border-line bg-night/50 p-3 text-xs leading-relaxed text-slate-400">{notes}</div>}
          <details><summary className="cursor-pointer text-[11px] text-slate-500">查看 HTML 源码</summary>{srcPre(c.html)}</details>
        </div>
      ) : (
        <div className="space-y-2">
          {srcPre(dv.output)}
        </div>
      )}

      {dv.ok && dv.truncated && (
        <div className="rounded-lg border border-amber/30 bg-amber/10 p-3 text-xs text-amber">
          🔒 样章预览（前 {dv.previewChars} 字）——验收打款或仲裁裁决后解锁全文{c.kind === 'text' ? '' : '并渲染成品'}
        </div>
      )}
    </Card>
  )
}
