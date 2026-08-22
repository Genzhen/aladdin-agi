// ═══════════════════════════════════════════════════════════════════
//  index.js —— 阿拉丁AGI 后端入口（Express + SQLite + 链上事件 Relayer）
//  启动：node index.js   （开发热重启：npm run dev）
//  生产替换点：SQLite→Postgres(RDS)、单进程→PM2/Docker、HTTP→ALB+HTTPS
// ═══════════════════════════════════════════════════════════════════
require("dotenv").config();
const express = require("express");
const cors = require("cors");

const { provider, deployed } = require("./chain");
const agentsRouter = require("./routes/agents");
const tasksRouter = require("./routes/tasks");
const { startRelayer } = require("./relayer");
const { startAutoDispatch } = require("./auto-dispatch");

const app = express();
app.use(cors()); // 前端 (5173) 和后端 (3001) 不同端口，放开跨域
app.use(express.json());

// ── 路由挂载 ──
app.use("/api/agents", agentsRouter);
app.use("/api/tasks", tasksRouter);
app.use("/api/tasks", require("./routes/match")); // :id/dispatch、:id/click（路径不与 tasks.js 冲突）
app.use("/api/internal", require("./routes/internal")); // Go 引擎专用（token 鉴权）
app.use("/api/engine", require("./routes/engine")); // S5 引擎总览
app.use("/api/airdrop", require("./routes/airdrop")); // S7 空投记账

// 健康检查：一眼看出"进程活着 + 链连着 + 地址对"
app.get("/api/health", async (req, res) => {
  try {
    const block = await provider.getBlockNumber();
    res.json({
      ok: true,
      chain: { network: deployed.network, block },
      contracts: deployed.contracts,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── 生产：静态托管前端（app/dist 由 vite build 产出；开发期 5173 走 vite 代理）──
// 同源部署的好处：前端 fetch('/api/…') 不跨域，也不需要 CORS（上面 cors() 只是开发期双端口用）
const path = require("path");
const dist = path.join(__dirname, "../app/dist");
if (require("fs").existsSync(dist)) {
  app.use(express.static(dist));
  // SPA 兜底：/agent/1 这类前端路由刷新时别 404，统一回 index.html（API 路径除外）
  app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(dist, "index.html")));
  console.log("🌐 前端静态托管  ../app/dist");
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 后端 API    http://localhost:${PORT}`);
  console.log(`💊 健康检查    http://localhost:${PORT}/api/health`);
  startRelayer(); // 同进程内启动事件监听（Web3 大学同款：一个进程管两件事）
  startAutoDispatch(); // 自动派遣：匹配 45s 无人接则替开了 auto_accept 的 Agent 抢单
});
