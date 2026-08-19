# PRD：阿拉丁AGI · AI Agent 分发平台

> 版本 v1.0 · 2026-08-16 · 依据：作业解读文档 + Stitch 设计稿评审定稿（7 屏）
> 定位：课程阶段 3 实战项目 MVP，两周，用于面试展示，**每一节都要能讲出来**

---

## 1. 产品概述

**一句话**：AI Agent 的任务市场——工程师上架 Agent，雇主发布任务并把出价**质押进智能合约**，平台用三层匹配算法挑 Agent 执行，验收后合约结算，争议走仲裁，全程 MYT 代币激励。

**Web2 类比**：猪八戒（撮合）+ 支付宝（escrow 托管）+ 搜索推荐（三层匹配）+ 客服小二（仲裁）+ 平台积分（空投）。

**角色**：
| 角色 | 干什么 | 收益 |
|---|---|---|
| 工程师（卖方） | 上架 Agent、接单执行 | 出价款 + 空投 |
| 雇主（买方） | 发布任务、质押、验收 | 交付物 + 空投 |
| 陪审员 | 质押 MYT 参与仲裁 | 仲裁费分成 |
| 平台 | 撮合 + 托管 | 0.1% 手续费 |

---

## 2. 页面清单（对应 Stitch 定稿，screen ID 备查）

| # | 页面 | 路由 | screen ID | 状态 |
|---|---|---|---|---|
| S1 | 市场首页 | `/` | f3957b0c | ✅ 已知瑕疵：余额 chip 显示 `$`，实现时改 `MYT` |
| S2 | Agent 详情 | `/agents/:id` | 0e7a26d5 | ✅ |
| S3 | 发布任务 | `/tasks/new` | 328b1f34 | ✅ |
| S4 | 任务详情 ★核心 | `/tasks/:id` | 3cf0a859 | ✅ 保证金 0.006 ETH 已画对 |
| S5 | 匹配看板 ★面试 | `/matching` | a704a7eb | ✅ 三列流水线 + 漏斗 1,024→156→12 |
| S6 | 个人中心 | `/profile` | 56e6c035 | ✅ 含 Juror Performance 卡 |
| S7 | 仲裁页（彩蛋） | `/arbitration` | 7ebb192a | ✅ 含证据/讨论/投票/slash 说明 |

设计稿中 76eb05ad 为跑偏的废屏，不采纳（建议在 Stitch 删除）。

---

## 3. 核心数据模型（链上存证 + 链下存储的分工）

**原则**：长文本/高频读写放后端 SQLite（便宜），关键事实（谁、多少钱、何时）上链（防篡改）。

### 3.1 Agent（上架的 Agent）
| 字段 | 类型 | 存哪 |
|---|---|---|
| id / owner | uint / address | 链上 AgentRegistry + 库 |
| name / category | string | 链上 + 库 |
| tags（逗号分隔，喂 V0/V1） | string[] | 库（链上存摘要） |
| description / authorIntro | text | 仅库 |
| pricePerRun（ETH 计价） | uint(wei) | 链上 + 库 |
| agentEndpoint（API 地址） | string | 库（私有） |
| status | Active / UnderReview / Delisted | 库 |
| 五维评分 | 见 §6 | 库（链上只存最终综合分） |

### 3.2 Task（发布的任务）
| 字段 | 类型 | 存哪 |
|---|---|---|
| id / publisher | uint / address | 链上 TaskEscrow + 库 |
| title / category / tags / description | text | 库（链上存 id 映射） |
| price（wei）+ fee(0.1%) | uint | 链上（质押金额是核心事实） |
| deadline / expertLevel(Junior/Senior/Expert) | uint / enum | 链上 + 库 |
| state | §4 状态机 | 链上（真相源），库做冗余索引 |
| candidates（匹配出的 3 个） | agentId[] + 三层分数 | 库 |
| chosenAgent / agentDeposit(6%) | uint / wei | 链上 |

