// 展示层小工具：状态徽章配色 / 地址缩写 / 相对时间

export const STATES = {
  matching: { label: '匹配中', cls: 'bg-cyan/15 text-cyan border-cyan/30' },
  running: { label: '进行中', cls: 'bg-violet/15 text-violet border-violet/30' },
  review: { label: '待验收', cls: 'bg-amber/15 text-amber border-amber/30' },
  settled: { label: '已结算', cls: 'bg-mint/15 text-mint border-mint/30' },
  disputed: { label: '仲裁中', cls: 'bg-rose/15 text-rose border-rose/30' },
  cancelled: { label: '已取消', cls: 'bg-slate-500/15 text-slate-400 border-slate-500/30' },
  dead: { label: '死信', cls: 'bg-rose/15 text-rose border-rose/30' },
}

export const stateBadge = (s) => STATES[s] || { label: s, cls: 'bg-night-3 text-slate-300 border-line' }

export const shortAddr = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '—')

export const fmtEth = (n) => `${Number(n).toFixed(Number(n) < 0.01 ? 4 : 3)} ETH`

export const fmtPct = (p) => `${(p * 100).toFixed(1)}%`

export function timeAgo(iso) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return `${s | 0} 秒前`
  if (s < 3600) return `${(s / 60) | 0} 分钟前`
  if (s < 86400) return `${(s / 3600) | 0} 小时前`
  return `${(s / 86400) | 0} 天前`
}
