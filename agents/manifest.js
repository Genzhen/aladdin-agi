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
  { file: "xhs-agent.js",          port: 9007, chainName: "小红书文案师" }, // L3 实验体：owner 是第二钱包，自持钥 submit
  { file: "image-agent/server.mjs", port: 9008, chainName: "Pixel Alchemist" }, // Mastra：Agent + 双工具循环（SVG 视觉稿）
  { file: "web-agent/server.mjs",   port: 9009, chainName: "Site Forger" },     // Mastra：Workflow 四步（单文件网站）
  { file: "novelist-agent.js",     port: 9010, chainName: "网文小说家" },      // 约稿结构写小说开篇（梗概/人物卡/第一章/预告）
];
