// ═══════════════════════════════════════════════════════════════════
//  MyToken 测试 · 第 2 步
//  运行：npx hardhat test
//  环境是 Hardhat 内置本地网络（内存链，跑得快、测试之间自动隔离）
// ═══════════════════════════════════════════════════════════════════
const { expect } = require("chai");
const { ethers } = require("hardhat");
// hardhat-network-helpers（toolbox 自带）：可以"时间旅行"，测冷却时间不用真等 24h
const { time } = require("@nomicfoundation/hardhat-network-helpers");
// anyValue：事件断言里"这个参数我不关心具体值，存在就行"
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");

describe("MyToken（平台代币）", function () {
  // ── 公共夹具：每个 it 都从同一份"已部署"快照出发，互不污染 ──
  async function deployFixture() {
    // getSigners：本地网络预置 20 个有钱账号（第一个默认是部署者）
    const [owner, alice, bob] = await ethers.getSigners();

    // getContractFactory = 编译产物（ABI + bytecode）的部署工厂
    const MyToken = await ethers.getContractFactory("MyToken");
    const token = await MyToken.deploy();
    await token.waitForDeployment(); // 等部署交易上链

    return { token, owner, alice, bob };
  }

  // ─────────────────────────────────────────────────────────────
  describe("元数据与初始供应", function () {
    it("名称/符号/小数位正确", async function () {
      const { token } = await deployFixture();
      expect(await token.name()).to.equal("MyToken");
      expect(await token.symbol()).to.equal("MYT");
      expect(await token.decimals()).to.equal(18n); // v6 里返回 bigint
    });

    it("初始 100 万 MYT 全部铸造给部署者", async function () {
      const { token, owner } = await deployFixture();
      const expected = await token.INITIAL_SUPPLY(); // 常量也有自动 getter
      expect(await token.balanceOf(owner.address)).to.equal(expected);
      expect(await token.totalSupply()).to.equal(expected);
    });
  });

  // ─────────────────────────────────────────────────────────────
  describe("ERC20 转账（复习）", function () {
    it("owner 转 100 MYT 给 alice，双方余额正确变化", async function () {
      const { token, owner, alice } = await deployFixture();
      const amount = ethers.parseEther("100"); // "100 MYT" → 100×10^18 最小单位

      await expect(token.connect(owner).transfer(alice.address, amount))
        .to.changeTokenBalances(token, [owner, alice], [-amount, amount]);
      // changeTokenBalances：一条断言同时检查转出方扣款+收款方入账，最不易写错
    });
  });

  // ─────────────────────────────────────────────────────────────
  describe("faucet 水龙头（新知识：限频 mapping）", function () {
    it("首次领取成功：+20 MYT，并发出 FaucetUsed 事件", async function () {
      const { token, alice } = await deployFixture();
      const amount = ethers.parseEther("20");

      // ⚠️ 踩坑复盘：emit（查收据日志）和 changeTokenBalances（交易前后拍
      // 余额快照）不能链在同一条 expect 上——快照型匹配器只允许当链首。
      // 解法：交易只发一次，把 Promise 存下来分两条断言。
      // （Promise 可被多次 await，各自拿结果，链上只有一笔交易）
      const tx = token.connect(alice).faucet(); // 注意：故意不 await，留住 Promise

      await expect(tx)
        .to.emit(token, "FaucetUsed") // 事件断言：user 和 amount 必须精确匹配
        .withArgs(alice.address, amount, anyValue); // nextAvailableAt 不关心精确值
      await expect(tx).to.changeTokenBalances(token, [alice], [amount]);
    });

    it("冷却期内再领 → revert（require 字符串匹配）", async function () {
      const { token, alice } = await deployFixture();
      await token.connect(alice).faucet();

      // 字符串报错用 revertedWith（对应合约里的 require("...")）
      await expect(token.connect(alice).faucet()).to.be.revertedWith(
        "MyToken: faucet cooldown, try later"
      );
    });

    it("时间旅行 24h 后可再领（不用真等）", async function () {
      const { token, alice } = await deployFixture();
      await token.connect(alice).faucet();

      // 核心：Hardhat 允许直接拨快 evm.time，一毫秒都不用等
      await time.increase(24n * 60n * 60n + 1n);
      await expect(token.connect(alice).faucet()).to.changeTokenBalances(
        token,
        [alice],
        [ethers.parseEther("20")]
      );
    });
  });

  // ─────────────────────────────────────────────────────────────
  describe("airdrop 批量空投（新知识：onlyOwner + calldata 数组）", function () {
    it("owner 批量发 [10, 20] MYT 给 alice/bob，余额各就各位", async function () {
      const { token, alice, bob } = await deployFixture();
      await token.airdrop(
        [alice.address, bob.address],
        [ethers.parseEther("10"), ethers.parseEther("20")]
      );
      expect(await token.balanceOf(alice.address)).to.equal(
        ethers.parseEther("10")
      );
      expect(await token.balanceOf(bob.address)).to.equal(
        ethers.parseEther("20")
      );
    });

    it("非 owner 调用 → OZ5 自定义错误 OwnableUnauthorizedAccount", async function () {
      const { token, alice } = await deployFixture();
      // OZ 5.x 用 custom error 而非 revert 字符串（省 gas、结构化），
      // 断言用 revertedWithCustomError（理解题 Q3）
      await expect(
        token.connect(alice).airdrop([alice.address], [ethers.parseEther("1")])
      ).to.be.revertedWithCustomError(token, "OwnableUnauthorizedAccount");
    });

    it("地址数与金额数不匹配 → revert", async function () {
      const { token, alice, bob } = await deployFixture();
      await expect(
        token.airdrop([alice.address, bob.address], [ethers.parseEther("1")])
      ).to.be.revertedWith("MyToken: recipients/amounts length mismatch");
    });
  });
});
