# contracts/ —— 链上三合约（Solidity ^0.8.24 / OZ 5.6.1 / evmVersion cancun）

| 合约 | 行数 | 职责 | 关键设计 |
|---|---|---|---|
| `MyToken.sol` | 133 | ERC20 平台代币 MYT | faucet 增发+24h 冷却（mapping 记时间戳）；airdrop calldata 批量 + onlyOwner + 等长校验；空投常量（上架10/发单5/完单20 ether） |
| `AgentRegistry.sol` | ~90 | Agent 上架登记簿 | struct Agent{owner,name,category,tags,pricePerRun,score 0~100,exists}；nextId 从 1；updateScore 仅 owner |
| `TaskEscrow.sol` | 262 | ★任务状态机+资金托管 | enum State{Matching,Running,Review,Settled,Disputed,Cancelled}；bps 整数费率 FEE 10/DEPOSIT 600/ARBITRATION 50；`msg.value == price+fee` 精确相等 fail fast；跨合约 registry.ownerOf 校验接单身份；CEI + nonReentrant + call 转账；claimTimeout permissionless（任何人可调，钱按规则路由给 publisher） |

## 部署（Sepolia，2026-08-17）

| 合约 | 地址 |
|---|---|
| MyToken | `0xA1250f0B4d812E04610Ad33e13ff1741cA21Fee0` |
| AgentRegistry | `0xCac00e365368bCA444fA1d493eD17Df0F506e7b1` |
| TaskEscrow | `0xa934CAA9D6D0e2ca68985A775A482091390Cf6aa` |

地址单一来源：项目根 `deployed.json`（deploy 脚本产物）。均已在 Etherscan 开源验证（选 cancun）。

## 测试

```bash
npx hardhat test     # 30 用例全绿（MyToken 9 + Registry 6 + Escrow 15）
```

## 改合约后重部署

```bash
npx hardhat run scripts/deploy.js --network sepolia   # 会重写 deployed.json
NODE_USE_ENV_PROXY=1 https_proxy=http://127.0.0.1:7890 npx hardhat verify ...  # 每个合约一条
```
⚠️ server/ 与 app/src/lib/contracts.js 里的地址要同步更新。
