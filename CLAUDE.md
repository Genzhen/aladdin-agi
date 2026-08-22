# CLAUDE.md —— 阿拉丁AGI 工程约定（课堂 cloud.md 的落地）

## 这是什么项目

AI Agent 分发平台（双边市场）：工程师上架 Agent（链上登记）、雇主发任务质押 ETH、
三层匹配漏斗推荐 Top3、托管结算 + 仲裁 + MYT 空投。
课程阶段 3 实战，两周 MVP，面试展示用——**所有设计决策都要"能讲出来"**。

## 目录与职责

| 目录 | 是什么 | 技术栈 |
|---|---|---|
| `contracts/` | 三合约：MyToken / AgentRegistry / TaskEscrow | Solidity + Hardhat 2.29 + OZ 5.6.1 |
| `agents/` | 9 个 Agent 执行体（9001~9009：手写版 + 3 个 Mastra 版[title 单工具/image 双工具/web Workflow] + L3 自持钥 xhs-agent）；manifest.js 单一清单，心跳自报到自动接线 | 零依赖 node:http + Mastra |
| `server/` | API + Relayer + 匹配引擎 + agent-runner（派活给执行体） | Express 4 + better-sqlite3 + ethers 6 |
| `server/matching/` | 三层漏斗 V0/V1/V2（手写 TF-IDF、手写逻辑回归） | 纯 JS 零依赖 |
| `engine-go/` | 队列消费者（重试+死信） | Go，零第三方依赖（手写 RESP） |
| `app/` | 前端七屏 | Vite + React 19 + Tailwind v4 + wagmi v2 |
| `docs/` | PRD / 设计稿 / 总结 / 复盘指南 / 理解题清单 | — |

## 硬性工程红线（作业评分项）

- 单文件 ≤ 300 行（React 组件 ≤ 200 行）；函数 ≤ 50 行
- **每个目录必须配 index.md**（说清楚这个目录是什么、为什么这么拆）
- 金额一律整数：链上 wei（BigInt），库里 TEXT，展示层才转浮点
- 测试：合约 30 用例（`npx hardhat test`）、匹配 8 用例（`cd server && node --test`）、Go `go build ./... && go vet`
- 所有"生产替换点"写在代码注释里（SQLite→PG、手写 RESP→go-redis、TF-IDF→语义向量…）

## 常见坑速查（本项目真实踩过）

1. **BigInt 混算**（踩了 4 次）：表达式里出现一个 `n` 后缀，**整行每一项**都得是 BigInt。
   `time.latest()`/`Date.now()/1000`/普通数字字面量与 BigInt 相加前先 `BigInt()`。
2. chai 快照型匹配器（changeTokenBalances/changeEtherBalances）不能链在 emit 后——拆两条 expect，交易 Promise 存变量。
3. Hardhat 2.29 不自动加载 .env——`npm i dotenv` + 顶部 `require("dotenv").config()`。
4. Node fetch 不走系统代理——verify 前缀 `NODE_USE_ENV_PROXY=1 https_proxy=http://127.0.0.1:7890`。
5. OZ 5.6.1 要 `evmVersion: "cancun"`（mcopy 指令），Etherscan 验证也选 cancun。
6. **不要静默吞 try/catch**（`catch {}`）：空投记账 bug 因此藏了半小时。至少 console.error。
7. ethers v6 事件监听里 blockNumber 在 `ev.log.blockNumber`，不是 `ev.blockNumber`。
8. better-sqlite3 `run()` 返回 `{changes}` 对象——计数用 `.changes`，别直接相加。
9. **viem human-readable ABI 里不能内联 `tuple(...)`**（带不带字段名都炸 InvalidParameterError）——
   要先写一行 `'struct X { … }'` 声明，签名里按名字引用 `returns (X)`；且 parseAbi 是运行时执行，
   `npm run build` 抓不到，**首屏加载才炸**（验证法：node --input-type=module 里 import 一遍）。
10. **部署打包别拿 .gitignore 当排除清单**：`artifacts/` 被 git 忽略，但 `server/chain.js`
    运行时要读它拿 ABI——AWS 首次部署因此崩了 10 连重启（ENOENT artifacts/…/AgentRegistry.json）。
    想清单一律按"运行时要 load 什么"过一遍，不是按"git 不收什么"。
11. **server 测试用 `node --test`，别 `npx vitest run`**：套件是 node:test 风格，
    vitest 报 "No test suite found" 白等两分钟。
12. **rsync 必须显式排除 `server/data` 和 `.env`**：线上库有自己的链下状态
    （星级/评分/曝光），本地覆盖=丢数据。以前没炸只是 rsync 按 mtime 跳过——运气不是机制。
13. **本地 Clash TUN 开着时，SSH/rsync 到 AWS 的 22 口可能被代理出口节点拒**
    （症状=banner exchange 超时，TCP"通"是 Clash 本地应答的假象；GitHub 22 口同样死可作判据）。
    变量在节点端（订阅轮换/自动选择换了出口），本机与 AWS 都没问题。永久解=服务器 sshd
    加听 443 + 安全组放行 443，一律 `ssh -p 443` / `rsync -e "ssh -p 443 …"`——
    443 是任何代理节点必转的端口（本机 GitHub 走 443 通道是同一道理的先例）。

## 一键起全套

```bash
brew services start redis                                   # 队列
node agents/start-all.js &                                  # 7 个 Agent 执行体 9001~9007
cd server && node index.js &                                # API+Relayer :3001
cd engine-go && go run . &                                  # 分发引擎
cd app && npm run dev                                       # 前端 :5173
node scripts/wire-agents.js                                 # 诊断工具（接线已全自动：执行体自报到+链上事件双向对账）
```

链上操作钱包 = 部署者 `0x5633…8F50`（owner），私钥在根 `.env`（勿提交）。
