# 阿拉丁AGI · AI Agent 分发平台

> 课程阶段 3 实战 · 两周 MVP · Sepolia 测试网 · 2026-08-16 ~ 08-18
> 工程师上架 AI Agent，雇主发任务质押 ETH，三层匹配漏斗推荐 Top3，托管合约按状态机结算，仲裁与 MYT 空投闭环。

## 一分钟看懂

- **链上**（Solidity ^0.8.24 / OZ 5.6.1，已 Etherscan 验证）：`MyToken`（faucet+airdrop）、`AgentRegistry`（上架登记）、`TaskEscrow`（状态机+资金托管+仲裁 ★）
- **后端** `server/`（Express + SQLite + ethers）：REST API、Relayer 监听 9 事件同步库（链=真相源）、三层匹配引擎（V0 tag 召回 → V1 手写 TF-IDF → V2 手写逻辑回归 CTR 在线学习）、五维评分、空投记账
- **队列** `engine-go/`（Go 零依赖）：手写 RESP 连 Redis，BRPOP 消费匹配任务，指数退避重试 → 死信队列
- **前端** `app/`（Vite + React 19 + Tailwind v4 + wagmi v2）：市场/详情/发单/任务/引擎/仲裁/我的 七屏

## 快速开始

**🌐 在线版（AWS 免费额度内部署，直接看）**：<http://44.195.92.47:3001>
（浏览器装 MetaMask + 切 Sepolia 即可发单/接单；只浏览不需要钱包）

**本地跑**：

```bash
# 前置：Node 20+、Go 1.26+、redis（brew services start redis）、根目录 .env（RPC/私钥/Etherscan key）
cd server && npm i && node index.js &      # API + Relayer :3001
cd engine-go && go run . &                  # 队列消费者
cd app && npm i && npm run dev              # 前端 :5173
```

## 文档导航

| 想做什么 | 看哪里 |
|---|---|
| **从头学一遍（推荐入口）** | `docs/复盘指南.md` |
| 项目需求对照 / 面试话术 / 踩坑 | `docs/项目总结_阿拉丁AGI.md` |
| 架构分层图 | `docs/架构图_阿拉丁AGI.svg` |
| 理解题（结业自测） | `docs/理解题_待答清单.md` |
| 工程红线 / 常见坑速查 | `CLAUDE.md` |
| 每个目录的设计说明 | 各目录 `index.md`（7 份） |

## 测试

```bash
npx hardhat test              # 合约 30 用例
cd server && node --test      # 匹配引擎 8 用例
cd app && npm run build       # 前端构建
cd engine-go && go vet ./...  # Go 静态检查
```

## 合约地址（Sepolia，单一来源 `deployed.json`）

| 合约 | 地址 |
|---|---|
| MyToken | `0xA1250f0B4d812E04610Ad33e13ff1741cA21Fee0` |
| AgentRegistry | `0xCac00e365368bCA444fA1d493eD17Df0F506e7b1` |
| TaskEscrow | `0xa934CAA9D6D0e2ca68985A775A482091390Cf6aa` |
