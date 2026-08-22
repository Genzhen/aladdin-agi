// ═══════════════════════════════════════════════════════════════════
//  JuryCourt 测试 · 第 11 步 ★裁决权去中心化
//  运行：npx hardhat test test/JuryCourt.test.js
//  覆盖：质押入池/抽签排除双方/明票投票/严格多数结算/slash 少数方/
//        平票与零票兜底（不赏不罚）/金库手续费/保险丝收回所有权
// ═══════════════════════════════════════════════════════════════════
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("JuryCourt（陪审团法庭）", function () {
  async function deployFixture() {
    const [platform, engineer, publisher, stranger, j1, j2, j3, j4] =
      await ethers.getSigners();

    const YD = await ethers.getContractFactory("YidengToken");
    const yd = await YD.deploy();
    await yd.waitForDeployment();

    const Registry = await ethers.getContractFactory("AgentRegistry");
    const registry = await Registry.deploy();
    await registry.waitForDeployment();

    const Escrow = await ethers.getContractFactory("TaskEscrow");
    const escrow = await Escrow.deploy(await registry.getAddress());
    await escrow.waitForDeployment();

    // VOTE_PERIOD=600s（线上部署同款口径）
    const Court = await ethers.getContractFactory("JuryCourt");
    const court = await Court.deploy(
      await yd.getAddress(),
      await escrow.getAddress(),
      platform.address,
      600
    );
    await court.waitForDeployment();

    // ★关键一步：escrow 裁决权移交给法庭（executeRuling 的 onlyOwner 换人）
    await escrow.transferOwnership(await court.getAddress());

    // 工程师上架 Agent（id=1）
    await registry
      .connect(engineer)
      .register("ScriptWriter Pro", "Writing", "script", ethers.parseEther("0.05"));

    // 4 名陪审员：各领 200 YD → approve → stake 100（手里剩 100）
    const courtAddr = await court.getAddress();
    for (const j of [j1, j2, j3, j4]) {
      await yd.connect(platform).transfer(j.address, ethers.parseEther("200"));
      await yd.connect(j).approve(courtAddr, ethers.parseEther("200"));
      await court.connect(j).stake(ethers.parseEther("100"));
    }
    // 奖池注资 5000 YD（部署即送陪审奖励的口径）
    await yd.connect(platform).transfer(courtAddr, ethers.parseEther("5000"));

    return { yd, registry, escrow, court, platform, engineer, publisher, stranger, jurors: [j1, j2, j3, j4] };
  }

  const PRICE = ethers.parseEther("0.1");
  const feeOf = (p) => (p * 10n) / 10_000n;
  const depositOf = (p) => (p * 600n) / 10_000n;
  const arbFeeOf = (p) => (p * 50n) / 10_000n;
  const STAKE = ethers.parseEther("100");
  const SLASH = (STAKE * 1500n) / 10_000n; // 15 YD
  const REWARD = ethers.parseEther("10");

  // 走到 Disputed：postTask → accept → submit → openDispute
  async function toDisputed(escrow, engineer, publisher, id) {
    const deadline = BigInt(await time.latest()) + 3n * 24n * 3600n;
    await escrow.connect(publisher).postTask(PRICE, deadline, { value: PRICE + feeOf(PRICE) });
    await escrow.connect(engineer).accept(id, 1, { value: depositOf(PRICE) });
    await escrow.connect(engineer).submit(id);
    await escrow.connect(publisher).openDispute(id);
  }

  // 开案并返回按座位排序的陪审员 signer（面板随机抽，按地址找人）
  async function openAndPanel(court, jurors, id) {
    await court.openCase(id);
    const c = await court.getCase(id);
    const byAddr = new Map(jurors.map((j) => [j.address.toLowerCase(), j]));
    return { panel: c.panel.map((a) => byAddr.get(a.toLowerCase())), info: c };
  }

  // ═══════════════ ① 质押入池 ═══════════════
  describe("stake / unstake 陪审员池", function () {
    it("质押 100 YD 入池：记账正确，陪审员数可查", async function () {
      const { court, jurors } = await deployFixture();
      expect(await court.jurorCount()).to.equal(4n);
      const j = await court.jurors(jurors[0].address);
      expect(j.stake).to.equal(STAKE);
      expect(j.activeCaseId).to.equal(0n);
    });

    it("没 approve 就 stake → revert（OZ ERC20 先抛自定义错误，require 根本走不到）", async function () {
      const { yd, court, stranger } = await deployFixture();
      await yd.transfer(stranger.address, STAKE);
      await expect(court.connect(stranger).stake(STAKE)).to.be.revertedWithCustomError(
        yd,
        "ERC20InsufficientAllowance"
      );
    });

    it("在案不许退质押；未被抽中的随时可退（池里 4 人抽 3 人）", async function () {
      const { yd, court, escrow, engineer, publisher, jurors } = await deployFixture();
      await toDisputed(escrow, engineer, publisher, 1);
      const { panel } = await openAndPanel(court, jurors, 1);
      await expect(court.connect(panel[0]).unstake(STAKE)).to.be.revertedWith(
        "Court: juror in active case"
      );
      const notDrawn = jurors.find((j) => !panel.includes(j));
      await expect(court.connect(notDrawn).unstake(STAKE)).to.changeTokenBalance(
        yd, notDrawn, STAKE
      );
    });
  });

  // ═══════════════ ② 开庭抽签 ═══════════════
  describe("openCase 开庭抽签", function () {
    it("任务不在 Disputed → revert", async function () {
      const { court } = await deployFixture();
      await expect(court.openCase(1)).to.be.revertedWith("Court: task not disputed");
    });

    it("抽 3 人：互不相同、排除当事双方、锁人在案、重复开案 revert", async function () {
      const { court, escrow, engineer, publisher, jurors } = await deployFixture();
      await toDisputed(escrow, engineer, publisher, 1);
      await expect(court.openCase(1)).to.emit(court, "CaseOpened");

      const c = await court.getCase(1);
      const panel = c.panel.map((a) => a.toLowerCase());
      expect(new Set(panel).size).to.equal(3); // 互不相同
      expect(panel).to.not.include(publisher.address.toLowerCase()); // 排除当事双方
      expect(panel).to.not.include(engineer.address.toLowerCase());
      for (const a of panel) {
        expect((await court.jurors(a)).activeCaseId).to.equal(1n); // 锁人
      }
      await expect(court.openCase(1)).to.be.revertedWith("Court: case already opened");
    });

    it("合格陪审员不足 3 人 → revert（资格线=100 YD）", async function () {
      const { yd, court, escrow, engineer, publisher, stranger, jurors } =
        await deployFixture();
      await toDisputed(escrow, engineer, publisher, 1);
      // stranger 质押 50（够 stake 但不过资格线）；原 4 人退掉 2 个 → 合格只剩 2
      await yd.transfer(stranger.address, ethers.parseEther("50"));
      await yd.connect(stranger).approve(await court.getAddress(), ethers.parseEther("50"));
      await court.connect(stranger).stake(ethers.parseEther("50"));
      await court.connect(jurors[2]).unstake(STAKE);
      await court.connect(jurors[3]).unstake(STAKE);
      await expect(court.openCase(1)).to.be.revertedWith("Court: not enough jurors");
    });
  });

  // ═══════════════ ③ 投票 ═══════════════
  describe("castVote 明票投票", function () {
    it("非陪审员 / 重复投票 → revert；陪审员投票成功", async function () {
      const { court, escrow, engineer, publisher, stranger, jurors } = await deployFixture();
      await toDisputed(escrow, engineer, publisher, 1);
      const { panel } = await openAndPanel(court, jurors, 1);
      await expect(court.connect(stranger).castVote(1, 0)).to.be.revertedWith(
        "Court: not on this panel"
      );
      await expect(court.connect(panel[0]).castVote(1, 0)).to.emit(court, "VoteCast");
      await expect(court.connect(panel[0]).castVote(1, 1)).to.be.revertedWith(
        "Court: already voted"
      );
    });

    it("投票期过后 → revert", async function () {
      const { court, escrow, engineer, publisher, jurors } = await deployFixture();
      await toDisputed(escrow, engineer, publisher, 1);
      const { panel, info } = await openAndPanel(court, jurors, 1);
      await time.increaseTo(info.voteEnds + 1n);
      await expect(court.connect(panel[0]).castVote(1, 0)).to.be.revertedWith(
        "Court: vote period over"
      );
    });
  });

  // ═══════════════ ④ 宣判结算 ═══════════════
  describe("closeCase 严格多数结算", function () {
    it("2v1：多数方分仲裁费+YD 奖励，少数方被 slash，escrow 进 Settled", async function () {
      const { yd, court, escrow, engineer, publisher, stranger, jurors, platform } =
        await deployFixture();
      await toDisputed(escrow, engineer, publisher, 1);
      const { panel } = await openAndPanel(court, jurors, 1);

      // 座位 0/1 投 AgentWins（多数方），座位 2 投 雇主胜（少数方）
      await court.connect(panel[0]).castVote(1, 0);
      await court.connect(panel[1]).castVote(1, 0);
      await court.connect(panel[2]).castVote(1, 1);

      const arb = arbFeeOf(PRICE); // 0.0005 ETH
      const w0 = await ethers.provider.getBalance(panel[0].address);
      const w1 = await ethers.provider.getBalance(panel[1].address);
      const l0 = await ethers.provider.getBalance(panel[2].address);
      const treasury0 = await ethers.provider.getBalance(platform.address);

      // 路人宣判——规则路由，谁按按钮无关紧要
      await expect(court.connect(stranger).closeCase(1))
        .to.emit(court, "CaseRuled").withArgs(1n, 0n, 2n, 1n)
        .and.to.emit(escrow, "TaskRuled").withArgs(1n, 0n, arb);

      // escrow 案件已结算（tuple 第 7 位 = state；坑：getter 摊平返回）
      const taskTuple = await escrow.tasks(1);
      expect(taskTuple[6]).to.equal(3n); // Settled

      // 多数方：各分 0.00025 ETH + 10 YD（手里 100 + 奖励 10）
      expect(await ethers.provider.getBalance(panel[0].address)).to.equal(w0 + arb / 2n);
      expect(await ethers.provider.getBalance(panel[1].address)).to.equal(w1 + arb / 2n);
      expect(await yd.balanceOf(panel[0].address)).to.equal(ethers.parseEther("110"));
      // 少数方：质押 100 → 85（slash 15 回流奖池），ETH 分文没有
      expect((await court.jurors(panel[2].address)).stake).to.equal(STAKE - SLASH);
      expect(await ethers.provider.getBalance(panel[2].address)).to.equal(l0);
      // 金库：0.1% 手续费（仲裁费 0.0005/2 两人除尽，无零头）
      expect(await ethers.provider.getBalance(platform.address)).to.equal(treasury0 + feeOf(PRICE));
      // 奖池 = 5000 - 20（奖励）+ 15（slash 回流）
      expect(await court.rewardPool()).to.equal(ethers.parseEther("4995"));
    });

    it("结算后全员解锁：少数方能退回被 slash 后的余额 85 YD", async function () {
      const { yd, court, escrow, engineer, publisher, jurors } = await deployFixture();
      await toDisputed(escrow, engineer, publisher, 1);
      const { panel } = await openAndPanel(court, jurors, 1);
      await court.connect(panel[0]).castVote(1, 0);
      await court.connect(panel[1]).castVote(1, 0);
      await court.connect(panel[2]).castVote(1, 1);
      await court.closeCase(1);
      await expect(court.connect(panel[2]).unstake(STAKE - SLASH)).to.changeTokenBalance(
        yd, panel[2], STAKE - SLASH
      );
    });

    it("1-1-1 平票 → Split 兜底，不赏不罚（真平局没人'错'）", async function () {
      const { court, escrow, engineer, publisher, jurors } = await deployFixture();
      await toDisputed(escrow, engineer, publisher, 1);
      const { panel } = await openAndPanel(court, jurors, 1);
      await court.connect(panel[0]).castVote(1, 0);
      await court.connect(panel[1]).castVote(1, 1);
      await court.connect(panel[2]).castVote(1, 2);
      await expect(court.closeCase(1))
        .to.emit(court, "CaseRuled").withArgs(1n, 2n, 0n, 0n); // 无人获奖无人被罚
      for (const j of panel) {
        expect((await court.jurors(j.address)).stake).to.equal(STAKE); // 质押原封不动
      }
    });

    it("零票到期 → Split；仲裁费全进金库，无人奖励无人罚", async function () {
      const { court, escrow, engineer, publisher, stranger, platform } = await deployFixture();
      await toDisputed(escrow, engineer, publisher, 1);
      await court.openCase(1);
      const info = await court.getCase(1);
      await time.increaseTo(info.voteEnds + 1n);
      const treasury0 = await ethers.provider.getBalance(platform.address);
      await expect(court.connect(stranger).closeCase(1))
        .to.emit(court, "CaseRuled").withArgs(1n, 2n, 0n, 0n);
      expect(await ethers.provider.getBalance(platform.address)).to.equal(
        treasury0 + feeOf(PRICE) + arbFeeOf(PRICE)
      );
    });

    it("未全票且未到期 → closeCase revert；到期后可宣判", async function () {
      const { court, escrow, engineer, publisher, stranger, jurors } = await deployFixture();
      await toDisputed(escrow, engineer, publisher, 1);
      const { panel, info } = await openAndPanel(court, jurors, 1);
      await court.connect(panel[0]).castVote(1, 0);
      await expect(court.connect(stranger).closeCase(1)).to.be.revertedWith(
        "Court: vote period ongoing"
      );
      await time.increaseTo(info.voteEnds + 1n);
      // 只有 1 票：这一票决定结果，但不足严格多数 → 不赏不罚
      await expect(court.connect(stranger).closeCase(1))
        .to.emit(court, "CaseRuled").withArgs(1n, 0n, 0n, 0n);
    });
  });

  // ═══════════════ ⑤ 管理与保险丝 ═══════════════
  describe("管理与保险丝", function () {
    it("returnEscrowOwnership：裁决权收回平台（仅法庭 owner）", async function () {
      const { court, escrow, platform, stranger } = await deployFixture();
      expect(await escrow.owner()).to.equal(await court.getAddress());
      await expect(court.connect(stranger).returnEscrowOwnership())
        .to.be.revertedWithCustomError(court, "OwnableUnauthorizedAccount");
      await court.connect(platform).returnEscrowOwnership();
      expect(await escrow.owner()).to.equal(platform.address);
    });

    it("setTreasury 仅 owner；奖池视图读数正确", async function () {
      const { court, platform, stranger } = await deployFixture();
      await expect(court.connect(stranger).setTreasury(stranger.address))
        .to.be.revertedWithCustomError(court, "OwnableUnauthorizedAccount");
      await court.connect(platform).setTreasury(stranger.address);
      expect(await court.treasury()).to.equal(stranger.address);
      expect(await court.rewardPool()).to.equal(ethers.parseEther("5000"));
    });
  });
});