### 3.3 Dispute（争议）与 Deliberation（陪审讨论）
案件：taskId、争议金额、双方证据（文件 URL）、投票记录（陪审地址→选项）、截止时间。全部存库；裁决结果回写链上执行分账。

---

## 4. 任务状态机（合约层真相源，S4 stepper 同款）

```
                 ┌────────── 超时无人接/无合格Agent ──▶ CANCELLED（退款+进死信队列）
                 │
Posted ──▶ Matching ──▶ Running ──▶ Review ──▶ Settled
(已质押)   (跑三层匹配)  (Agent执行)  (待验收)     (放款+退保证金+空投)
                             │          │
                             │          └─ 不满意 ─▶ Disputed ──▶ 仲裁裁决 ──▶ Settled
                             └─ Agent 逾期未交付 ──────────────▶ Settled（罚没保证金）
```

- 状态迁移**只能由合约函数触发**，前端 stepper 只是它的可视化
- 每次迁移 emit 事件，后端监听事件同步 SQLite（复用「Web3 大学」Relayer 模式）

---

## 5. 三层匹配流水线（S5 看板即此图，漏斗 1,024→156→12）

```
全部 Agent(1,024)
  │ V0 · Tag Filter：category 相等 + tags 交集 ≥ 阈值(默认2个)
  │   空结果/不足 ─▶ 死信队列（人工处理，BullMQ 延迟任务兜底）
  ▼
合格池(156)
  │ Fisher-Yates 洗牌 ──▶ 随机抽 TopK(K=12)
  │   为什么随机？新 Agent 无历史数据，排序模型无法评估，
  │   靠随机曝光积累数据 = 双边市场冷启动经典解法
  ▼
候选(12)
  │ V1 · Vector Search：任务/Agent 文本 → TF-IDF 向量 → 余弦相似度排序
  │   解决「写短剧脚本」vs「剧本创作」tag 不同但语义相近的召回问题
  ▼
语义 TopK(12)
  │ V2 · CTR Rank：逻辑回归(手写 SGD 在线学习)预估点击率
  │   特征：相似度、价格、历史完成率、评分；无数据的 Agent 显示 Cold Start
  ▼
最终 3 候选 → 雇主在 S4 选 1 个执行（Choose to Run）
```

**面试话术**：V0 跑通业务闭环（召回）→ V1 语义理解提精度（粗排）→ V2 数据驱动个性化（精排）——搜索推荐系统的标准演进路径。

---

## 6. 五维评分（S2 评分卡）

```
score = 0.70 × 完成强度 + 0.15 × 质量反馈 + 0.10 × 沟通体验 + 0.05 × 争议率与历史
```

| 维度 | 数据来源 | 归一化 |
|---|---|---|
| 完成强度 | 成功/失败/逾期单数 | success / total |
| 质量反馈 | 验收时雇主 1–5 星 | avg / 5 |
| 沟通体验 | 平均响应时延、撤回率 | 1 − min(delay/24h,1) |
| 争议率 | 仲裁败诉比例 | 1 − lost / disputed |
| 历史规模 | 累计单量、金额 | log(n)/log(1000) 封顶 |

权重沿用课堂纪要口径（70/15/10/5）。计算在后端定时聚合，综合分写回链上 `AgentRegistry.score(agentId)`。

---

## 7. 资金流（合约核心，口径在此定死）

**口径 A（实现）**：Agent 接单时质押 **6% 任务价** 作保证金；口径 B（讲述）：平台靠质押资金年化 6% 收益盈利——面试时两个都讲。

```
发布：雇主质押 price×1.001（含 0.1% 手续费）进 TaskEscrow
接单：Agent 质押 price×6% 进同一合约
验收通过：Agent 收 price，退 6% 保证金，平台收 0.1% 费，双方空投
Agent 违约/逾期：6% 保证金赔给雇主，price 退雇主
发起争议：全部资金冻结 → 仲裁 → 按裁决分配（仲裁费 0.5% 从 escrow 扣）
  裁决选项：Settle for Agent / Refund User / 50-50 Split（同 S7 三选项）
```

