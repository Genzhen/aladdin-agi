// ═══════════════════════════════════════════════════════════════════
//  seed-agents-round3.js —— 第三批：两个 Mastra 深度执行体（2026-08-22）
//
//  设计点（也是面试话术）：
//  1. Pixel Alchemist 补 Design 类——该类别至今无"有执行体"的 Agent，
//     海报/封面类任务从此有真交付（SVG 视觉稿，前端直接渲染成图）；
//  2. Site Forger 进 Coding 类与 CodeWeaver 同台——一个交付代码审查报告、
//     一个交付整站 HTML，"同类不同工"让 V2 排序有戏可看；
//  3. 两者是全平台仅有的 Mastra 深度用法（双工具循环 / Workflow 四步），
//     与 title-agent 的单工具版构成框架能力的完整阶梯。
//
//  用法（记得清代理变量，坑#11；server 要开着）：
//    env -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u NODE_USE_ENV_PROXY \
//      npx hardhat run scripts/seed-agents-round3.js --network sepolia
// ═══════════════════════════════════════════════════════════════════
const hre = require("hardhat");
const fs = require("fs");

// 名字 / 类别 / tags(逗号分隔，V0/V1 就吃这个) / 单次定价(ETH 字符串)
const ROSTER = [
  ["Pixel Alchemist", "Design", "poster,svg,design,visual,cover,brand", "0.05"],
  ["Site Forger",     "Coding", "website,landing,html,frontend,site",   "0.08"],
];

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const deployed = JSON.parse(fs.readFileSync("deployed.json", "utf8")).contracts;
  const registry = await hre.ethers.getContractAt("AgentRegistry", deployed.AgentRegistry);

  // 幂等：先问后端库哪些名字已在架（链上没按名查的接口——库当索引用）
  const res = await fetch("http://localhost:3001/api/agents");
  if (!res.ok) throw new Error("后端未响应：先起 server（node server/index.js）");
  const known = new Set((await res.json()).map((a) => a.name));

  let n = 0;
  for (const [name, category, tags, eth] of ROSTER) {
    if (known.has(name)) { console.log(`↩︎  跳过 ${name}（已上架）`); continue; }
    const tx = await registry.register(name, category, tags, hre.ethers.parseEther(eth));
    const rc = await tx.wait();
    n++;
    console.log(`✅ ${name} [${category}] ${eth} ETH/次  tx: ${rc.hash}`);
  }
  console.log(n ? `→ 新增 ${n} 个，Relayer 同步进库后执行体心跳会自动接线（+10 MYT/个）` : "→ 无新增，全部已在架");
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
