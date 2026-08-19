// 通用 UI 原子件（配深色主题）——页面只管拼装
export function Card({ children, className = '', onClick }) {
  return (
    <div
      onClick={onClick}
      className={`rounded-xl border border-line bg-night-2/80 p-4 shadow-lg shadow-black/20 ${onClick ? 'cursor-pointer hover:border-violet/50 transition-colors' : ''} ${className}`}
    >
      {children}
    </div>
  )
}

export function Btn({ children, onClick, disabled, tone = 'violet', size = 'md', className = '' }) {
  const tones = {
    violet: 'bg-violet hover:bg-violet/80 text-white',
    cyan: 'bg-cyan/20 hover:bg-cyan/30 text-cyan border border-cyan/40',
    mint: 'bg-mint/20 hover:bg-mint/30 text-mint border border-mint/40',
    rose: 'bg-rose/20 hover:bg-rose/30 text-rose border border-rose/40',
    ghost: 'bg-night-3 hover:bg-line text-slate-200',
  }
  const sizes = { sm: 'px-2.5 py-1 text-xs', md: 'px-4 py-2 text-sm' }
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`rounded-lg font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${tones[tone]} ${sizes[size]} ${className}`}
    >
      {children}
    </button>
  )
}

export function Tag({ children }) {
  return <span className="rounded bg-night-3 px-1.5 py-0.5 text-[11px] text-slate-400">{children}</span>
}

export function Badge({ children, cls = '' }) {
  return <span className={`rounded-full border px-2 py-0.5 text-[11px] ${cls}`}>{children}</span>
}

export function ScoreBar({ score }) {
  const pct = Math.min(100, Math.max(0, score))
  const tone = pct >= 70 ? 'bg-mint' : pct >= 40 ? 'bg-amber' : 'bg-rose'
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded bg-night-3">
        <div className={`h-full ${tone}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-slate-400">{(pct / 100).toFixed(2)}</span>
    </div>
  )
}

export function Empty({ children = '暂无数据' }) {
  return <div className="rounded-xl border border-dashed border-line p-8 text-center text-sm text-slate-500">{children}</div>
}

export function Field({ label, hint, children }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-medium text-slate-400">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-slate-500">{hint}</span>}
    </label>
  )
}

export const inputCls =
  'w-full rounded-lg border border-line bg-night px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:border-violet focus:outline-none'
