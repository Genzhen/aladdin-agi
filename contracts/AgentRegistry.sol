// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

/*
 * ═══════════════════════════════════════════════════════════════════
 *  AgentRegistry —— Agent 上架登记簿 · 第 3 步（之一）
 * ═══════════════════════════════════════════════════════════════════
 *  【职责】链上只存"关键事实"（谁上架的、叫什么、什么分类、定价多少、
 *          综合评分多少）；长文本（介绍、样例输出）在后端 SQLite——
 *          链上存证防篡改，链下存储省 gas（PRD §3 的分工原则）。
 *
 *  【Web2 类比】这是一张"商户入驻登记表"，只登记执照上的关键字段，
 *              商店的装修介绍放在自己的官网上。
 */

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract AgentRegistry is Ownable {
    // ───────────────────── 数据结构 ─────────────────────

    /// @dev 一个 Agent 的链上档案。solidity 的 struct ≈ 一行数据库记录
    struct Agent {
        address owner;       // 工程师地址（收款人 = 接单权的持有者）
        string  name;        // Agent 名称
        string  category;    // 一级分类：Writing / Coding / Video ...
        string  tags;        // 逗号分隔标签摘要，如 "script,drama,gpt"
                             // （完整 tags 数组和长介绍在链下库，V0/V1 匹配用）
        uint256 pricePerRun; // 单次调用定价（wei）
        uint256 score;       // 五维综合分 0~100（0.87 存 87）
                             // ⚠️ Solidity 没有浮点：小数乘 100 存整数，
                             //    展示时前端再 /100 —— 链上通用套路
        bool    exists;      // mapping 无法表达"不存在"，用标志位区分
    }

    /// @dev 下一个要分配的 id。从 1 开始（0 留作"空"默认值）
    uint256 public nextId = 1;

    /// @dev id => Agent。public 的 mapping 会自动生成 getter，
    ///      返回 struct 的字段元组（测试里会用到）
    mapping(uint256 => Agent) public agents;

    // ───────────────────── 事件 ─────────────────────

    /// @notice 新 Agent 上架（后端监听它落库 + 触发空投 +10 MYT）
    event AgentRegistered(
        uint256 indexed id,
        address indexed owner,
        string name,
        string category,
        uint256 pricePerRun
    );

    /// @notice 平台回写综合评分（第 5~8 步评分聚合后的锚点）
    event AgentScoreUpdated(uint256 indexed id, uint256 oldScore, uint256 newScore);

    constructor() Ownable(msg.sender) {}

    // ───────────────────── 上架 ─────────────────────

    /**
     * @notice 工程师上架 Agent（任何人可调——你上架你就是 owner）
     * @return id 系统分配的自增 id
     */
    function register(
        string calldata name,
        string calldata category,
        string calldata tags,
        uint256 pricePerRun
    ) external returns (uint256 id) {
        require(pricePerRun > 0, "Registry: price must be > 0");

        id = nextId++; // 先取后加：第一个 id=1
        agents[id] = Agent({
            owner: msg.sender,
            name: name,
            category: category,
            tags: tags,
            pricePerRun: pricePerRun,
            score: 0, // 新上架无评分（= 冷启动 Agent，V2 匹配页显示 Cold Start）
            exists: true
        });

        emit AgentRegistered(id, msg.sender, name, category, pricePerRun);
    }

    // ───────────────────── 评分回写（仅平台） ─────────────────────

    /**
     * @notice 五维评分在后端定时算好（PRD §6），平台把结果锚到链上。
     *         为什么不放链上算？评分要扫全部历史任务，链上循环=烧钱
     */
    function updateScore(uint256 id, uint256 newScore) external onlyOwner {
        Agent storage a = _mustExist(id);
        require(newScore <= 100, "Registry: score 0~100");

        uint256 old = a.score;
        a.score = newScore;
        emit AgentScoreUpdated(id, old, newScore);
    }

    // ───────────────────── 给其它合约用的查询 ─────────────────────

    /// @notice TaskEscrow 接单时用：验证"你是不是这个 Agent 的主人"
    ///         这就是合约间调用——escrow 不重复存 owner，单一事实来源
    function ownerOf(uint256 id) external view returns (address) {
        return _mustExist(id).owner;
    }

    /// @notice 市场列表分页用：一共有多少个 Agent
    function totalAgents() external view returns (uint256) {
        return nextId - 1;
    }

    // ───────────────────── 内部工具 ─────────────────────

    function _mustExist(uint256 id) internal view returns (Agent storage a) {
        require(id > 0 && id < nextId, "Registry: agent not found");
        a = agents[id];
    }
}
