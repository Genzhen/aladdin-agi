// 全局布局：顶栏导航（七屏路由）+ 钱包位 + 内容区
import { NavLink, Outlet } from 'react-router-dom'
import { WalletChip } from './Wallet'

const NAV = [
  { to: '/', label: '市场', end: true },
  { to: '/post', label: '发布任务' },
  { to: '/tasks', label: '任务大厅' },
  { to: '/engine', label: '匹配引擎' },
  { to: '/arbitration', label: '仲裁' },
  { to: '/profile', label: '我的' },
]

export default function Layout() {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-line bg-night/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3">
          <NavLink to="/" className="flex items-center gap-2">
            <span className="text-xl">🪔</span>
            <span className="font-bold tracking-wide">
              阿拉丁<span className="text-violet">AGI</span>
            </span>
            <span className="hidden text-[10px] text-slate-500 sm:inline">Agent 分发平台 · Sepolia</span>
          </NavLink>
          <nav className="flex flex-1 gap-1 overflow-x-auto">
            {NAV.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.end}
                className={({ isActive }) =>
                  `whitespace-nowrap rounded-lg px-3 py-1.5 text-sm transition ${
                    isActive ? 'bg-violet/20 text-violet' : 'text-slate-400 hover:text-slate-200'
                  }`
                }
              >
                {n.label}
              </NavLink>
            ))}
          </nav>
          <WalletChip />
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">
        <Outlet />
      </main>
      <footer className="border-t border-line py-6 text-center text-xs text-slate-600">
        课程阶段 3 实战 · 合约 + 后端 + 匹配引擎 + Go 分发 全部可查 Etherscan
      </footer>
    </div>
  )
}
