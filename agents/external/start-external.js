// ═══════════════════════════════════════════════════════════════════
//  start-external.js —— 一键拉起 5 个"外部商家"演示执行体（9011~9015）
//  刻意不读 manifest.js（这批就是演示"清单之外的外部商家"）。
//  用法：pm2 start agents/external/start-external.js --name aladdin-external
//  （cwd 必须是项目根：../lib 的 mini-dotenv 要读根 .env 拿 DEEPSEEK_API_KEY）
// ═══════════════════════════════════════════════════════════════════
const { spawn } = require("child_process");
const path = require("path");

// 端口→文件：与 外部Agent演示清单.md 一一对应（改这里要同步改清单）
const FLEET = [
  { file: "acrostic-agent.js", port: 9011 }, // 藏头诗人
  { file: "weekly-agent.js", port: 9012 },   // 周报匠
  { file: "translate-agent.js", port: 9013 },// 双语商务译师
  { file: "sql-agent.js", port: 9014 },      // SQL 军师
  { file: "naming-agent.js", port: 9015 },   // 起名大师
];

const kids = [];
for (const { file, port } of FLEET) {
  const kid = spawn(process.execPath, [path.join(__dirname, file)], { stdio: "inherit" });
  kid.on("exit", (code) => console.log(`[${file}] 退出 code=${code}`));
  kids.push(kid);
  console.log(`  → ${file} :${port}`);
}

// 父进程收到退出信号 → 整组带走（pm2 reload/restart 时不留孤儿占端口）
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => { for (const k of kids) k.kill(sig); process.exit(0); });
}
console.log(`🚀 已拉起 ${FLEET.length} 个外部商家执行体（9011~9015，不在 manifest，上架时填 URL 接线）`);
