# image-agent/ —— Pixel Alchemist（SVG 视觉工厂，端口 9008）

## 这是什么

Mastra 框架版执行体（第 2 个框架版）：接「Design」类任务，交付 **SVG 视觉稿**
（海报/横幅/封面）。链上挂牌名 **Pixel Alchemist**，按名接线（manifest.js）。

## 为什么这么拆

- `agent.mjs` —— 脑子：Mastra **Agent + 双工具循环**（harness 的看点）
  - `checkPalette`：WCAG 对比度（正文≥4.5:1 / 大标题·图形≥3:1），代码算比值、
    代码给建议色——LLM 只负责采纳执行；
  - `validateSvg`：结构（`<svg>` 包住 + viewBox）/安全红线（禁 script、事件属性、
    外链）/标签配平/尺寸窗 400B~24KB/图元数——issues 清单打回重修，修到 valid 为止；
  - 出口终审：server.mjs 不信 LLM 的自觉，`validateSvgSource` 再验一次才回 ok。
- `server.mjs` —— 契约壳（共享 `../mastra-shell.mjs`）：只做 brief→generate→终审。
- **图即文本**：DeepSeek 没有生图端点（同 embeddings 404 的教训），但 SVG 是文本——
  LLM 直接写图，零额外依赖，交付物走 task_results 文本管道，前端 dataURI 一行渲染。
  生产替换点：配 `IMAGE_API_*`（OpenAI 兼容 `/images/generations`）接真生图模型。

## 和兄弟执行体的关系

| | 引擎 | 框架能力 |
|---|---|---|
| writer/data/review/contract/storyboard | 本地算法 + DeepSeek 双引擎 | 零依赖手写（node:http） |
| title-agent (9006) | DeepSeek | Agent + 单工具（seoScore） |
| **本目录 (9008)** | DeepSeek 写 SVG | **Agent + 双工具循环 + 出口终审** |
| web-agent (9009) | DeepSeek | **Workflow 四步编排** |

契约三端一致（`POST /run → {ok, output, meta}`），平台侧 agent-runner 零改动。

## 跑与验

```bash
npm i                          # 本目录独立包（@mastra/core 0.10 + ai 4 + zod 3）
node server.mjs                # 或由 agents/start-all.js 从根拉起
curl -s localhost:9008/health
curl -s localhost:9008/run -H 'content-type: application/json' \
  -d '{"title":"海报","description":"给 Web3 课程做一张招募海报，深色科技风，标题『十二课成链上工程师』"}'
```

注意：Mastra 0.10 的 `generate(messages, options)` 是**位置参数**（坑#12）；
`.env` 由 mastra-shell 从模块位置解析，不依赖 cwd。
