// ═══════════════════════════════════════════════════════════════════
//  airdrop.js —— 把后端记的空投账本真实发上链（owner 钱包批量 airdrop）
//  流程：GET /api/airdrop/pending → 按地址聚合 → MyToken.airdrop(to[], amount[])
//        → POST /api/airdrop/mark-sent 销账。链是发钱的真相源，库只是待办清单。
//  用法：node scripts/airdrop.js   （需 server 跑着；MetaMask 里也有同款按钮）
// ═══════════════════════════════════════════════════════════════════
require("dotenv").config();
const fs = require("fs");
const { ethers } = require("ethers");

const API = process.env.API_BASE || "http://localhost:3001";

async function main() {
  const deployed = JSON.parse(fs.readFileSync("deployed.json", "utf8")).contracts;
  const provider = new ethers.JsonRpcProvider(
    process.env.SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com"
  );
  const wallet = new ethers.Wallet("0x" + (process.env.PRIVATE_KEY || "").replace(/^0x/, ""), provider);
  const token = new ethers.Contract(
    deployed.MyToken,
    ["function airdrop(address[] calldata to, uint256[] calldata amounts)", "event Airdropped(address indexed sender, uint256 count, uint256 totalAmount)"],
    wallet
  );

  // ① 拉待发账本
  const pending = await (await fetch(`${API}/api/airdrop/pending`)).json();
  if (!pending.length) return console.log("没有待发空投");
  console.log(`待发 ${pending.length} 笔，按地址聚合…`);

  // ② 聚合（同一地址多笔合成一笔，省 gas）
  const byAddr = new Map();
  for (const r of pending) {
    const addr = r.addr.toLowerCase();
    byAddr.set(addr, (byAddr.get(addr) || 0n) + BigInt(r.amount_wei));
  }
  const to = [...byAddr.keys()];
  const amounts = [...byAddr.values()];
  const total = amounts.reduce((s, v) => s + v, 0n);
  console.log(`→ ${to.length} 个地址，共 ${ethers.formatEther(total)} MYT`);

  // ③ 链上批量发放
  const tx = await token.airdrop(to, amounts);
  const rc = await tx.wait();
  console.log(`✅ airdrop tx: ${rc.hash}`);

  // ④ 回报销账
  const mark = await fetch(`${API}/api/airdrop/mark-sent`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ txHash: rc.hash, addresses: to }),
  }).then((r) => r.json());
  console.log(`📒 后端销账: ${JSON.stringify(mark)}`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
