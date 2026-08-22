// ═══════════════════════════════════════════════════════════════════
//  start-all.js —— 一键拉起六个 Agent 执行体（写手/数据/审查/合同/分镜/标题）
//  用法：在项目根跑 node agents/start-all.js（title-agent 的 .env 读取依赖 cwd=根）
// ═══════════════════════════════════════════════════════════════════
const { spawn } = require("child_process");
const path = require("path");
const MANIFEST = require("./manifest"); // 拉谁、端口多少，单一事实源

const kids = [];

for (const { file } of MANIFEST) {
  const kid = spawn(process.execPath, [path.join(__dirname, file)], { stdio: "inherit" });
  kid.on("exit", (code) => console.log(`[${file}] 退出 code=${code}`));
  kids.push(kid);
}

// 父进程收到退出信号 → 整组带走（不然 Ctrl+C 只杀父进程，端口还占着）
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => { for (const k of kids) k.kill(sig); process.exit(0); });
}
console.log(`🚀 已拉起 ${MANIFEST.length} 个 Agent 执行体（清单见 agents/manifest.js），Ctrl+C 全部退出`);
