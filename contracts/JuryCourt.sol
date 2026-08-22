// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

/*
 *  ═══════════════════════════════════════════════════════════════════
 *  JuryCourt —— 陪审团法庭 · 第 11 步 ★裁决权去中心化
 *  escrow 第 183 行的伏笔在此兑现："接口不变，换触发方"——executeRuling
 *  的 onlyOwner 从平台换成本合约：谁说了算，从"一个 owner"变成
 *  "三个质押 YD 的陪审员多数决"。
 *  【流程】stake 100 YD 入池 → openCase（任何人可开：随机抽 3 人，排除
 *  当事双方/在案者）→ castVote 明票三选一（同 escrow.Ruling：0 Agent胜/
 *  1 雇主胜/2 对半）→ closeCase（全票或到期任何人可调）：多数决 →
 *  escrow.executeRuling → TaskRuled → Relayer 照常结算（零改动）
 *
 *  【博弈】多数方 0.5% 仲裁费均分 + 10 YD/人；少数方罚 15% 质押回流奖池；
 *  平台 0.1% 手续费进金库；平票/零票 → Split 不赏不罚（真平局没人"错"）。
 *  明票（生产换 commit-reveal）；随机源可操纵（生产换 VRF）；保险丝=演示兜底。
 */

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {TaskEscrow} from "./TaskEscrow.sol";

