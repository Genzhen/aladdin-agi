// ═══════════════════════════════════════════════════════════════════
//  seed-agents-round2.js —— 第二批测试 Agent（第二轮手动测试用）
//
//  设计点（也是面试话术）：
//  1. 与第一批互补：Video/Legal/Marketing 三个空白类别各上一个，
//     Marketplace 的类别筛选立刻有内容可看。
//  2. 三个"同类竞争者"（Data/Translation/Coding 各 +1）——
//     发对应任务时 V0 召回池变厚，V1 价格过滤和 V2 打分才有排序空间。
//  3. "Growth Hacker" 的 seo 与 Copy Smith(Writing) 跨类撞词——
//     刻意演示 V0 按词召回不看类别，跨类竞争者也能进漏斗。
//  4. "Bug Hunter" 的 tags 与两个 solidity 系 Coding Agent 完全错开——
//     发"安全审计"任务它不该被召回，发"写测试"任务它才进池，
//     用来验证 V0 召回的边界（召回≠乱召回）。
//  5. 全部 score=0 冷启动：演示 V2 中性先验 0.5 之下，
//     新 Agent 也能和老 Agent 同台竞技。
//
//  用法：npx hardhat run scripts/seed-agents-round2.js --network sepolia
//  （server 要开着：脚本靠 /api/agents 判重，Relayer 负责同步新 Agent）
// ═══════════════════════════════════════════════════════════════════
const hre = require("hardhat");
const fs = require("fs");

// 第二批阵容：名字 / 类别 / tags(逗号分隔，V0/V1 就吃这个) / 单次定价(ETH 字符串)
const ROSTER = [
  ["Thumbnail Wizard", "Video",       "youtube,thumbnail,shorts,premiere",   "0.04"], // 空白类别
  ["Contract Reader",  "Legal",       "contract,compliance,terms,review",    "0.15"], // 空白类别
  ["Growth Hacker",    "Marketing",   "growth,ads,campaign,seo,funnel",      "0.06"], // seo 跨类撞 Copy Smith
  ["Chart Sage",       "Data",        "visualization,chart,dashboard,bi",    "0.09"], // 与 DataMiner X 竞争
  ["Nihongo Bridge",   "Translation", "japanese,translation,manga,subtitle", "0.03"], // 与 Translate Master 竞争
  ["Bug Hunter",       "Coding",      "testing,pytest,bug,e2e",              "0.07"], // 与 solidity 系错位竞争
];

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const deployed = JSON.parse(fs.readFileSync("deployed.json", "utf8")).contracts;
  const registry = await hre.ethers.getContractAt("AgentRegistry", deployed.AgentRegistry);

  // 幂等：先问后端库哪些名字已在架（链上没按名查的接口——库当索引用）
  const res = await fetch("http://localhost:3001/api/agents");
  if (!res.ok) throw new Error("后端未响应：先起 server（node server/index.js）");
  const known = new Set((await res.json()).map((a) => a.name));
  console.log(`在架 ${known.size} 个：${[...known].join(" / ")}`);

  let n = 0;
  for (const [name, category, tags, eth] of ROSTER) {
    if (known.has(name)) { console.log(`↩︎  跳过 ${name}（已上架）`); continue; }
    const tx = await registry.register(name, category, tags, hre.ethers.parseEther(eth));
    const rc = await tx.wait();
    n++;
    console.log(`✅ #${n} ${name} [${category}] ${eth} ETH/次  tx: ${rc.hash}`);
  }
  console.log(n ? `→ 新增 ${n} 个，Relayer 会自动同步进库并记账 +10 MYT/个` : "→ 无新增，全部已在架");
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
