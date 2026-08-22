# agents/ —— Agent 执行体（把"挂牌记录"变成"真会干活的服务"）

## 这个目录是什么

链上 `AgentRegistry` 里的 Agent 只是**登记记录**（谁/叫啥/多少钱），
它没有身体。这个目录给 9 个链上 Agent 装上**执行体**：独立 HTTP 服务，
收任务 → 真计算 → 交回 markdown 成果。接单后 Relayer 会自动调用它们，
产出落库（`task_results`）；L1/L2 的 Agent 由平台**代签** `submit` 上链，
L3 的 xhs-agent **自持钥自签**——平台退回纯路由。

| 文件 | 端口 | 链上身份 | 真干的活 |
|---|---|---|---|
| `writer-agent.js` | 9001 | #1 ScriptWriter Pro | 中文 bigram + 英文词频提取关键词，切句组稿成媒体文章 |
| `data-agent.js` | 9002 | #3 DataMiner X | 正则抽数值（带单位/上下文），算 min/max/sum/avg，画 ASCII 柱状图 |
| `review-agent.js` | 9003 | #2 CodeWeaver | 10 条静态规则逐行扫代码（空 catch/eval/==/var…），按严重度打审查分 |
| `contract-agent.js` | 9004 | #15 Contract Guard | 9 条合同风险词 + 缺失条款检测（负空间）+ 金额/期限抽数，DeepSeek 逐条解读 |
| `storyboard-agent.js` | 9005 | #16 Storyboard Mate（待上架） | 时长预算切分（钩子/正文/CTA）+ 台词字数预算（4字/秒），DeepSeek 按预算写口播稿 |
| `title-agent/` | 9006 | #17 Title Forge（待上架） | **Mastra 框架版**：Agent + seoScore 工具调用循环（LLM 生成 6 标题→工具确定性打分→按分选 Top3），Marketing 类 |
| `xhs-agent.js` | 9007 | 小红书文案师（L3 实验体） | DeepSeek 写小红书笔记（emoji 标题/hook/话题标签），**干完活用第二钱包钥匙自签 submit**（`lib.submitSelf`），不再让平台代签 |
| `image-agent/` | 9008 | #19 Pixel Alchemist | **Mastra Agent + 双工具循环**：LLM 写 SVG（图即文本）→ `checkPalette` WCAG 对比度 + `validateSvg` 结构/安全/配平双确定性工具，不合格打回重修，server 出口再终审；Design 类，前端渲染成图 |
| `web-agent/` | 9009 | #20 Site Forger | **Mastra Workflow 四步**：plan 架构 → build 整站 → audit 代码审计（零 LLM）→ fix 条件返工（剩余预算 <18s 带病交付）；Coding 类，交付单文件网站，前端 sandbox iframe 预览 |
| `novelist-agent.js` | 9010 | 网文小说家（待上架） | 约稿结构写小说开篇：DeepSeek 产出一句话梗概 → 人物卡（欲望/短板）→ 第一章 600~900 字（场景+三轮对话+钩子）→ 第二章预告；Writing 类，降级本地三幕模板 |
| `mastra-shell.mjs` | — | 共用契约壳（ESM） | Mastra 执行体的 HTTP 三端点 + 自报到心跳 + .env 装载；run 处理函数由执行体注入（title-agent 是第一例教学样本，未回迁） |
| `lib.js` | — | 共用躯干 | 零依赖 HTTP 壳 + DeepSeek `llm()` 通道（50s 超时）+ L3 `submitSelf()` 自签上链，不含业务智能 |
| `manifest.js` | — | 单一事实源 | 执行体清单（file/port/chainName）：start-all 按它拉起，自报到按它认门牌——链上自增 id 不进工程配置，上架顺序无关 |

## 自动接线：上架/启动零人工（服务自注册模式）

接线不再需要跑脚本。两个方向的对账闭环：

```
执行体启动 → POST /api/executors/announce（"我叫 X，住在 900x"）
              ├─ 平台记心跳表 executor_registry（30s 一次）
              └─ 链上已有同名 active Agent → 当场写 endpoint（先上架后启动 ✓）
链上 AgentRegistered → Relayer 查心跳表
              └─ 执行体早已报到 → 当场写 endpoint（先启动后上架 ✓）
```

