# contracts/ —— 链上五合约（Solidity ^0.8.24 / OZ 5.6.1 / evmVersion cancun）

| 合约 | 行数 | 职责 | 关键设计 |
|---|---|---|---|
| `MyToken.sol` | 133 | ERC20 平台代币 MYT | faucet 增发+24h 冷却（mapping 记时间戳）；airdrop calldata 批量 + onlyOwner + 等长校验；空投常量（上架10/发单5/完单20 ether） |
| `AgentRegistry.sol` | ~90 | Agent 上架登记簿 | struct Agent{owner,name,category,tags,pricePerRun,score 0~100,exists}；nextId 从 1；updateScore 仅 owner |
| `TaskEscrow.sol` | 262 | ★任务状态机+资金托管 | enum State{Matching,Running,Review,Settled,Disputed,Cancelled}；bps 整数费率 FEE 10/DEPOSIT 600/ARBITRATION 50；`msg.value == price+fee` 精确相等 fail fast；跨合约 registry.ownerOf 校验接单身份；CEI + nonReentrant + call 转账；claimTimeout permissionless |
| `YidengToken.sol` | 65 | ERC20 陪审资格币 YD（2026-08-22） | 首发 100 万给部署者；faucet 一次 100 YD/24h——恰好一张陪审门票；airdrop onlyOwner 给陪审员补币。MYT=干活奖励，YD=治理/陪审资格：**权力要有价格，奖励不该赋权** |
| `JuryCourt.sol` | 300 | ★★去中心化陪审法庭（2026-08-22） | 见下节 |

## JuryCourt 机制速览（第 11 步核心）

**流程**：Disputed 任务 → `openCase`（任何人）从陪审池随机抽 3 人（排除双方当事人、排除在审陪审员）→ 600s 投票窗（`castVote` 明票）→ `closeCase`（任何人：三票齐或到期）→ 调 `escrow.executeRuling`（法庭已是 escrow owner）→ 多数方平分 0.5% 仲裁费（ETH）+ 各 10 YD 奖励；**严格多数**（>2 票）才发奖/罚没，少数方质押 slash 15%；平局（1-1-1）或零票 = Split，不奖不罚——真平局没人"错"。

**博弈设计**：陪审员赚 YD + ETH 仲裁费；乱裁决被多数方否决 → 罚没质押。经济激励替代平台信用背书。slash 的 YD 留在合约里回流奖池（越审越多）。

**生产替换点**（合约头注释有同款）：抽签种子 `keccak(prevrandao,timestamp,blockNumber,taskId)` → Chainlink VRF；明票 → commit-reveal 两阶段（防跟票）；陪审池规模小 → 加轮换冷却/分层抽签。

**升级路径的巧劲**：escrow 接口零改动——只 `transferOwnership(court)`，法庭代替平台 owner 调 `executeRuling`，`TaskRuled` 事件照常发出 → Relayer 结算/空投/rescore **一行没改**。法庭还有 `returnEscrowOwnership` 演示保险丝。⚠️ 法庭必须有 `receive()`，否则 escrow 的 ETH 分账打进来就 revert、案子永久卡死。

## 部署（Sepolia）

| 合约 | 地址 | 部署日 |
|---|---|---|
| MyToken | `0xA1250f0B4d812E04610Ad33e13ff1741cA21Fee0` | 2026-08-17 |
| AgentRegistry | `0xCac00e365368bCA444fA1d493eD17Df0F506e7b1` | 2026-08-17 |
| TaskEscrow | `0xa934CAA9D6D0e2ca68985A775A482091390Cf6aa` | 2026-08-17 |
| YidengToken | `0xB14CcEd2ee774c51ac98b7f72f1D62Be86506409` | 2026-08-22 |
| JuryCourt | `0x8fa498A43d7F6A87caa594735F305b1B8D8ba7f4` | 2026-08-22 |

地址单一来源：项目根 `deployed.json`（deploy 脚本产物）。均已在 Etherscan 开源验证（选 cancun）。
⚠️ **TaskEscrow 的 owner 已移交 JuryCourt**（2026-08-22）——平台旧的三按钮裁决现在会 revert，属预期；真裁决走法庭。`scripts/seed-jurors.js` 建的 3 个陪审员私钥在根目录 `.jurors-demo.json`（gitignore，勿提交）。

## 测试

```bash
npx hardhat test     # 45 用例全绿（MyToken 9 + Registry 6 + Escrow 15 + JuryCourt 15）
```

## 改合约后重部署

```bash
npx hardhat run scripts/deploy.js --network sepolia        # 老三件
npx hardhat run scripts/deploy-jury.js --network sepolia   # 法庭两件（会转移 escrow 所有权 + 灌 5000 YD 奖池）
NODE_USE_ENV_PROXY=1 https_proxy=http://127.0.0.1:7890 npx hardhat verify ...  # 每个合约一条
```
⚠️ server/ 与 app/src/lib/contracts.js 里的地址要同步更新。
