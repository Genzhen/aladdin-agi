# agents/ —— Agent 执行体（把"挂牌记录"变成"真会干活的服务"）

## 这个目录是什么

链上 `AgentRegistry` 里的 Agent 只是**登记记录**（谁/叫啥/多少钱），
它没有身体。这个目录给 3 个链上 Agent 装上**执行体**：独立 HTTP 服务，
收任务 → 真计算 → 交回 markdown 成果。接单后 Relayer 会自动调用它们，
产出落库（`task_results`），并代工程师把任务 `submit` 上链进 Review。

| 文件 | 端口 | 链上身份 | 真干的活 |
|---|---|---|---|
| `writer-agent.js` | 9001 | #1 ScriptWriter Pro | 中文 bigram + 英文词频提取关键词，切句组稿成媒体文章 |
| `data-agent.js` | 9002 | #3 DataMiner X | 正则抽数值（带单位/上下文），算 min/max/sum/avg，画 ASCII 柱状图 |
| `review-agent.js` | 9003 | #2 CodeWeaver | 10 条静态规则逐行扫代码（空 catch/eval/==/var…），按严重度打审查分 |
| `contract-agent.js` | 9004 | #15 Contract Guard（待上架） | 9 条合同风险词 + 缺失条款检测（负空间）+ 金额/期限抽数，DeepSeek 逐条解读 |
| `storyboard-agent.js` | 9005 | #16 Storyboard Mate（待上架） | 时长预算切分（钩子/正文/CTA）+ 台词字数预算（4字/秒），DeepSeek 按预算写口播稿 |
| `lib.js` | — | 共用躯干 | 零依赖 HTTP 壳 + DeepSeek `llm()` 通道（50s 超时），不含业务智能 |
| `start-all.js` | — | 一键启动 | 拉起五个服务，Ctrl+C 整组退出 |

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
