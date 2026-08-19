// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

/*
 * ═══════════════════════════════════════════════════════════════════
 *  TaskEscrow —— 任务状态机 + 资金托管 · 第 3 步（之二）★全项目核心
 * ═══════════════════════════════════════════════════════════════════
 *  【一句话】雇主的钱先进合约趴着，Agent 交 6% 保证金才能干活，
 *            状态机每走一步校验"谁在什么阶段能干什么"，验收才放款。
 *
 *  【状态机】（PRD §4，S4 stepper 的链上真相源）
 *    Matching ──accept──▶ Running ──submit──▶ Review ──approve──▶ Settled
 *        │                    │                   │
 *        │超时无人接           │超时未交付          │openDispute
 *        ▼                    ▼                   ▼
 *    Cancelled(全额退)   Cancelled(罚没保证金)   Disputed ──裁决──▶ Settled
 *
 *  【费率】Solidity 没有浮点，全部用"基点 bps"整数运算：1% = 100 bps
 *    手续费 FEE_BPS=10 (0.1%)；保证金 DEPOSIT_BPS=600 (6%)；
 *    仲裁费 ARBITATION_BPS=50 (0.5%)。
 *    设计稿上 "0.1 ETH 出价 / 0.0001 手续费 / 0.006 保证金" 就是
 *    0.1e18 × bps / 10000 算出来的。
 *
 *  【安全】转账用 call 并遵循"检查→改状态→转账"(Checks-Effects-Interactions)；
 *          涉及转账的函数加 nonReentrant 防重入。
 */

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {AgentRegistry} from "./AgentRegistry.sol";

