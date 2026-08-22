# scripts/ —— 一次性运维/演示/种子脚本（都在项目根用 npx hardhat run 或 node 直接跑）

**链上写操作要真 gas**：统一 `env -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u NODE_USE_ENV_PROXY node scripts/xxx.js`（本机代理会劫持 RPC）。

| 脚本 | 干什么 | 什么时候用 |
|---|---|---|
| `deploy.js` | 部署老三件（MyToken/Registry/Escrow）→ 重写 deployed.json | 换环境重开 |
| `deploy-jury.js` | 部署 YD + JuryCourt → **escrow 所有权移交法庭** → 灌 5000 YD 奖池 | 第 11 步起 |
| `seed-agents*.js` | 三轮 Agent 种子（1~3 执行体 / round2 挂牌 / round3 含 Mastra 双雄） | 空环境初始化 |
| `seed-jurors.js` | 生成 3 个陪审员钱包存 `.jurors-demo.json`（gitignore）：各给 gas + 150 YD + 质押 100，幂等 | 法庭演示前 |
| `demo-flow.js` | 全链路冒烟：发单→接单→提交→验收→空投 | 讲解主线用 |
| `demo-jury.js` | 陪审法庭端到端：开庭抽签→三票 2v1→宣判→链上核验奖罚，**幂等可续跑** | 讲第 11 步用（真案 #19 就是它跑的） |
| `demo-mastra-flow.js` | 走 Mastra 双 Agent（出图/建站）的演示链路 | 讲第 14 站用 |
| `airdrop.js` | 给 airdrop_eligible 里待发地址批量空投 MYT | 平台例行发放 |
| `escrow-admin.js` | escrow 管理动作（超时回收等兜底） | 运维兜底 |
| `wire-agents.js` | 执行体↔链上登记 手动接线（现自动，留作诊断） | 排查 endpoint 不亮 |
| `check-disputed.js` | 扫链上 Disputed 任务（找可开庭的真案） | 演示前找料 |
| `post-demo-task.js` / `smoke-agent-online.js` / `l3-e2e-test.js` | 发演示任务 / 线上冒烟 / L3 自持钥端到端 | 各自章节 |
