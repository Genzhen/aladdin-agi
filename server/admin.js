// ═══════════════════════════════════════════════════════════════════
//  admin.js —— 带私钥的"特权操作"签名者（和只读 chain.js 相对）
//  用途：结算后自动 updateScore 上链（Relayer 里调用）。
//  私钥来自项目根 ../.env 的 PRIVATE_KEY（= 合约 owner / 部署钱包）。
//  ⚠️ 生产替换点：私钥进 KMS/Secrets Manager；签名与 API 进程隔离。
// ═══════════════════════════════════════════════════════════════════
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");
const { provider, deployed } = require("./chain");

const raw = (process.env.PRIVATE_KEY || "").replace(/[^0-9a-fA-F]/g, "");
if (!raw) {
  console.warn("⚠️ [admin] 根目录 .env 没有 PRIVATE_KEY——评分将只落库不上链");
}

// ethers.Wallet 要 0x 前缀私钥；raw 已过滤成纯 hex
const signer = raw ? new ethers.Wallet("0x" + raw, provider) : null;

function loadAbi(solFile) {
  return JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "artifacts", "contracts", solFile), "utf8")
  ).abi;
}

/** registry 的可写实例（onlyOwner: updateScore） */
const registryWriter = signer
  ? new ethers.Contract(deployed.contracts.AgentRegistry, loadAbi("AgentRegistry.sol/AgentRegistry.json"), signer)
  : null;

/** 五维综合分上链（fire-and-forget 用：返回 txPromise，调用方自己 .catch） */
async function updateScoreOnchain(agentId, score) {
  if (!registryWriter) return null;
  const tx = await registryWriter.updateScore(agentId, score);
  const rc = await tx.wait();
  console.log(`🧮 [admin] updateScore Agent#${agentId} → ${score}（tx ${rc.hash}）`);
  return rc;
}

/** escrow 的可写实例：Agent 执行体交付后代工程师 submit（Running → Review） */
const escrowWriter = signer
  ? new ethers.Contract(deployed.contracts.TaskEscrow, loadAbi("TaskEscrow.sol/TaskEscrow.json"), signer)
  : null;

/**
 * 代签 submit：合法是因为合约校验 msg.sender == t.agent，而演示里
 * 所有 Agent 的 owner 都是这把部署钱包。生产替换点：Agent 服务自己
 * 持钥签名（或工程师手签），relayer 只做事件路由不做代签。
 */
async function submitOnchain(taskId) {
  if (!escrowWriter) return null;
  const tx = await escrowWriter.submit(taskId);
  const rc = await tx.wait();
  console.log(`📤 [admin] submit 任务#${taskId} → review（tx ${rc.hash}）`);
  return rc;
}

module.exports = { updateScoreOnchain, submitOnchain, adminAddress: signer ? signer.address : null };
