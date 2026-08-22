import React from 'react'
import ReactDOM from 'react-dom/client'
import { WagmiProvider } from 'wagmi'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import { config } from './wagmi'
import Layout from './components/Layout'
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
      </QueryClientProvider>
    </WagmiProvider>
  </React.StrictMode>
)