contract TaskEscrow is Ownable, ReentrancyGuard {
    // ───────────────────── 状态与数据 ─────────────────────

    /// @dev 任务阶段。没有 Posted：发布交易上链那一瞬就是 Posted，
    ///      链下监听到 TaskPosted 事件后匹配引擎立即开工，所以直接进 Matching
    enum State { Matching, Running, Review, Settled, Disputed, Cancelled }

    /// @dev 仲裁结果三选项（同 S7 仲裁页的三个按钮）
    enum Ruling { AgentWins, PublisherWins, Split }

    struct Task {
        address publisher; // 雇主（出资人）
        address agent;     // 工程师（accept 后填入，之前为 address(0)）
        uint256 agentId;   // AgentRegistry 里的 id（匹配/统计用）
        uint256 price;     // 出价（不含手续费）
        uint256 deposit;   // Agent 的 6% 保证金（accept 时锁入）
        uint256 deadline;  // 完成期限（unix 秒）
        State   state;     // 当前阶段（唯一真相源，前端 stepper 只是它的镜像）
    }

    uint256 public nextTaskId = 1;
    mapping(uint256 => Task) public tasks;

    /// @dev 上架登记簿的地址。immutable=部署时定死不可改，省 gas
    ///      （接单要跨合约查"你是不是这个 Agent 的主人"）
    AgentRegistry public immutable registry;

    // ───────────────────── 费率常量（bps 基点） ─────────────────────

    uint256 public constant FEE_BPS = 10;         // 平台手续费 0.1%
    uint256 public constant DEPOSIT_BPS = 600;    // Agent 保证金 6%
    uint256 public constant ARBITRATION_BPS = 50; // 仲裁费 0.5%（争议时扣）

    // ───────────────────── 事件（后端监听同步 SQLite） ─────────────────────

    event TaskPosted(uint256 indexed id, address indexed publisher, uint256 price, uint256 totalStaked, uint256 deadline);
    event AgentAccepted(uint256 indexed id, uint256 indexed agentId, address agent, uint256 deposit);
    event TaskSubmitted(uint256 indexed id);
    event TaskApproved(uint256 indexed id, address agent, uint256 payout);
    event DisputeOpened(uint256 indexed id, address indexed by);
    event TaskRuled(uint256 indexed id, Ruling ruling, uint256 arbitrationFee);
    event TaskCancelled(uint256 indexed id, address refundedTo, bool depositSlashed);

    constructor(address registryAddr) Ownable(msg.sender) ReentrancyGuard() {
        registry = AgentRegistry(registryAddr); // 合约间调用的"接线"
    }

    // ═══════════════════ ① 发布：雇主质押 ═══════════════════

    /**
     * @notice 发布任务并质押 price + 0.1% 手续费
     * @param price    出价（wei）
     * @param deadline 完成期限（unix 秒）
     */
    function postTask(uint256 price, uint256 deadline) external payable {
        require(deadline > block.timestamp, "Escrow: deadline in past");

        uint256 fee = _feeOf(price);
        // 精确相等而不是 >=：多付的钱会永远卡在合约里没法取出（理解题 Q2）
        require(msg.value == price + fee, "Escrow: stake must equal price + 0.1% fee");

        uint256 id = nextTaskId++;
        tasks[id] = Task({
            publisher: msg.sender,
            agent: address(0),
            agentId: 0,
            price: price,
            deposit: 0,
            deadline: deadline,
            state: State.Matching
        });

        emit TaskPosted(id, msg.sender, price, msg.value, deadline);
    }

    // ═══════════════════ ② 接单：Agent 质押 6% ═══════════════════

    /**
     * @notice 被选中的工程师接单（跨合约校验身份）并锁入 6% 保证金
     */
    function accept(uint256 taskId, uint256 agentId) external payable {
        Task storage t = _mustExist(taskId);
        require(t.state == State.Matching, "Escrow: task not in matching");
        require(
            msg.sender == registry.ownerOf(agentId),
            "Escrow: caller is not this agent's owner"
        );

        uint256 deposit = _depositOf(t.price);
        require(msg.value == deposit, "Escrow: deposit must equal 6% of price");

        t.agent = msg.sender;
        t.agentId = agentId;
        t.deposit = deposit;
        t.state = State.Running; // Matching → Running

        emit AgentAccepted(taskId, agentId, msg.sender, deposit);
    }

    // ═══════════════════ ③ 交付：进入待验收 ═══════════════════

    /// @notice Agent 声明交付（成果本体在链下，这里只推动状态机）
    function submit(uint256 taskId) external {
        Task storage t = _mustExist(taskId);
        require(t.state == State.Running, "Escrow: task not running");
        require(msg.sender == t.agent, "Escrow: only the agent can submit");

        t.state = State.Review; // Running → Review
        emit TaskSubmitted(taskId);
    }

    // ═══════════════════ ④ 验收：放款结算 ═══════════════════

    /**
     * @notice 雇主验收通过：Agent 领出价款+退保证金，平台收手续费。
     *         遵循 Checks→Effects→Interactions：先把状态改成 Settled
     *         再转账（转账失败整体回滚，但顺序对了重入也无机可乘）
     */
    function approve(uint256 taskId) external nonReentrant {
        Task storage t = _mustExist(taskId);
        require(t.state == State.Review, "Escrow: task not in review");
        require(msg.sender == t.publisher, "Escrow: only publisher can approve");

        t.state = State.Settled; // Review → Settled（先改状态！）

        uint256 payout = t.price + t.deposit; // 价款 + 退保证金
        _pay(t.agent, payout);
        _pay(owner(), _feeOf(t.price)); // 手续费当时质押时就含在合约里

        emit TaskApproved(taskId, t.agent, payout);
    }

    // ═══════════════════ ⑤ 争议 → 冻结 ═══════════════════

    /// @notice 雇主或 Agent 在待验收阶段发起争议，全部资金冻结
    function openDispute(uint256 taskId) external {
        Task storage t = _mustExist(taskId);
        require(t.state == State.Review, "Escrow: only in review stage");
        require(
            msg.sender == t.publisher || msg.sender == t.agent,
            "Escrow: only task parties can dispute"
        );

        t.state = State.Disputed; // Review → Disputed
        emit DisputeOpened(taskId, msg.sender);
    }

    // ═══════════════════ ⑥ 裁决：按结果分钱 ═══════════════════

    /**
     * @notice 平台执行裁决（第 3 步=owner 直裁跑通闭环；
     *         第 11 步升级为陪审投票结果触发——接口不变，换触发方）
     *  裁决三选项的资金分配（仲裁费 0.5% 从 escrow 扣）：
     *    AgentWins     ：Agent 拿价款+退保证金（等同验收）
     *    PublisherWins ：价款退雇主，保证金罚没赔雇主（Agent 作恶的代价）
     *    Split         ：价款对半，保证金退还 Agent（各打五十大板）
     */
    function executeRuling(uint256 taskId, Ruling ruling) external onlyOwner nonReentrant {
        Task storage t = _mustExist(taskId);
        require(t.state == State.Disputed, "Escrow: task not disputed");

        t.state = State.Settled; // Disputed → Settled（先改状态再动钱）

        uint256 arbFee = (t.price * ARBITRATION_BPS) / 10_000;
        uint256 pot = t.price - arbFee; // 可分配部分

        if (ruling == Ruling.AgentWins) {
            _pay(t.agent, pot + t.deposit);
        } else if (ruling == Ruling.PublisherWins) {
            _pay(t.publisher, pot + t.deposit); // 保证金赔给雇主
        } else {
            _pay(t.agent, pot / 2 + t.deposit);
            _pay(t.publisher, pot / 2);
        }
        // 仲裁费 + 原手续费归平台（仲裁费未来划给陪审奖池）
        _pay(owner(), arbFee + _feeOf(t.price));

        emit TaskRuled(taskId, ruling, arbFee);
    }

    // ═══════════════════ ⑦ 超时兜底 ═══════════════════

    /**
     * @notice 期限已过：Matching 无人接=全额退款；Running 没交付=
     *         退款+罚没保证金。⚠️ 任何人可调（链下 keeper 定时器也行）：
     *         钱只会按规则流进该进的人口袋，谁触发无关紧要——
     *         这就是"规则路由"和"权限门禁"的区别（理解题 Q3）
     */
    function claimTimeout(uint256 taskId) external nonReentrant {
        Task storage t = _mustExist(taskId);
        require(block.timestamp > t.deadline, "Escrow: deadline not passed yet");

        State before = t.state; // 先存下来：下面马上要覆盖它
        require(
            before == State.Matching || before == State.Running,
            "Escrow: task already past timeout window"
        );

        t.state = State.Cancelled;
        bool slash = (before == State.Running); // 接了单没交付才罚没

        // Matching：合约里有 price+fee，全退雇主
        // Running  ：合约里有 price+fee+deposit，全给雇主（保证金=违约金）
        uint256 refund = t.price + _feeOf(t.price) + (slash ? t.deposit : 0);
        _pay(t.publisher, refund);

        emit TaskCancelled(taskId, t.publisher, slash);
    }

    // ───────────────────── 内部工具 ─────────────────────

    function _feeOf(uint256 price) private pure returns (uint256) {
        return (price * FEE_BPS) / 10_000;
    }

    function _depositOf(uint256 price) private pure returns (uint256) {
        return (price * DEPOSIT_BPS) / 10_000;
    }

    /// @dev 转账统一走 call（比 transfer 更通用，能触达合约钱包），
    ///      失败就整体回滚——钱发不出去宁可不结算
    function _pay(address to, uint256 amount) private {
        (bool ok, ) = payable(to).call{value: amount}("");
        require(ok, "Escrow: transfer failed");
    }

    function _mustExist(uint256 id) private view returns (Task storage t) {
        require(id > 0 && id < nextTaskId, "Escrow: task not found");
        t = tasks[id];
    }
}
