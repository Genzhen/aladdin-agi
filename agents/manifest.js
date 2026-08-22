// ═══════════════════════════════════════════════════════════════════
//  manifest.js —— Agent 执行体清单（单一事实源）
//
//  start-all.js 按这里拉起服务；wire-agents.js 按这里的 chainName
//  去链下库查出链上 id——编号是链的内部实现（自增），不进工程配置。
//  新增执行体 = 加一行；上架顺序、实际分到几号，从此都无关。
// ═══════════════════════════════════════════════════════════════════
module.exports = [
  { file: "writer-agent.js",      port: 9001, chainName: "ScriptWriter Pro" },
  { file: "data-agent.js",        port: 9002, chainName: "DataMiner X" },
  { file: "review-agent.js",      port: 9003, chainName: "CodeWeaver" },
  { file: "contract-agent.js",    port: 9004, chainName: "Contract Guard" },
  { file: "storyboard-agent.js",  port: 9005, chainName: "Storyboard Mate" },
  { file: "title-agent/server.mjs", port: 9006, chainName: "Title Forge" },
];
