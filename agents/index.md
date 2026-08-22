# agents/ —— Agent 执行体（把"挂牌记录"变成"真会干活的服务"）

## 这个目录是什么

链上 `AgentRegistry` 里的 Agent 只是**登记记录**（谁/叫啥/多少钱），
它没有身体。这个目录给 6 个链上 Agent 装上**执行体**：独立 HTTP 服务，
收任务 → 真计算 → 交回 markdown 成果。接单后 Relayer 会自动调用它们，
产出落库（`task_results`），并代工程师把任务 `submit` 上链进 Review。

| 文件 | 端口 | 链上身份 | 真干的活 |
|---|---|---|---|
| `writer-agent.js` | 9001 | #1 ScriptWriter Pro | 中文 bigram + 英文词频提取关键词，切句组稿成媒体文章 |
| `data-agent.js` | 9002 | #3 DataMiner X | 正则抽数值（带单位/上下文），算 min/max/sum/avg，画 ASCII 柱状图 |
| `review-agent.js` | 9003 | #2 CodeWeaver | 10 条静态规则逐行扫代码（空 catch/eval/==/var…），按严重度打审查分 |
| `contract-agent.js` | 9004 | #15 Contract Guard（待上架） | 9 条合同风险词 + 缺失条款检测（负空间）+ 金额/期限抽数，DeepSeek 逐条解读 |
| `storyboard-agent.js` | 9005 | #16 Storyboard Mate（待上架） | 时长预算切分（钩子/正文/CTA）+ 台词字数预算（4字/秒），DeepSeek 按预算写口播稿 |
| `title-agent/` | 9006 | #17 Title Forge（待上架） | **Mastra 框架版**：Agent + seoScore 工具调用循环（LLM 生成 6 标题→工具确定性打分→按分选 Top3），Marketing 类 |
| `lib.js` | — | 共用躯干 | 零依赖 HTTP 壳 + DeepSeek `llm()` 通道（50s 超时），不含业务智能 |
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
2. 框架的价值在复杂度：工具调用循环（maxSteps）、模型路由（换供应商改两行）、
   后续要 Memory/Workflow/Evals 时不用换骨架。单轮"收任务→出稿"用不上这些。

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

## 生产替换点

1. brain 换成 LLM API 调用（HTTP 壳/契约/结算链路零改动）
2. 每个 Agent 独立部署（K8s/Serverless），`agents.endpoint` 换成服务发现
3. Relayer 代签 submit 改为 Agent 服务自己持钥（或工程师手签）——
   现在能代签只因演示里所有 Agent 的 owner 都是部署钱包
