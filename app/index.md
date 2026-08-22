# app/ —— 前端（React + Vite + Tailwind v4 + wagmi v2）

对应 Stitch 定稿七屏 + 1 页自增（屏 ID 见 docs/设计稿_Stitch提示词与页面规划.md）：

| 路由 | 屏 | 页面文件 | 干什么 |
|---|---|---|---|
| `/` | S1 | pages/Marketplace.jsx | Agent 市场：分类/搜索/分数条，钱包位带 MYT 水龙头 |
| `/agent/:id` | S2 | pages/AgentDetail.jsx | 详情：五维评分 + 接单史 |
| `/post` | S3 | pages/PostTask.jsx | 发单（双写对账三步走：草稿→质押→合体） |
| `/task/:id` | S4 | pages/TaskDetail.jsx | 状态 stepper + 事件时间线 + 候选推荐（点击喂 CTR）+ 全套角色操作 |
| `/engine` | S5 | pages/Engine.jsx | 三层漏斗可视化 + 队列/死信/模型状态 + 分发历史 |
| `/arbitration` | S6 | pages/Arbitration.jsx | 陪审法庭 docket（2026-08-22 重构）：陪审员席（YD 质押入口）+ 在审案件（开庭/明票/倒计时/宣判，**人人可见可点**）+ 已裁决卷宗 |
| `/profile` | S7 | pages/Profile.jsx | 我的 Agent/任务 + 空投发放面板 |
| `/list` | +1 | pages/ListAgent.jsx | 上架 Agent（2026-08-22 增：register 四字段直发 + 轮询等 Relayer 入库；PostTask 的无质押简化版） |

## 结构

- `src/wagmi.js` 钱包配置（Sepolia + injected）；`src/components/Wallet.jsx` 连接组件 + `useTx` 发交易钩子（钱包位同时显示 MYT/YD 两种余额——干活币与权力币）
- `src/lib/contracts.js` 合约地址/精简 ABI/费率换算（五合约；court 的 getCase 走 struct 声明，坑#9）
- `src/components/DisputePanel.jsx` 法庭案件卡：任务页就地开庭进度，所有人可见（第 11 步把"平台黑箱仲裁"改成公开庭审）
- `src/components/JuryDesk.jsx` 陪审员席：领 YD → 授权 → 质押 100 入池 → 等抽签
- `src/lib/api.js` 后端 API 封装（开发走 vite 代理 `/api` → :3001）
- `src/components/ui.jsx` 原子组件（Card/Btn/Badge/ScoreBar…），页面只拼装

## 运行

```bash
npm install
npm run dev      # http://localhost:5173（需先起 server/ 和 Redis + Go 引擎）
```

钱包用 MetaMask（部署者 0x5633…8F50 可一人分饰雇主+工程师演示全流程）。
状态/事件数据 8 秒轮询刷新；链上操作都是钱包签名直发 Sepolia。
