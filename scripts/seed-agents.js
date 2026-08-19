// ═══════════════════════════════════════════════════════════════════
//  seed-agents.js —— 批量上架测试 Agent（面试演示/匹配实验用）
//
//  设计点（也是面试话术）：
//  1. 链上没有"按名字查 Agent"的接口（mapping 按 id 索引）——
//     所以幂等判断走后端库：已存在的名字直接跳过。
//     这正是"链=真相源、SQLite=索引/缓存"分层的用处。
//  2. 每个新 Agent score=0（冷启动），V2 会给中性先验 0.5——
//     刻意留着几个冷启动 Agent，方便演示"新 Agent 也有机会被召回"。
//  3. 阵容里混了两个"同类竞争者"（Coding/Write 各多一个），
//     发对应任务时 V0 召回会有多个候选，V1/V2 才有排序可看。
//
//  用法：npx hardhat run scripts/seed-agents.js --network sepolia
//  （server 要开着：脚本靠 /api/agents 判重，Relayer 负责同步新 Agent）
// ═══════════════════════════════════════════════════════════════════
const hre = require("hardhat");
const fs = require("fs");

// 测试阵容：名字 / 类别 / tags(逗号分隔，V0/V1 就吃这个) / 单次定价(ETH 字符串)
const ROSTER = [
  ["Translate Master",  "Translation", "translation,english,japanese,localization", "0.02"],
  ["Logo Forge",        "Design",      "logo,branding,figma,svg",                    "0.05"],
  ["Voice Clone S1",    "Audio",       "tts,voice,speech,clone",                     "0.03"],
  ["Solidity Sentinel", "Coding",      "solidity,security,audit,erc20",              "0.12"], // 与 CodeWeaver 竞争
  ["Copy Smith",        "Writing",     "copywriting,seo,blog,social",                "0.02"], // 与 ScriptWriter Pro 竞争
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
