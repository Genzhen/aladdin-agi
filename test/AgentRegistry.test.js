// ═══════════════════════════════════════════════════════════════════
//  AgentRegistry 测试 · 第 3 步
//  运行：npx hardhat test test/AgentRegistry.test.js
// ═══════════════════════════════════════════════════════════════════
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("AgentRegistry（上架登记簿）", function () {
  async function deployFixture() {
    const [platform, engineer, other] = await ethers.getSigners();
    const Registry = await ethers.getContractFactory("AgentRegistry");
    const registry = await Registry.deploy();
    await registry.waitForDeployment();
    return { registry, platform, engineer, other };
  }

  const NAME = "ScriptWriter Pro";
  const CATEGORY = "Writing";
  const TAGS = "script,drama,gpt";
  const PRICE = ethers.parseEther("0.05"); // 0.05 ETH / run（设计稿 S1 同款）

  it("上架成功：返回 id=1，字段入库，发出事件", async function () {
    const { registry, engineer } = await deployFixture();

    await expect(registry.connect(engineer).register(NAME, CATEGORY, TAGS, PRICE))
      .to.emit(registry, "AgentRegistered")
      .withArgs(1n, engineer.address, NAME, CATEGORY, PRICE);

    // public mapping 的 getter 返回 struct 字段元组（按声明顺序）
    const agent = await registry.agents(1);
    expect(agent.owner).to.equal(engineer.address);
    expect(agent.name).to.equal(NAME);
    expect(agent.category).to.equal(CATEGORY);
    expect(agent.tags).to.equal(TAGS);
    expect(agent.pricePerRun).to.equal(PRICE);
    expect(agent.score).to.equal(0n); // 新上架 0 分 = 冷启动 Agent
    expect(agent.exists).to.equal(true);
  });

  it("连续上架 id 自增，totalAgents 正确", async function () {
    const { registry, engineer } = await deployFixture();
    await registry.connect(engineer).register(NAME, CATEGORY, TAGS, PRICE);
    await registry.connect(engineer).register("CodeWeaver", "Coding", "solidity", PRICE);

    expect(await registry.nextId()).to.equal(3n);
    expect(await registry.totalAgents()).to.equal(2n);
  });

  it("定价为 0 → revert", async function () {
    const { registry, engineer } = await deployFixture();
    await expect(
      registry.connect(engineer).register(NAME, CATEGORY, TAGS, 0)
    ).to.be.revertedWith("Registry: price must be > 0");
  });

  it("ownerOf 供其它合约做身份校验", async function () {
    const { registry, engineer } = await deployFixture();
    await registry.connect(engineer).register(NAME, CATEGORY, TAGS, PRICE);
    expect(await registry.ownerOf(1)).to.equal(engineer.address);
  });

  it("平台可回写评分 87（= 0.87×100，链上无浮点）", async function () {
    const { registry, platform, engineer } = await deployFixture();
    await registry.connect(engineer).register(NAME, CATEGORY, TAGS, PRICE);

    await expect(registry.connect(platform).updateScore(1, 87))
      .to.emit(registry, "AgentScoreUpdated")
      .withArgs(1n, 0n, 87n);
    expect((await registry.agents(1)).score).to.equal(87n);
  });

  it("非平台回写评分 → custom error；查不存在的 Agent → revert", async function () {
    const { registry, engineer } = await deployFixture();
    await registry.connect(engineer).register(NAME, CATEGORY, TAGS, PRICE);

    await expect(
      registry.connect(engineer).updateScore(1, 99) // 工程师不能给自己刷分
    ).to.be.revertedWithCustomError(registry, "OwnableUnauthorizedAccount");

    await expect(registry.ownerOf(999)).to.be.revertedWith(
      "Registry: agent not found"
    );
  });
});
