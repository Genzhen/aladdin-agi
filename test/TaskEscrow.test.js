// ═══════════════════════════════════════════════════════════════════
//  TaskEscrow 测试 · 第 3 步 ★核心
//  运行：npx hardhat test test/TaskEscrow.test.js
//  覆盖：状态机全路径 + 每一步的资金流对账（changeEtherBalances）
// ═══════════════════════════════════════════════════════════════════
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("TaskEscrow（状态机 + 资金托管）", function () {
  // ── 角色固定：平台 / 工程师 / 雇主 / 路人 ──
  async function deployFixture() {
    const [platform, engineer, publisher, stranger] = await ethers.getSigners();

    const Registry = await ethers.getContractFactory("AgentRegistry");
    const registry = await Registry.deploy();
    await registry.waitForDeployment();

    // Escrow 构造时要 Registry 的地址（合约间调用的"接线"）
    const Escrow = await ethers.getContractFactory("TaskEscrow");
    const escrow = await Escrow.deploy(await registry.getAddress());
    await escrow.waitForDeployment();

    // 工程师上架 Agent（id=1）
    await registry
      .connect(engineer)
      .register("ScriptWriter Pro", "Writing", "script,drama", ethers.parseEther("0.05"));

    return { registry, escrow, platform, engineer, publisher, stranger };
  }

  // ── 金额口径与合约常量完全一致（bps 整数运算）──
  const PRICE = ethers.parseEther("0.1"); // 出价 0.1 ETH（S4 设计稿同款）
  const feeOf = (p) => (p * 10n) / 10_000n; // 0.1% 手续费 = 0.0001 ETH
  const depositOf = (p) => (p * 600n) / 10_000n; // 6% 保证金 = 0.006 ETH
  const arbFeeOf = (p) => (p * 50n) / 10_000n; // 0.5% 仲裁费

  // enum 在测试里是数字：Matching=0 Running=1 Review=2 Settled=3 Disputed=4 Cancelled=5
  const STATE = { Matching: 0n, Running: 1n, Review: 2n, Settled: 3n, Disputed: 4n, Cancelled: 5n };
  // Ruling：AgentWins=0 PublisherWins=1 Split=2

  async function postTask(escrow, publisher) {
    // ⚠️ time.latest() 返回 Number，加 BigInt 前必须显式转换（否则 TypeError）
    const deadline = BigInt(await time.latest()) + 3n * 24n * 3600n; // 3 天后
    await escrow.connect(publisher).postTask(PRICE, deadline, {
      value: PRICE + feeOf(PRICE),
    });
  }
  async function postAndAccept(escrow, engineer, publisher) {
    await postTask(escrow, publisher);
    await escrow.connect(engineer).accept(1, 1, { value: depositOf(PRICE) });
  }
  async function fullFlowToReview(escrow, engineer, publisher) {
    await postAndAccept(escrow, engineer, publisher);
    await escrow.connect(engineer).submit(1);
  }

  // ═══════════════ ① 发布 ═══════════════
  describe("postTask 发布质押", function () {
    it("质押精确金额成功，状态 Matching，发出 TaskPosted", async function () {
      const { escrow, publisher } = await deployFixture();
      const deadline = BigInt(await time.latest()) + 3n * 24n * 3600n;

      await expect(
        escrow.connect(publisher).postTask(PRICE, deadline, {
          value: PRICE + feeOf(PRICE),
        })
      )
        .to.emit(escrow, "TaskPosted")
        .withArgs(1n, publisher.address, PRICE, PRICE + feeOf(PRICE), deadline);

      const t = await escrow.tasks(1);
      expect(t.publisher).to.equal(publisher.address);
      expect(t.state).to.equal(STATE.Matching);
      // 合约余额 = 托管的钱（支付宝类比：钱进了平台担保户，不在任何人手里）
      expect(await ethers.provider.getBalance(escrow.getAddress())).to.equal(
        PRICE + feeOf(PRICE)
      );
    });

    it("多付/少付 → revert（精确相等校验）", async function () {
      const { escrow, publisher } = await deployFixture();
      const deadline = BigInt(await time.latest()) + 3600n;
      await expect(
        escrow.connect(publisher).postTask(PRICE, deadline, {
          value: PRICE + feeOf(PRICE) + 1n, // 多付 1 wei
        })
      ).to.be.revertedWith("Escrow: stake must equal price + 0.1% fee");
    });

    it("deadline 已过期 → revert", async function () {
      const { escrow, publisher } = await deployFixture();
      await expect(
        escrow.connect(publisher).postTask(PRICE, BigInt(await time.latest()) - 1n, {
          value: PRICE + feeOf(PRICE),
        })
      ).to.be.revertedWith("Escrow: deadline in past");
    });
  });

  // ═══════════════ ② 接单 ═══════════════
  describe("accept 接单锁保证金", function () {
    it("Agent 主人接单：锁 6% 保证金，状态 Running", async function () {
      const { escrow, engineer, publisher } = await deployFixture();
      await postTask(escrow, publisher);

      const deposit = depositOf(PRICE); // 0.006 ETH
      // 老坑新踩：emit 和 changeEtherBalances 不能链在一条 expect 上
      // ——拆两条，交易 Promise 存变量，链上只有一笔交易
      const tx = escrow.connect(engineer).accept(1, 1, { value: deposit });
      await expect(tx)
        .to.emit(escrow, "AgentAccepted")
        .withArgs(1n, 1n, engineer.address, deposit);
      await expect(tx).to.changeEtherBalances([escrow, engineer], [deposit, -deposit]);

      const t = await escrow.tasks(1);
      expect(t.agent).to.equal(engineer.address);
      expect(t.state).to.equal(STATE.Running);
    });

    it("不是 Agent 主人接单 → revert（跨合约校验身份）", async function () {
      const { escrow, publisher, stranger } = await deployFixture();
      await postTask(escrow, publisher);
      await expect(
        escrow.connect(stranger).accept(1, 1, { value: depositOf(PRICE) })
      ).to.be.revertedWith("Escrow: caller is not this agent's owner");
    });

    it("保证金金额不对 → revert", async function () {
      const { escrow, engineer, publisher } = await deployFixture();
      await postTask(escrow, publisher);
      await expect(
        escrow.connect(engineer).accept(1, 1, { value: depositOf(PRICE) + 1n })
      ).to.be.revertedWith("Escrow: deposit must equal 6% of price");
    });
  });

  // ═══════════════ ③④ 交付 + 验收 ═══════════════
  describe("submit / approve 交付验收", function () {
    it("只有接单 Agent 能 submit；正常提交后状态到 Review", async function () {
      const { escrow, engineer, publisher, stranger } = await deployFixture();
      await postAndAccept(escrow, engineer, publisher);

      // 路人来提交：状态对（Running）但身份不对 → 被"only the agent"拦下
      await expect(escrow.connect(stranger).submit(1)).to.be.revertedWith(
        "Escrow: only the agent can submit"
      );
      // 接单工程师提交：Running → Review
      await expect(escrow.connect(engineer).submit(1))
        .to.emit(escrow, "TaskSubmitted")
        .withArgs(1n);
      expect((await escrow.tasks(1)).state).to.equal(STATE.Review);
    });

    it("验收放款：Agent 收价款+退保证金，平台收手续费，状态 Settled", async function () {
      const { escrow, platform, engineer, publisher } = await deployFixture();
      await fullFlowToReview(escrow, engineer, publisher);

      const payout = PRICE + depositOf(PRICE); // 0.1 + 0.006
      const tx = escrow.connect(publisher).approve(1); // 存 Promise 分两段断言
      await expect(tx).to.emit(escrow, "TaskApproved").withArgs(1n, engineer.address, payout);
      await expect(tx).to.changeEtherBalances(
        [engineer, platform, publisher],
        [payout, feeOf(PRICE), 0n] // 雇主的钱发布时就已花出，此步不再动
      );
      expect((await escrow.tasks(1)).state).to.equal(STATE.Settled);
      expect(await ethers.provider.getBalance(escrow.getAddress())).to.equal(0n); // 清空
    });

    it("非雇主验收 / 重复验收 → revert", async function () {
      const { escrow, engineer, publisher, stranger } = await deployFixture();
      await fullFlowToReview(escrow, engineer, publisher);

      await expect(escrow.connect(stranger).approve(1)).to.be.revertedWith(
        "Escrow: only publisher can approve"
      );
      await escrow.connect(publisher).approve(1);
      await expect(escrow.connect(publisher).approve(1)).to.be.revertedWith(
        "Escrow: task not in review" // 已 Settled，状态机不回头
      );
    });
  });

  // ═══════════════ ⑤⑥ 争议 + 裁决 ═══════════════
  describe("openDispute / executeRuling 争议裁决", function () {
    it("雇主发起争议 → 冻结（Disputed）", async function () {
      const { escrow, engineer, publisher } = await deployFixture();
      await fullFlowToReview(escrow, engineer, publisher);
      await expect(escrow.connect(publisher).openDispute(1))
        .to.emit(escrow, "DisputeOpened")
        .withArgs(1n, publisher.address);
      expect((await escrow.tasks(1)).state).to.equal(STATE.Disputed);
    });

    it("裁决 Split：价款对半分，退保证金，扣仲裁费（三账户对账）", async function () {
      const { escrow, platform, engineer, publisher } = await deployFixture();
      await fullFlowToReview(escrow, engineer, publisher);
      await escrow.connect(publisher).openDispute(1);

      const pot = PRICE - arbFeeOf(PRICE);
      const tx = escrow.connect(platform).executeRuling(1, 2); // Ruling.Split
      await expect(tx).to.emit(escrow, "TaskRuled").withArgs(1n, 2n, arbFeeOf(PRICE));
      await expect(tx).to.changeEtherBalances(
        [engineer, publisher, platform],
        [pot / 2n + depositOf(PRICE), pot / 2n, arbFeeOf(PRICE) + feeOf(PRICE)]
      );
      expect((await escrow.tasks(1)).state).to.equal(STATE.Settled);
    });

    it("非平台执行裁决 → custom error", async function () {
      const { escrow, engineer, publisher, stranger } = await deployFixture();
      await fullFlowToReview(escrow, engineer, publisher);
      await escrow.connect(publisher).openDispute(1);
      await expect(
        escrow.connect(stranger).executeRuling(1, 0)
      ).to.be.revertedWithCustomError(escrow, "OwnableUnauthorizedAccount");
    });
  });

  // ═══════════════ ⑦ 超时兜底 ═══════════════
  describe("claimTimeout 超时兜底", function () {
    it("Matching 无人接：路人也能触发，雇主全额回款", async function () {
      const { escrow, publisher, stranger } = await deployFixture();
      await postTask(escrow, publisher);

      await time.increase(4n * 24n * 3600n); // 时间旅行过期限
      const tx = escrow.connect(stranger).claimTimeout(1); // ⚠️ 路人调
      await expect(tx).to.emit(escrow, "TaskCancelled").withArgs(1n, publisher.address, false);
      await expect(tx).to.changeEtherBalances(
        [publisher, stranger],
        [PRICE + feeOf(PRICE), 0n] // 钱只进雇主口袋；触发者分文不取
      );
      expect((await escrow.tasks(1)).state).to.equal(STATE.Cancelled);
    });

    it("Running 未交付：雇主拿回价款+手续费+罚没的保证金", async function () {
      const { escrow, engineer, publisher, stranger } = await deployFixture();
      await postAndAccept(escrow, engineer, publisher);

      await time.increase(4n * 24n * 3600n);
      const tx = escrow.connect(stranger).claimTimeout(1);
      await expect(tx).to.emit(escrow, "TaskCancelled").withArgs(1n, publisher.address, true);
      await expect(tx).to.changeEtherBalances(
        [publisher, engineer],
        [PRICE + feeOf(PRICE) + depositOf(PRICE), 0n] // 保证金赔给雇主
      );
    });

    it("期限未到 → revert", async function () {
      const { escrow, publisher, stranger } = await deployFixture();
      await postTask(escrow, publisher);
      await expect(escrow.connect(stranger).claimTimeout(1)).to.be.revertedWith(
        "Escrow: deadline not passed yet"
      );
    });
  });
});
