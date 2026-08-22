// ═══════════════════════════════════════════════════════════════════
//  smoke-agent-online.js —— 线上执行体自动交付链路冒烟（2026-08-22）
//  验证:草稿→质押→匹配→接单 之后,线上 Relayer 自动 POST 执行体、
//  交付物落 task_results、代签 submit 上链(全程无人手)。
//  用法(记得清代理变量,坑#11):
//    env -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u NODE_USE_ENV_PROXY \
//      PRICE_ETH=0.01 npx hardhat run scripts/smoke-agent-online.js --network sepolia
// ═══════════════════════════════════════════════════════════════════
const hre = require("hardhat");
const fs = require("fs");

const API = "https://aladdin.myanext.com";

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const deployed = JSON.parse(fs.readFileSync("deployed.json", "utf8")).contracts;
  const escrow = await hre.ethers.getContractAt("TaskEscrow", deployed.TaskEscrow);

  const price = hre.ethers.parseEther(process.env.PRICE_ETH || "0.01");
  const fee = (price * 10n) / 10_000n;      // 0.1% 平台费
  const deposit = (price * 600n) / 10_000n; // 6% 保证金
  const deadline = BigInt(Math.floor(Date.now() / 1000)) + 3n * 24n * 3600n;

  // 1. 草稿进线上库（category=Writing → 漏斗第二层命中 Agent#1）
  const draft = await fetch(`${API}/api/tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      publisher: deployer.address,
      priceEth: hre.ethers.formatEther(price),
      deadline: Number(deadline),
      title: "冒烟:写一条产品发布推文",
      category: "Writing",
      tags: "copy,launch",
      description: "为「阿拉丁AGI」写一条200字内发布推文,突出:Agent市场、托管结算、交付即打款。",
    }),
  }).then((r) => r.json());
  console.log("① 草稿:", JSON.stringify(draft));

  // 2. 链上质押（Relayer 听 TaskPosted 按 publisher+price 合体草稿）
  let tx = await escrow.postTask(price, deadline, { value: price + fee });
  await tx.wait();
  const id = Number(await escrow.nextTaskId()) - 1;
  console.log(`② 任务#${id} 质押 ${hre.ethers.formatEther(price + fee)} ETH  tx=${tx.hash}`);

  // 3. 等引擎消费队列做完匹配，再接单
  await new Promise((r) => setTimeout(r, 8000));
  tx = await escrow.accept(id, 1, { value: deposit }); // Agent#1 owner=部署钱包,可签
  await tx.wait();
  console.log(`③ Agent#1 接单(锁 ${hre.ethers.formatEther(deposit)} ETH)  tx=${tx.hash}`);
  console.log(`④ 撒手。接下来该线上 Relayer→writer 执行体→代签 submit 全自动`);
  console.log(`   验证:打开 ${API}/task/${id} 或查 GET ${API}/api/tasks/${id}`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
