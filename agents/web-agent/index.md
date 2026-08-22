# web-agent/ —— Site Forger（单文件网站工坊，端口 9009）

## 这是什么

Mastra 框架版执行体（第 3 个框架版）：接「Coding」类任务，交付**单文件 HTML 网站**
（DOCTYPE→</html> 一个文件、样式全内联、零外部依赖）。链上挂牌名 **Site Forger**。

## 为什么这么拆

- `agent.mjs` —— 三个角色 Agent（架构师/工程师/返工）+ **审计函数**（确定性代码）。
  一个工坊拆三个角色的原因：单 Agent 串指令会把"计划"和"施工"混在一次生成里，
  拆开后每步输出形状单一、可审计、可单独换模型。
- `workflow.mjs` —— Mastra **Workflow** 四步流水线（本目录的核心看点）：
  `plan（小 JSON，快）→ build（大输出整站）→ audit（代码审计，零 LLM）→ fix（条件返工）`。
  返工不是无条件重试：剩余预算 <18s 就带病交付、欠账写进报告——失败被诚实暴露。
- `server.mjs` —— 契约壳：上 56s 发条（平台 runner 60s 硬顶）→ 跑 Workflow → 出口终审。
- 时间预算：`setDeadline/timeLeft` 跨模块传递——workflow 步骤是纯函数，时钟从壳注入。

## 版本坑（吃过的都记着）

- `run.start({ triggerData })`——0.10 版参数名，新版文档写 `inputData`，是文档漂移；
- `agent.generate(messages, options)` 位置参数（同 title-agent 坑#12）。

## 跑与验

```bash
npm i && node server.mjs        # 或 agents/start-all.js 从项目根拉起
curl -s localhost:9009/health
curl -s localhost:9009/run -H 'content-type: application/json' \
  -d '{"title":"课程落地页","description":"给 Web3 十二课做一个宣传落地页，深色科技风，访客是想转行链上开发的新手，要有课程亮点、讲师背书和报名行动按钮"}'
```

产出粘贴保存为 .html 双击即可看；平台内 settled 解锁后任务详情页直接 iframe 预览。
