// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

/*
 * ═══════════════════════════════════════════════════════════════════
 *  MyToken (MYT) —— 阿拉丁AGI 平台激励代币 · 第 2 步
 * ═══════════════════════════════════════════════════════════════════
 *  【角色】MYT 是全平台的"激励血液"（PRD §9）：
 *    - 陪审资格：质押 100 MYT 才能参与仲裁（第 11 步）
 *    - 仲裁 slash：乱裁决罚没 15% 质押，罚的就是 MYT
 *    - 空投冷启动：上架 Agent / 完成任务发 MYT 补贴双边（Web3 版拉新红包）
 *
 *  【继承】复用 OpenZeppelin 两个经过审计的实现（不重复造轮子）：
 *    - ERC20  ：代币标准——余额、转账、授权（balanceOf/transfer/approve）
 *    - Ownable：权限控制——只有 owner（部署者=平台）能调敏感函数
 *
 *  【Web2 类比】ERC20 ≈ "支付宝余额+转账"接口规范，
 *              Ownable ≈ 后台管理接口只允许管理员调用
 */

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract MyToken is ERC20, Ownable {
    // ─────────────── 常量（constant：编译期定死，永不可改，全大写命名） ───────────────

    /// @notice 水龙头每次发 20 MYT。
    ///         「20 ether」里的 ether 不是 ETH！它只是 10^18 的字面量后缀
    ///         （类比 JS 写 1e18）。我们 decimals=18，所以 20 ether = 20 个 MYT
    uint256 public constant FAUCET_AMOUNT = 20 ether;

    /// @notice 水龙头冷却 24 小时。「hours」同理是时间单位字面量：1 hours = 3600 秒
    uint256 public constant FAUCET_COOLDOWN = 24 hours;

    /// @notice 初始供应 100 万 MYT，全部铸造给部署者（owner = 平台金库）
    uint256 public constant INITIAL_SUPPLY = 1_000_000 ether;

    // ─────────── 空投常量（PRD §9 定死的口径，后端发奖励按这里对齐） ───────────

    /// @notice Agent 上架成功：作者 +10 MYT
    uint256 public constant REWARD_LIST_AGENT = 10 ether;

    /// @notice 任务完成：雇主 +5 MYT
    uint256 public constant REWARD_TASK_EMPLOYER = 5 ether;

    /// @notice 任务完成：工程师 +20 MYT（干活方拿得多——补贴供给端）
    uint256 public constant REWARD_TASK_AGENT = 20 ether;

    // ───────────────────────── 状态变量 ─────────────────────────

    /// @dev 每个地址上次领水的时间戳（秒）。
    ///      限频的经典写法：mapping 当"键值数据库"，key=地址 value=uint256 时间戳
    mapping(address => uint256) private _lastFaucetAt;

    // ─────────────── 事件（合约对外的"广播电台"，后端监听它同步数据库） ───────────────
    //  indexed 参数可被链下按值过滤，像 SQL 的 WHERE user = 0x...

    /// @notice 有人领了水龙头
    event FaucetUsed(address indexed user, uint256 amount, uint256 nextAvailableAt);

    /// @notice 平台完成一次批量空投
    event Airdropped(address indexed operator, uint256 recipientCount);

    // ───────────────────── 构造函数（部署交易里执行一次） ─────────────────────

    /**
     * 父合约构造函数要显式传参：
     *   ERC20("MyToken", "MYT") → 全名 + 符号（decimals 默认 18）
     *   Ownable(msg.sender)     → OZ 5.x 起必须显式传初始 owner（防"忘了设置"）
     */
    constructor() ERC20("MyToken", "MYT") Ownable(msg.sender) {
        // 初始供应铸造给部署者。平台后续所有支出（空投/奖励）都从这里出
        _mint(msg.sender, INITIAL_SUPPLY);
    }

    // ───────────────────── 水龙头（测试网领币入口） ─────────────────────

    /**
     * @notice 每地址每 24h 领 20 MYT（直接增发，不扣任何人的钱）
     * @dev    任何人可调——区块链里"账号体系"就是私钥，无需注册登录
     */
    function faucet() external {
        // require = 门卫：不满足就整体回滚（本次所有状态修改作废，gas 不退）
        // 报错字符串按惯例带合约名前缀，方便从海量报错里定位
        uint256 last = _lastFaucetAt[msg.sender];
        require(
            block.timestamp >= last + FAUCET_COOLDOWN,
            "MyToken: faucet cooldown, try later"
        );

        // 通过检查才改状态（"检查→生效→交互"顺序，防重入等经典坑）
        _lastFaucetAt[msg.sender] = block.timestamp;

        // 直接增发。对比另一种实现「从 owner 余额 transfer 出去」：
        //   增发：totalSupply 变大（通胀），金库永不会被领空
        //   转账：总量不变，但水龙头一热门金库就枯竭
        // 测试网选增发；生产网要正经设计代币经济（理解题 Q1）
        _mint(msg.sender, FAUCET_AMOUNT);

        // 广播事件：amount 重复写进事件，链下不用再回链查（省一次 RPC 调用）
        emit FaucetUsed(msg.sender, FAUCET_AMOUNT, block.timestamp + FAUCET_COOLDOWN);
    }

    // ───────────────────── 批量空投（仅平台） ─────────────────────

    /**
     * @notice 平台批量空投（冷启动激励）。只有 owner 能调
     * @param  recipients 收款地址数组
     * @param  amounts    金额数组（与 recipients 一一对应）
     *
     * calldata vs memory：external 函数的引用类型参数优先用 calldata——
     *   calldata 是交易的只读原始区，零拷贝；memory 要花 gas 复制一份
     */
    function airdrop(
        address[] calldata recipients,
        uint256[] calldata amounts
    ) external onlyOwner {
        // 数组等长校验：不校验的话，循环会越界 revert 或错位转账
        require(
            recipients.length == amounts.length,
            "MyToken: recipients/amounts length mismatch"
        );

        // 循环铸造。注意 gas：数组越长 gas 越多，生产上会限制单次批量上限
        for (uint256 i = 0; i < recipients.length; i++) {
            _mint(recipients[i], amounts[i]);
        }

        // 循环外发一条汇总事件（比循环内每人一条省 gas）
        emit Airdropped(msg.sender, recipients.length);
    }
}
