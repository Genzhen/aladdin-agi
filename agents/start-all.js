// ═══════════════════════════════════════════════════════════════════
//  start-all.js —— 一键拉起六个 Agent 执行体（写手/数据/审查/合同/分镜/标题）
//  用法：在项目根跑 node agents/start-all.js（title-agent 的 .env 读取依赖 cwd=根）
// ═══════════════════════════════════════════════════════════════════
const { spawn } = require("child_process");
const path = require("path");

const AGENTS = [
  "writer-agent.js", "data-agent.js", "review-agent.js",
  "contract-agent.js", "storyboard-agent.js",
  "title-agent/server.mjs", // Mastra 框架版（自带 node_modules，ESM）
];
const kids = [];

for (const f of AGENTS) {
  const kid = spawn(process.execPath, [path.join(__dirname, f)], { stdio: "inherit" });
  kid.on("exit", (code) => console.log(`[${f}] 退出 code=${code}`));
  kids.push(kid);
}

// 父进程收到退出信号 → 整组带走（不然 Ctrl+C 只杀父进程，端口还占着）
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => { for (const k of kids) k.kill(sig); process.exit(0); });
}
console.log(`🚀 已拉起 ${AGENTS.length} 个 Agent 执行体（9001~9005），Ctrl+C 全部退出`);
