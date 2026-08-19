# CLAUDE.md —— 阿拉丁AGI 工程约定（课堂 cloud.md 的落地）

## 这是什么项目

AI Agent 分发平台（双边市场）：工程师上架 Agent（链上登记）、雇主发任务质押 ETH、
三层匹配漏斗推荐 Top3、托管结算 + 仲裁 + MYT 空投。
课程阶段 3 实战，两周 MVP，面试展示用——**所有设计决策都要"能讲出来"**。

## 目录与职责

| 目录 | 是什么 | 技术栈 |
|---|---|---|
| `contracts/` | 三合约：MyToken / AgentRegistry / TaskEscrow | Solidity + Hardhat 2.29 + OZ 5.6.1 |
| `server/` | API + Relayer + 匹配引擎 | Express 4 + better-sqlite3 + ethers 6 |
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

## 一键起全套

```bash
brew services start redis                                   # 队列
cd server && node index.js &                                # API+Relayer :3001
cd engine-go && go run . &                                  # 分发引擎
cd app && npm run dev                                       # 前端 :5173
```

链上操作钱包 = 部署者 `0x5633…8F50`（owner），私钥在根 `.env`（勿提交）。
