// ═══════════════════════════════════════════════════════════════════
//  l3-e2e-test.js —— L3 双钱包全链路自动化验证（服务器自签 submit 实证）
//
//  一次跑完：发草稿 → 部署者签 postTask → 第二钱包(0x3bea)签 accept
//  → 【等服务器上的 xhs-agent 干活后自签 submit】→ 部署者打星 + approve
//  → 验证 settled 与两边余额回流。全程零平台代签——accept/submit 两个
//  合法签名者都不是平台钱包，这正是 L3 要证明的。
//  用法：node scripts/l3-e2e-test.js（依赖根 .env 的 PRIVATE_KEY / XHS_PRIVATE_KEY）
// ═══════════════════════════════════════════════════════════════════
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

const ROOT = path.join(__dirname, "..");
const API = "https://aladdin.myanext.com";
const AGENT_ID = 18;                       // 小红书文案师（owner=第二钱包）
const PRICE_ETH = "0.001";
const BPS_DEPOSIT = 600n, BPS_SCALE = 10_000n;

const norm = (k) => { const raw = String(k || "").replace(/^0[xX]/, "").replace(/[^0-9a-fA-F]/g, "");
  if (raw.length !== 64) throw new Error(`私钥长度 ${raw.length} ≠ 64（.env 里 key 形状不对）`);
  return "0x" + raw; };
const deployed = JSON.parse(fs.readFileSync(path.join(ROOT, "deployed.json"), "utf8"));
const abi = JSON.parse(fs.readFileSync(path.join(ROOT, "artifacts/contracts/TaskEscrow.sol/TaskEscrow.json"), "utf8")).abi;
const registryAbi = JSON.parse(fs.readFileSync(path.join(ROOT, "artifacts/contracts/AgentRegistry.sol/AgentRegistry.json"), "utf8")).abi;