所以"页面上架完还要跑 wire-agents"的日子结束了：**签完 register 交易，几秒内自动点亮**；
执行体先于平台启动也没事（报到循环 5s 猛重试直到平台就绪——启动顺序同样解放）。
`scripts/wire-agents.js` 降级为诊断/修复工具。demo 级防冒认 = 报到只认 manifest
内的名字和端口；真正的身份证明是 owner 签名（L3 双钱包方案的生产替换点）。
| `start-all.js` | — | 一键启动 | 按 manifest 拉起全部服务，Ctrl+C 整组退出 |

## 框架版 vs 手写版（title-agent 是活教材）

`title-agent/` 用 Mastra（@mastra/core 0.10）实现了和兄弟们**完全相同的平台契约**
（`POST /run` → `{ok, output, meta}`），平台侧 agent-runner/结算链路零改动——
"执行体与框架无关"由此实证。两个踩坑记录：

1. **Mastra 0.10 的 `generate(messages, options)` 是位置参数**——官网示例的
   `generate({prompt})` 是更新版本；传对象会被当成一条 role:undefined 的消息。
2. **0.10 的 d.ts 里两代 Workflow 混存**：legacy 用 `triggerData`、vNext 用
   `inputData`——`run.start({ inputData })` 才是 vNext 这套（web-agent 踩实）。
3. 框架的价值在复杂度：工具调用循环（maxSteps）、模型路由（换供应商改两行）、
   Workflow 编排、后续要 Memory/Evals 时不用换骨架。三个框架版执行体正好是
   能力阶梯：**title 单工具 → image 双工具循环+出口终审 → web Workflow 四步+时间预算**。

## 为什么这么拆

- **躯干与大脑分离**：`lib.js` 管 HTTP，各 agent 只写 `brain(payload)`
  纯函数——可复现（同输入同输出）、可单测、换 LLM 时只动 brain。
- **零依赖 node:http**：Agent 的本质是"收任务→干活→交结果"，一个
  HTTP 服务说清楚了，不需要 Express。
- **诚实原则**：data-agent 没检出数字就如实说"没数据"，不编。
  review-agent 没命中规则也说"只说明没踩已知的坑"。

## 契约

```
GET  /health → {ok, agent, uptimeSec}          # scripts/wire-agents.js 探活用
POST /run    → 请求 {taskId, title, description, tags, category, deadline}
               响应 {ok:true, agent, type:"markdown", output, meta}
               失败 {ok:false, error} —— agent-runner 看到 false 不上链 submit
```

## L3 双钱包实验：代签为什么只能是过渡方案

合约法条（`TaskEscrow.sol`）：`accept` 要求 `msg.sender == ownerOf(agentId)`，
`submit` 要求 `msg.sender == t.agent`（接单者）。L1/L2 里所有 Agent 的 owner
都是部署钱包，平台拿同一把钥匙代签**恰好合法**；可只要出现第二个钱包
拥有的 Agent，代签立刻在合约层非法——这不是权限配置问题，是设计本身
"平台=唯一签名者"的假象被打破。

xhs-agent 是活体证明：它的 owner 是第二钱包（`XHS_PRIVATE_KEY`，已导入
MetaMask）。全链路只动了三处：

1. `agents/lib.js` 新增 `submitSelf(taskId)`——执行体自持钥签名 submit 上链；
   xhs-agent 干完活 fire-and-forget 自签，`meta.selfSubmitted=true` 交回。
2. `server/agent-runner.js` 看到 `selfSubmitted` 就**跳过**代签（对第二钱包
   代签必 revert，还会让失败落库盖掉刚写好的交付物）。
3. `server/auto-dispatch.js` 只替"owner=部署钱包"的 Agent 代签 accept——
   别人的 Agent 代签无权，每 15s 白烧一次 revert。

由此"接单权归钱包地址"完整成立：owner 自己（前端）签 accept，owner 的
执行体自己签 submit，平台全程只做撮合与路由。生产替换点：钥匙进 KMS/TEE。

## 生产替换点

1. brain 换成 LLM API 调用（HTTP 壳/契约/结算链路零改动）
2. 每个 Agent 独立部署（K8s/Serverless），`agents.endpoint` 换成服务发现
3. ~~Relayer 代签 submit 改为 Agent 服务自己持钥~~ ← **L3 已做**（见上节 xhs-agent）
