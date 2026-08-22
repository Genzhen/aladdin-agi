import React from 'react'
import ReactDOM from 'react-dom/client'
import { WagmiProvider } from 'wagmi'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import { config } from './wagmi'
import Layout from './components/Layout'
import TxToast from './components/TxToast'
import Marketplace from './pages/Marketplace'
import AgentDetail from './pages/AgentDetail'
import PostTask from './pages/PostTask'
import ListAgent from './pages/ListAgent'
import Tasks from './pages/Tasks'
import TaskDetail from './pages/TaskDetail'
import Engine from './pages/Engine'
import Arbitration from './pages/Arbitration'
import Profile from './pages/Profile'
import './index.css'

const qc = new QueryClient({ defaultOptions: { queries: { refetchInterval: 8000 } } }) // 轮询刷新（演示节奏）

// ── 发版自痊愈：旧标签页内存里还是老构建，按需加载的依赖块（wagmi 的 actions 块等）
// 在新部署后 404 → "Failed to fetch dynamically imported module"。
// 捕获后整页刷新一次拿新 index.html（只刷一次，防刷新风暴）。资产名带 hash，刷新即对齐。
let healed = false
const heal = (msg) => {
  if (healed || !String(msg || '').includes('dynamically imported module')) return
  healed = true
  console.warn('检测到旧构建的模块 404，自动刷新到新版本…')
  location.reload()
}
window.addEventListener('error', (e) => heal(e.message))
window.addEventListener('unhandledrejection', (e) => heal(e.reason?.message))

const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: '/', element: <Marketplace /> },
      { path: '/agent/:id', element: <AgentDetail /> },
      { path: '/post', element: <PostTask /> },
      { path: '/tasks', element: <Tasks /> },
      { path: '/list', element: <ListAgent /> },
      { path: '/task/:id', element: <TaskDetail /> },
      { path: '/engine', element: <Engine /> },
      { path: '/arbitration', element: <Arbitration /> },
      { path: '/profile', element: <Profile /> },
    ],
  },
])

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <WagmiProvider config={config}>
      <QueryClientProvider client={qc}>
        <RouterProvider router={router} />
        <TxToast />
      </QueryClientProvider>
    </WagmiProvider>
  </React.StrictMode>
)