const provider = new ethers.JsonRpcProvider(process.env.SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com");
const deployer = new ethers.Wallet(norm(process.env.PRIVATE_KEY), provider);
const xhs = new ethers.Wallet(norm(process.env.XHS_PRIVATE_KEY), provider);
const escrowD = new ethers.Contract(deployed.contracts.TaskEscrow, abi, deployer);
const escrowX = new ethers.Contract(deployed.contracts.TaskEscrow, abi, xhs);
const registry = new ethers.Contract(deployed.contracts.AgentRegistry, registryAbi, deployer);

const eth = (h) => "https://sepolia.etherscan.io/tx/" + h;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const bal = async (w) => Number(ethers.formatEther(await provider.getBalance(w.address)));

(async () => {
  console.log(`部署者 ${deployer.address} · 第二钱包 ${xhs.address}`);
  // 前置断言：Agent#18 的 owner 必须是第二钱包（L3 前提，错了全盘无意义）
  const owner = await registry.ownerOf(AGENT_ID);
  if (owner.toLowerCase() !== xhs.address.toLowerCase()) throw new Error(`Agent#${AGENT_ID} owner=${owner} ≠ 第二钱包`);
  console.log(`✅ 链上确认 Agent#${AGENT_ID} owner = 第二钱包（accept 只能它签）`);

  const dBal0 = await bal(deployer), xBal0 = await bal(xhs);
  const priceWei = ethers.parseEther(PRICE_ETH);
  const fee = (priceWei * 10n) / BPS_SCALE;          // 0.1% 平台手续费（质押时一并锁）
  const deposit = (priceWei * BPS_DEPOSIT) / BPS_SCALE;
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 86_400);

  // ① 草稿落库（长文本进 task_drafts，链上只质押）
  const dr = await fetch(`${API}/api/tasks`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ publisher: deployer.address, priceEth: PRICE_ETH, deadline: Number(deadline),
      title: "端午粽子礼盒小红书种草笔记", category: "Content", tags: "小红书,种草,文案",
      description: "写一篇 500 字左右的小红书笔记：手工粽子礼盒，目标人群 25-35 岁都市女性，要有 emoji 标题、hook 开头、3 个话题标签，语气亲切不硬广。" }) }).then((r) => r.json());
  if (!dr.ok) throw new Error("草稿失败: " + JSON.stringify(dr));
  console.log(`① 草稿 #${dr.draftId} 落库`);

  // ② 部署者签 postTask（雇主质押）
  const rc1 = await (await escrowD.postTask(priceWei, deadline, { value: priceWei + fee })).wait();
  const ev = rc1.logs.map((l) => { try { return escrowD.interface.parseLog(l); } catch { return null; } }).find((p) => p?.name === "TaskPosted");
  const taskId = ev.args.id;
  console.log(`② postTask ✅ 任务#${taskId} → ${eth(rc1.hash)}（雇主签名）`);

  // ③ 第二钱包签 accept（保证金 6%）——赶在 auto-dispatch 45s 手动窗口内
  const rc2 = await (await escrowX.accept(taskId, AGENT_ID, { value: deposit })).wait();
  console.log(`③ accept ✅ 锁保证金 ${ethers.formatEther(deposit)} ETH → ${eth(rc2.hash)}（第二钱包签名）`);
  console.log(`④ 等服务器 xhs-agent 干活 + 自签 submit（DeepSeek 约 1 分钟，最长等 3 分钟）…`);

  // ④ 轮询任务状态：review = 服务器自签 submit 已被 Relayer 收账（本地脚本全程不碰 submit）
  let t = null;
  for (let i = 0; i < 36; i++) {
    await sleep(5000);
    t = await fetch(`${API}/api/tasks/${taskId}`).then((r) => r.json());
    if (t.state === "review") break;
    process.stdout.write(`  ${i * 5 + 5}s state=${t.state}\r`);
  }
  console.log("");
  if (t.state !== "review") throw new Error(`3 分钟仍停在 ${t.state}——服务器自签 submit 没跑通，查 pm2 logs`);
  console.log(`④ 自签 submit ✅ 任务#${taskId} → review（平台零参与，交付物 ${(t.deliverable?.output || "").length} 字）`);
  console.log(`   成果开头：${(t.deliverable?.output || "").slice(0, 60)}…`);

  // ⑤ 雇主打星（先库后链，同前端 RatePanel 顺序）+ approve 放款
  const rr = await fetch(`${API}/api/tasks/${taskId}/rate`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ rating: 5, publisher: deployer.address }) }).then((r) => r.json());
  if (!rr.ok) throw new Error("打星失败: " + JSON.stringify(rr));
  const rc3 = await (await escrowD.approve(taskId)).wait();
  console.log(`⑤ 验收放款 ✅ 5星 → ${eth(rc3.hash)}（雇主签名）`);

  // ⑥ 终态与资金回流
  for (let i = 0; i < 12 && t.state !== "settled"; i++) { await sleep(5000); t = await fetch(`${API}/api/tasks/${taskId}`).then((r) => r.json()); }
  const dBal1 = await bal(deployer), xBal1 = await bal(xhs);
  console.log("⑥ 终态:", t.state, `· rating: ${t.rating}`);
  console.log(`   第二钱包 ${xBal0.toFixed(5)} → ${xBal1.toFixed(5)} ETH（Δ${(xBal1 - xBal0).toFixed(5)}：货款+保证金回流-手续费）`);
  console.log(`   部署者   ${dBal0.toFixed(5)} → ${dBal1.toFixed(5)} ETH（Δ${(dBal1 - dBal0).toFixed(5)}：-货款-手续费+平台费）`);
  console.log(t.state === "settled" ? "\n🎉 L3 闭环完整跑通：accept/submit 两个签名都出自第二钱包，平台全程纯路由" : "\n⚠️ 未到 settled，再查");
  process.exit(t.state === "settled" ? 0 : 1);
})().catch((e) => { console.error("❌", e.shortMessage || e.message); process.exit(1); });
