// ═══════════════════════════════════════════════════════════════════
//  demo-jury.js —— 陪审法庭真案端到端演示（默认任务 #19，链上真实争议）
//  剧本：开庭抽 3 陪审员 → 三票 2v1（Agent 胜 vs 雇主胜）→ 宣判结算
//        → 验证：多数方各拿 10 YD + 仲裁费一半，少数方质押 100→85（slash 15%）
//  幂等：按 getCase.phase 推进，已开庭/已投票自动跳过，可反复跑。
//  用法：node scripts/demo-jury.js [taskId]
// ═══════════════════════════════════════════════════════════════════
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

const TASK_ID = Number(process.argv[2] || 19);
const RPC = process.env.SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com";
const ROOT = path.join(__dirname, "..");
const deployed = JSON.parse(fs.readFileSync(path.join(ROOT, "deployed.json"), "utf8"));
const jurorPks = JSON.parse(fs.readFileSync(path.join(ROOT, ".jurors-demo.json"), "utf8"));

const provider = new ethers.JsonRpcProvider(RPC);
const deployer = new ethers.Wallet(process.env.PRIVATE_KEY, provider); // 开庭/宣判的"任何人"

function load(name, solFile, signer) {
  const abi = JSON.parse(
    fs.readFileSync(path.join(ROOT, "artifacts", "contracts", solFile), "utf8")
  ).abi;
  return new ethers.Contract(deployed.contracts[name], abi, signer);
}
const escrowR = load("TaskEscrow", "TaskEscrow.sol/TaskEscrow.json", provider);
const courtR = load("JuryCourt", "JuryCourt.sol/JuryCourt.json", provider);
const ydR = load("YidengToken", "YidengToken.sol/YidengToken.json", provider);

// 剧本票：panel 槽位 0/1 投 Agent 胜，槽位 2 是"少数派"投雇主胜（被 slash 的倒霉蛋）
const PLAN = [0, 0, 1];
const RULING_LABEL = ["🔧 Agent 胜", "🛡️ 雇主胜", "⚖️ 对半分"];
const YD = (wei) => `${Number(wei) / 1e18}`;
const short = (a) => `${a.slice(0, 8)}…${a.slice(-4)}`;

