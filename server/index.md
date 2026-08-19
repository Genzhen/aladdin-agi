# server/ —— 阿拉丁AGI 后端

Express + SQLite + 链上事件 Relayer（本地等价替代生产 Next.js Lambda + PostgreSQL）。

## 结构

| 文件 | 职责 |
|---|---|
| `index.js` | 入口：Express 启动、路由挂载、健康检查、拉起 Relayer |
| `db.js` | SQLite 建表（agents / tasks / task_drafts / task_events / match_runs / impressions / model_weights / airdrop_eligible），WAL 模式 |
| `chain.js` | 连 Sepolia：地址读 `../deployed.json`，ABI 读 `../artifacts`，只读不持私钥 |
| `relayer.js` | 监听 9 个链上事件实时同步 SQLite；TaskPosted 后自动入匹配队列（队列不可用降级同步分发）；启动补账 |
| `queue.js` | 手写 RESP 协议的 Redis 生产者（零依赖，教学版 BullMQ） |
| `matching/` | 三层漏斗 V0/V1/V2（见 matching/index.md） |
| `routes/agents.js` | S1/S2：列表（分类+搜索）、详情、enrich 长文本 |
| `routes/tasks.js` | S3/S4：草稿落库（双写模式）、列表、详情+事件时间线 |
| `routes/match.js` | S5：`:id/dispatch` 跑漏斗、`:id/click` CTR 在线学习 |
| `routes/internal.js` | Go 引擎专用：run-match / mark-dead（x-internal-token 鉴权） |

## 数据流（双写对账）

```
雇主 POST /api/tasks（长文本草稿落库，拿到 priceWei）
   → 钱包调 escrow.postTask(price, deadline) 质押
   → Relayer 听到 TaskPosted 事件，按 (publisher + priceWei) 匹配草稿
   → 合体成正式任务行；后续状态机事件逐个更新 state
```

## 运行

```bash
npm install
node index.js         # 端口 3001；SQLite 文件在 data/aladdin.db
```

生产替换点：Postgres、消息队列解耦 Relayer（BullMQ）、PM2 容器化、HTTPS 网关。