contract JuryCourt is Ownable, ReentrancyGuard {
    // ─────────────── 接线（部署时定死） ───────────────
    TaskEscrow public immutable escrow;   // 被仲裁对象（本合约是它的 owner）
    IERC20 public immutable yd;           // 陪审资格代币（YidengToken）
    address public treasury;              // 0.1% 手续费去处（平台金库）
    uint256 public immutable VOTE_PERIOD; // 投票窗口秒数（部署时定，演示可短）

    // ─────────────── 陪审员池 ───────────────
    uint256 public constant MIN_STAKE = 100 ether; // 一张陪审门票
    uint256 public constant SLASH_BPS = 1500;      // 乱裁决罚没 15%
    uint256 public constant JURY_SIZE = 3;         // 合议庭规模
    uint256 public constant YD_REWARD = 10 ether;  // 多数方每人 YD 奖励

    struct Juror {
        uint256 stake;        // 质押中的 YD（slash 从这里扣）
        uint256 activeCaseId; // 正在审的案件（0=空闲）；非 0 不许 unstake
    }
    mapping(address => Juror) public jurors;
    address[] public jurorList;          // 抽签要枚举池子——mapping 没法遍历
    mapping(address => bool) public inPool; // 防重复 push（清零后再质押）
    uint256 public totalStaked;          // 奖池 = yd 余额 - 它（多出来的即奖池）

    // ─────────────── 案件 ───────────────
    enum Phase { None, Voting, Ruled }

    struct CaseInfo {
        Phase phase;
        address publisher; // 当事双方（抽签排除——利益相关者不当法官）
        address agent;
        address[JURY_SIZE] panel;   // 被抽中的 3 名陪审员
        uint8[JURY_SIZE] votes;     // 各自的票
        bool[JURY_SIZE] voted;      // 是否已投（未投=弃权：不奖不罚）
        uint256 voteEnds;           // 投票截止（unix 秒）
        uint8 finalRuling;          // 宣判结果（Ruled 后有效）
    }
    // ⚠️ 坑：public mapping 的自动 getter 会静默丢掉 struct 里的数组成员（panel/votes/voted）——读案件走 getCase()
    mapping(uint256 => CaseInfo) private cases; // key = escrow 的 taskId

    // ─────────────── 事件（Relayer 监听进证据链） ───────────────
    event Staked(address indexed juror, uint256 amount);
    event Unstaked(address indexed juror, uint256 amount);
    event CaseOpened(uint256 indexed taskId, address[JURY_SIZE] panel, uint256 voteEnds);
    event VoteCast(uint256 indexed taskId, address indexed juror, uint8 vote);
    event CaseRuled(uint256 indexed taskId, uint8 ruling, uint256 winnerCount, uint256 slashedCount);

    constructor(address ydAddr, address escrowAddr, address treasuryAddr, uint256 votePeriodSec)
        Ownable(msg.sender)
        ReentrancyGuard()
    {
        yd = IERC20(ydAddr);
        escrow = TaskEscrow(escrowAddr);
        treasury = treasuryAddr;
        VOTE_PERIOD = votePeriodSec;
    }

    // ═══════════════ ① 质押入池 / 退出 ═══════════════

    /// @notice 质押 YD 成为陪审员（先 approve 本合约；≥100 YD 才会被抽中）
    function stake(uint256 amount) external {
        require(amount > 0, "Court: zero amount");
        require(yd.transferFrom(msg.sender, address(this), amount), "Court: transferFrom failed");
        if (!inPool[msg.sender]) {
            inPool[msg.sender] = true;
            jurorList.push(msg.sender);
        }
        jurors[msg.sender].stake += amount;
        totalStaked += amount;
        emit Staked(msg.sender, amount);
    }

    /// @notice 退质押（在审案件的陪审员不许跑——先结案）
    function unstake(uint256 amount) external {
        Juror storage j = jurors[msg.sender];
        require(j.activeCaseId == 0, "Court: juror in active case");
        require(amount > 0 && j.stake >= amount, "Court: insufficient stake");
        j.stake -= amount;
        totalStaked -= amount;
        require(yd.transfer(msg.sender, amount), "Court: YD transfer failed");
        emit Unstaked(msg.sender, amount);
    }

    // ═══════════════ ② 开庭：抽签组庭 ═══════════════

    /// @notice 为一起 Disputed 任务开庭，随机抽 3 名陪审员。任何人可调——
    ///         原告被告都不用等平台点头（去中心化的意义）
    function openCase(uint256 taskId) external {
        CaseInfo storage c = cases[taskId];
        require(c.phase == Phase.None, "Court: case already opened");
        (TaskEscrow.State st, address tPublisher, address tAgent,) = _task(taskId);
        require(st == TaskEscrow.State.Disputed, "Court: task not disputed");

        address[] memory pool = _eligiblePool(tPublisher, tAgent);
        require(pool.length >= JURY_SIZE, "Court: not enough jurors");

        c.publisher = tPublisher;
        c.agent = tAgent;
        c.voteEnds = block.timestamp + VOTE_PERIOD;

        // 伪随机抽 3 人：seed 掺 prevrandao/时间/块高/案件号（生产换 VRF）
        uint256 seed = uint256(keccak256(abi.encode(block.prevrandao, block.timestamp, block.number, taskId)));
        bool[] memory picked = new bool[](pool.length);
        for (uint256 k = 0; k < JURY_SIZE; k++) {
            uint256 idx = uint256(keccak256(abi.encode(seed, k))) % pool.length;
            while (picked[idx]) idx = (idx + 1) % pool.length; // 撞了顺位下移
            picked[idx] = true;
            c.panel[k] = pool[idx];
            jurors[pool[idx]].activeCaseId = taskId; // 审案期间锁人
        }
        c.phase = Phase.Voting;
        emit CaseOpened(taskId, c.panel, c.voteEnds);
    }

    // ═══════════════ ③ 投票（明票） ═══════════════

    /// @notice 被抽中的陪审员投票。0=Agent胜 1=雇主胜 2=对半（同 escrow.Ruling）
    function castVote(uint256 taskId, uint8 vote) external {
        CaseInfo storage c = cases[taskId];
        require(c.phase == Phase.Voting, "Court: case not voting");
        require(block.timestamp < c.voteEnds, "Court: vote period over");
        require(vote <= 2, "Court: bad vote");

        uint256 slot = JURY_SIZE; // 找本人的座位（抽签时已排除利益相关方）
        for (uint256 i = 0; i < JURY_SIZE; i++) {
            if (c.panel[i] == msg.sender) slot = i;
        }
        require(slot < JURY_SIZE, "Court: not on this panel");
        require(!c.voted[slot], "Court: already voted");

        c.votes[slot] = vote;
        c.voted[slot] = true;
        emit VoteCast(taskId, msg.sender, vote); // 明票：票值直接上链可见
    }

    // ═══════════════ ④ 宣判：多数决 + 分钱 ═══════════════

    /// @notice 3 票齐或投票期过，任何人可调（同 claimTimeout 的道理：规则
    ///         路由，谁按按钮无关紧要）。多数决 → escrow 结算 → 分赏罚。
    function closeCase(uint256 taskId) external nonReentrant {
        CaseInfo storage c = cases[taskId];
        require(c.phase == Phase.Voting, "Court: case not voting");
        require(c.voted[0] && c.voted[1] && c.voted[2] || block.timestamp >= c.voteEnds, "Court: vote period ongoing");

        // ① 计票：得票最多的选项当选（并列 → Split 兜底）；但只有
        //    "严格多数"（>半数票）才启动赏罚——真平局没人错，不罚
        uint256[3] memory counts;
        for (uint256 i = 0; i < JURY_SIZE; i++) {
            if (c.voted[i]) counts[c.votes[i]] += 1;
        }
        uint8 ruling = 2;
        bool strict;
        if (counts[0] > counts[1] && counts[0] > counts[2]) {
            ruling = 0;
            strict = counts[0] > JURY_SIZE / 2;
        } else if (counts[1] > counts[0] && counts[1] > counts[2]) {
            ruling = 1;
            strict = counts[1] > JURY_SIZE / 2;
        } else {
            strict = counts[2] > JURY_SIZE / 2;
        }
        c.finalRuling = ruling;
        c.phase = Phase.Ruled;

        // ② 先放人 + 罚少数方（纯状态修改——Effects 在 Interactions 前）
        address[JURY_SIZE] memory winners;
        uint256 winnerCount;
        uint256 slashedCount;
        for (uint256 i = 0; i < JURY_SIZE; i++) {
            address j = c.panel[i];
            jurors[j].activeCaseId = 0;
            if (!strict || !c.voted[i]) continue; // 平票不赏罚；弃权不赏罚
            if (c.votes[i] == ruling) {
                winners[winnerCount] = j;
                winnerCount += 1;
            } else {
                uint256 slash = (jurors[j].stake * SLASH_BPS) / 10_000;
                jurors[j].stake -= slash;
                totalStaked -= slash; // 这笔 YD 留在合约 → 奖池变大
                slashedCount += 1;
            }
        }

        // ③ 触发 escrow 结算。ETH 到账 = 0.5% 仲裁费 + 0.1% 手续费
        //    （价格从 escrow 任务读、费率常量也从那边读——单一事实源）
        (,,, uint256 price) = _task(taskId);
        escrow.executeRuling(taskId, TaskEscrow.Ruling(ruling));
        uint256 arbPart = (price * escrow.ARBITRATION_BPS()) / 10_000;
        uint256 feePart = (price * escrow.FEE_BPS()) / 10_000;

        // ④ 分钱：手续费给金库；仲裁费多数方均分（零头给金库）
        uint256 toTreasury = feePart;
        if (winnerCount > 0) {
            toTreasury += arbPart % winnerCount;
            uint256 share = arbPart / winnerCount;
            for (uint256 i = 0; i < winnerCount; i++) _pay(winners[i], share);
        } else {
            toTreasury += arbPart; // 平票/零票：仲裁费全进金库（奖池不白养）
        }
        _pay(treasury, toTreasury);

        // ⑤ YD 奖励：多数方每人 10 YD，从奖池出（slash 罚金就落在这里）
        uint256 pool = yd.balanceOf(address(this)) - totalStaked;
        if (winnerCount > 0 && pool >= winnerCount * YD_REWARD) {
            for (uint256 i = 0; i < winnerCount; i++) {
                require(yd.transfer(winners[i], YD_REWARD), "Court: YD reward failed");
            }
        }

        emit CaseRuled(taskId, ruling, winnerCount, slashedCount);
    }

    // ═══════════════ 管理与保险丝 ═══════════════

    function setTreasury(address t) external onlyOwner {
        require(t != address(0), "Court: zero treasury");
        treasury = t;
    }

    /// @notice 演示保险丝：把 escrow 所有权收回平台（生产环境慎用/去掉）
    function returnEscrowOwnership() external onlyOwner {
        escrow.transferOwnership(owner());
    }

    // ─────────────── 视图（前端直接读） ───────────────
    function jurorCount() external view returns (uint256) {
        return jurorList.length;
    }

    /// @notice YD 奖池余额（= 合约持有的 YD - 陪审员总质押）
    function rewardPool() external view returns (uint256) {
        return yd.balanceOf(address(this)) - totalStaked;
    }

    /// @notice 案件全景（自动 getter 丢数组成员，所以手写——见 cases 声明处注释）
    function getCase(uint256 taskId) external view returns (
        Phase phase, address publisher, address agent, address[JURY_SIZE] memory panel,
        uint8[JURY_SIZE] memory votes, bool[JURY_SIZE] memory voted,
        uint256 voteEnds, uint8 finalRuling
    ) {
        CaseInfo storage c = cases[taskId];
        return (c.phase, c.publisher, c.agent, c.panel, c.votes, c.voted, c.voteEnds, c.finalRuling);
    }

    // ─────────────── 内部工具 ───────────────

    /// @dev 跨合约读 struct 的坑：public mapping 的自动 getter 返回按声明
    ///      顺序摊平的**匿名 tuple**（publisher,agent,agentId,price,deposit,
    ///      deadline,state），不能直接赋给 Task 变量——只能按位解构取值
    function _task(uint256 id) private view returns (TaskEscrow.State s, address publisher, address agent, uint256 price) {
        (publisher, agent,, price,,, s) = escrow.tasks(id);
    }

    /// @dev 合格陪审员 = 质押达标 + 不在案 + 不是本案当事双方
    function _eligiblePool(address partyA, address partyB) private view returns (address[] memory out) {
        out = new address[](jurorList.length);
        uint256 n;
        for (uint256 i = 0; i < jurorList.length; i++) {
            address j = jurorList[i];
            if (jurors[j].stake >= MIN_STAKE && jurors[j].activeCaseId == 0 && j != partyA && j != partyB) {
                out[n] = j;
                n += 1;
            }
        }
        assembly {
            mstore(out, n) // 数组长度改写成实际数量（截断尾部空位）
        }
    }

    /// @dev ETH 出账统一 call（同 escrow._pay 的写法）
    function _pay(address to, uint256 amount) private {
        (bool ok, ) = payable(to).call{value: amount}("");
        require(ok, "Court: transfer failed");
    }

    /// @dev escrow.executeRuling 会把 0.6% ETH 打进来——没有这个 receive() 那次 call 会 revert，案件永久卡死
    receive() external payable {}
}