async function main() {
  console.log(`\n🏛️ 陪审法庭演示 · 任务 #${TASK_ID}（RPC: ${RPC.slice(8, 40)}…）\n`);

  // ── 前置检查：托管态必须是 Disputed（枚举 4）。已结算的案子没有 before
  //    快照可对比，重跑无意义——要看结果去前端「法庭」页卷宗 ──
  const raw = await escrowR.tasks(TASK_ID);
  const escrowState = Number(raw.state);
  console.log(`托管状态: ${["Matching", "Running", "Review", "Settled", "Disputed", "Cancelled"][escrowState]} · 价款 ${ethers.formatEther(raw.price)} ETH`);
  if (escrowState !== 4) {
    console.log("❌ 任务不在 Disputed 态，无法开庭（已结算的看前端法庭页卷宗）");
    return;
  }

  let c = await courtR.getCase(TASK_ID);
  const poolBefore = await courtR.rewardPool();
  const ethBefore = {};
  for (const pk of jurorPks) ethBefore[new ethers.Wallet(pk).address] = await provider.getBalance(new ethers.Wallet(pk).address);
  const treasuryBefore = await provider.getBalance(await courtR.treasury());

  // ── 第 1 步：开庭（任何人）──
  if (Number(c.phase) === 0) {
    console.log("\n① 🎲 开庭：从陪审池随机抽 3 人（排除双方当事人）…");
    const tx = await (await load("JuryCourt", "JuryCourt.sol/JuryCourt.json", deployer))
      .openCase(TASK_ID);
    await tx.wait();
    c = await courtR.getCase(TASK_ID);
  } else {
    console.log("\n① 案件已开庭，跳过");
  }
  console.log(`   合议庭：${c.panel.map((p) => short(p)).join(" / ")}`);
  console.log(`   投票截止：${new Date(Number(c.voteEnds) * 1000).toLocaleTimeString("zh-CN")}（600s 窗口）`);

  // ── 第 2 步：三票（陪审员各自钱包签名）──
  if (Number(c.phase) === 1) {
    for (let i = 0; i < 3; i++) {
      if (c.voted[i]) { console.log(`   槽位${i + 1} 已投 ${RULING_LABEL[Number(c.votes[i])]}，跳过`); continue; }
      const pk = jurorPks.find((p) => new ethers.Wallet(p).address.toLowerCase() === c.panel[i].toLowerCase());
      if (!pk) throw new Error(`槽位${i + 1} ${short(c.panel[i])} 不在 .jurors-demo.json——面板里混进了外人`);
      const juror = new ethers.Wallet(pk, provider);
      console.log(`   陪审员${i + 1} ${short(c.panel[i])} 投 ${RULING_LABEL[PLAN[i]]}${PLAN[i] === 1 ? "（少数派剧本 💸）" : ""}`);
      const tx = await (await load("JuryCourt", "JuryCourt.sol/JuryCourt.json", juror))
        .castVote(TASK_ID, PLAN[i]);
      await tx.wait();
    }
    c = await courtR.getCase(TASK_ID);
  } else {
    console.log("\n② 已宣判过，跳过投票");
  }

  // ── 第 3 步：宣判 + 结算（任何人）──
  if (Number(c.phase) === 1) {
    console.log("\n③ ⚖️ 三票齐，宣判并结算（closeCase → escrow.executeRuling 同笔交易）…");
    const tx = await (await load("JuryCourt", "JuryCourt.sol/JuryCourt.json", deployer))
      .closeCase(TASK_ID);
    await tx.wait();
    c = await courtR.getCase(TASK_ID);
  }

  // ── 第 4 步：核验 ──
  console.log(`\n④ 裁决：${RULING_LABEL[Number(c.finalRuling)]} · 托管状态 → ${Number((await escrowR.tasks(TASK_ID)).state) === 3 ? "Settled ✅" : "还没结算 ❌"}`);
  console.log(`   奖池：${YD(poolBefore)} YD → ${YD(await courtR.rewardPool())} YD（-20 发奖 +15 罚没回流）`);
  const treasuryDelta = (await provider.getBalance(await courtR.treasury())) - treasuryBefore;
  // 注意：本演示里 deployer 身兼 treasury + 胜诉 Agent（收款方），这个 delta
  // = Agent 全款 + 0.1% 手续费 − gas，别当成"手续费入账"读
  console.log(`   treasury（兼胜诉 Agent）净入账：${ethers.formatEther(treasuryDelta)} ETH`);
  for (let i = 0; i < 3; i++) {
    const addr = c.panel[i];
    const j = await courtR.jurors(addr);
    const ydNow = await ydR.balanceOf(addr);
    const ethDelta = (await provider.getBalance(addr)) - ethBefore[addr];
    const win = Number(c.votes[i]) === Number(c.finalRuling);
    // ETH 净变化被 gas 掩盖——胜方实收 arbPart（0.5% 价款 ÷ 多数方人数），减掉投票 gas 才是净额
    console.log(`   陪审员${i + 1} ${short(addr)}：${win ? "✅ 多数方" : "💸 少数方"} · 质押 ${YD(j.stake)} YD · 钱包 YD ${YD(ydNow)}${win ? "（+10 奖励）" : ""} · ETH 净额 ${ethers.formatEther(ethDelta)}（含投票 gas${win ? "，实收 arbPart" : ""}）`);
  }
  console.log("\n🎬 演示完成——前端「法庭」页可见同一进度（Relayer 已把三事件落证据链）\n");
}

main().catch((e) => { console.error("❌ 演示失败:", e.message.slice(0, 300)); process.exit(1); });
