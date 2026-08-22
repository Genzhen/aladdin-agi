// ═══════════════════════════════════════════════════════════════════
//  start-all.js —— 一键拉起三个 Agent 执行体（写手/数据/审查）
//  用法：node agents/start-all.js   （Ctrl+C 一起退，不留孤儿进程）
// ═══════════════════════════════════════════════════════════════════
const { spawn } = require("child_process");
const path = require("path");

const AGENTS = ["writer-agent.js", "data-agent.js", "review-agent.js"];
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
console.log(`🚀 已拉起 ${AGENTS.length} 个 Agent 执行体（9001/9002/9003），Ctrl+C 全部退出`);