所有金额以 wei 计，前端用 viem `formatEther` 展示。

---

## 8. 合约清单（第 2–3 步产出）

| 合约 | 职责 | 关键函数 |
|---|---|---|
| MyToken (MYT) | ERC20 + 空投/水龙头 | `faucet()` 每地址每日 20 MYT；`airdrop(address[],uint256[])` 仅 owner |
| AgentRegistry | Agent 上架存证 + 评分锚点 | `register()` / `updateScore()` / `getAgent()` |
| TaskEscrow ★ | 资金托管 + 任务状态机 | `postTask` `accept(agentId)` `submit` `approve` `openDispute` `executeRuling` |

事件驱动：`TaskPosted / AgentAccepted / TaskApproved / DisputeOpened / RulingExecuted` → 后端同步。

---

## 9. 仲裁与空投（第 11 步）

**仲裁**：陪审资格 = 质押 **100 MYT**（口径统一，覆盖设计稿 500 的笔误）；多数票裁决；投票随共识分仲裁费，**反对共识罚没 15% 质押**（slash，呼应 S7 卡片）；讨论区发言同样需 100 MYT。

**空投**：Agent 上架 +10 MYT；任务完成 雇主 +5、工程师 +20 MYT（示例值，合约常量）。

---

## 10. 后端 API 约定（Express + SQLite，第 5 步）

| 方法 | 路径 | 说明 | 对应屏 |
|---|---|---|---|
| GET | `/api/agents?category=&q=` | 列表（含综合分） | S1 |
| GET | `/api/agents/:id` | 详情 + 五维分 + 成交记录 | S2 |
| POST | `/api/agents` | 上架（链上 register 后落库） | S6 |
| POST | `/api/agents/:id/purchase` | 付费购 key（返回打码 `myt-****-a3f8`，明文仅一次） | S2 |
| POST | `/api/tasks` | 发布（链上质押后落库） | S3 |
| GET | `/api/tasks/:id` | 详情 + 3 候选 | S4 |
| POST | `/api/tasks/:id/match` | 触发三层匹配 | S4/S5 |
| POST | `/api/tasks/:id/choose/:agentId` | 选定执行 | S4 |
| POST | `/api/tasks/:id/approve` \| `/dispute` | 验收 / 争议 | S4 |
| GET | `/api/matching/preview?taskId=` | V0/V1/V2 全过程数据 | S5 |
| GET | `/api/disputes` · POST `/:id/vote` | 案件列表 / 投票 | S7 |
| POST | `/api/airdrop/claim` | 领空投 | S6 |
| GET | `/api/profile/:address` | 个人中心聚合 | S6 |

---

## 11. 非功能需求（课堂红线，硬性交付物）

1. CLAUDE.md（课堂说的 cloud.md）约束 AI 生成代码
2. 单文件 ≤ 300 行（React 组件 ≤ 200）、函数 ≤ 50 行
3. 每目录配 index.md
4. 先设计后编码；能讲出来才算完成
5. 本地等价替代讲清生产替换点（SQLite→PG、BullMQ→SQS、手写模型→LightGBM）

---

## 12. 里程碑（对照 12 步课程表）

| 里程碑 | 覆盖步骤 | 验收标准 |
|---|---|---|
| **MVP 红线（两周）** | 0–6 + 10 最小闭环 | 上架→发布质押→V0 匹配→验收结算 全链路走通 |
| 亮点 | 7–8 | V1 向量 + V2 CTR 上线，S5 看板有真实数据 |
| 加分 | 9 | Go 引擎 + 死信队列 |
| 彩蛋 | 11 | 仲裁 + 空投闭环 |

下一步：**第 2 步 MyToken 合约**。
