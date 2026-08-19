# 项目总结 · 阿拉丁AGI（AI Agent 分发平台）

> 课程阶段 3 线下实战 · 两周 MVP · 2026-08-16 ~ 08-18 完成
> 一句话：工程师把 AI Agent 上架到链上，雇主发任务质押 ETH，三层匹配漏斗推荐 Top3，托管合约按状态机结算，仲裁与空投闭环。

## 1. 作业 8 条需求对照表（全部落地）

| # | 需求 | 落地 | 验证方式 |
|---|---|---|---|
| 1 | Agent 上架（key 打码） | `AgentRegistry.register`（name/category/tags/pricePerRun）+ Relayer 同步库 + S1 卡片（地址缩写展示=打码） | 3 个 Agent 已在 Sepolia 注册 |
| 2 | 任务发布 MetaMask 质押 | S3 表单 → POST 草稿 → 钱包 `postTask(price, deadline) payable`（value=price+0.1%）| 任务#1~#3 链上可查 |
| 3 | 匹配 V0（tag 硬匹配+洗牌选3+冷启动） | `server/matching/v0.js`：tag/category 交集召回 + Fisher-Yates + 冷启动全量兜底 | 单测 3 例 + 任务#2/#3 实跑 |
| 4 | 匹配 V1（向量检索） | `v1.js` 手写 TF-IDF + 余弦 TopK（不调库，写穿原理） | 单测 2 例（含 cosine 数学性质回归） |
| 5 | 匹配 V2（在线学习 CTR） | `v2.js` 手写逻辑回归 + SGD；曝光/点击落库；点击即在线微调权重（持久化 model_weights） | 任务#2 点击后 pCTR 0.5→0.5666，任务#3 复用已训权重 0.5728 |
| 6 | 五维评分 | `scoring.js`：质量70/速度15/价格10/响应5 加权，结算事件自动触发，后端 admin 签名者 `updateScore` 上链 | Agent#1 链上 score=100（tx 0x8f78…） |
| 7 | 仲裁委员会 | `openDispute` 冻结 → owner `executeRuling` 三选一（AgentWins/PublisherWins/Split）；S6 页面裁决 | 任务#2 走完 Disputed→Split→Settled |
| 8 | 空投 | Relayer 记账（上架+10/发单+5/完单+20 MYT）→ owner 批量 `airdrop` → mark-sent 销账 | 80 MYT 已发（tx 0x2c04…），账本清零 |

附加完成：接单质押 6% 保证金、超时 permissionless 兜底 `claimTimeout`、死信队列（重试 3 次指数退避）、启动补账（链为真相源重建库）。

## 2. 架构分层

```
浏览器 (app/ :5173, React+wagmi)
   │ 读: publicnode RPC 直连合约   写: MetaMask 签名
   │ 读写长文本/搜索: HTTP → server/ :3001
后端 (Express + SQLite + Relayer)
   ├── Relayer 监听 9 链上事件 → 同步库（链=真相源，库=可重建缓存）
   ├── 匹配引擎 matching/ (V0→V1→V2 漏斗) + scoring + 空投记账
   └── queue.js 手写 RESP → Redis list
Go 引擎 (engine-go/)
   └── BRPOP → POST /internal/run-match → 重试3次 → 死信
链上 (Sepolia)
   └── MyToken + AgentRegistry + TaskEscrow（Etherscan 已验证）
```

（完整图见 `架构图_阿拉丁AGI.svg`）

## 3. 关键设计决策（面试话术）

- **为什么三层漏斗**：召回要便宜（tag 硬匹配全量跑得起）、精排要准（TF-IDF 砍掉不相关）、重排要懂业务（CTR 反馈闭环）。每层解决上一层的遗留问题。
- **为什么金额全用 bps 整数**：Solidity 无浮点，0.1%/6%/0.5% = 10/600/50 per 10000；JS 侧 BigInt，库 TEXT，展示层才转浮点。
- **为什么双写对账**：长文本上链太贵 → 先落库草稿拿 priceWei，钱包质押同一价格，Relayer 按（publisher+priceWei）合体。价格就是天然对账钥匙。
- **为什么 permissionless 超时**：退款地址写死 `t.publisher`（发布时的链上记录），任何人可调 `claimTimeout` 却偷不走钱——Web2 信任"谁调接口"，链上信任"规则本身"。
- **为什么手写协议/算法**：TF-IDF、逻辑回归、RESP 三样都手写——面试能从公式讲到代码；生产替换点全部注释在代码里。
- **链下库丢了怎么办**：启动补账按链重建（agents/impressions 聚合分也能重算）——高可用来自"单一真相源"。

## 4. 踩坑记录（全部真实发生）

| # | 坑 | 教训 |
|---|---|---|
| 1 | BigInt 混算 ×4（测试×2、demo-flow、relayer MYT()） | 一行里有一个 `n`，全行都得 BigInt；最后一处还被 try/catch 吞成静默失败——**别写空的 catch** |
| 2 | chai 快照匹配器不能链 emit | changeEtherBalances 类必须当链首；交易 Promise 存变量可多次 await |
| 3 | Hardhat 2.29 不读 .env | dotenv 要自己装自己 require |
| 4 | Node fetch 不走 Clash 代理 | verify 加 `NODE_USE_ENV_PROXY=1 https_proxy=…` |
| 5 | OZ 5.6.1 要 cancun | config 和 Etherscan 都要选 |
| 6 | 事件里没带 tags | 事件省体积是常见取舍——监听器回链上 struct 补（冷知识：这也算"事件与存储的取舍"话术） |
| 7 | RESP 流式解析 | 半条回复到达时绝不能消费类型行，否则状态丢失（先窥视、够了再切） |
| 8 | 自造测试数据标签公式写反 | 模型学的方向"错"其实是数据错——先验证数据再怀疑算法 |

## 5. 遗留与生产化清单

- 陪审团仲裁（现在是 owner 直裁，接口已留）、Agent 密钥托管（现在是地址登记）
- 匹配引擎横向扩容（多 Go 实例 BRPOP 天然不重复）、SQLite→PG、Redis 单点→集群
- CI/CD（GitHub Actions 部署单机 pm2 同 Web3 大学方案）、E2E 测试
- PRD 里"仲裁 slash 15%"最终实现为"6% 保证金罚没赔雇主"（更简单自洽，文档以合约为准）

## 6. 复跑手册

见 `docs/复盘指南.md`（含学习路线，按它从零走一遍就是完整复盘）。
