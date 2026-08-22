// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

/*
 *  ═══════════════════════════════════════════════════════════════════
 *  YidengToken (YD) —— 陪审团资格代币 · 第 11 步
 *  ═══════════════════════════════════════════════════════════════════
 *  【角色】与 MYT 职责分离（PRD §9 的"yideng yd"口径）：
 *    - MYT = 平台激励血液（上架/完单空投，人人可领）
 *    - YD  = 治理准入（质押 100 YD 才有陪审资格，乱裁决被 slash 的也是 YD）
 *    两币分立 = "干活奖励"和"仲裁权力"不混账——权力要有价格，奖励不该赋权。
 *
 *  【经济闭环】陪审赚钱（每案多数方 10 YD + 0.5% 仲裁费均分），
 *    乱裁决罚没 15% 质押回流奖池——罚金养活下一个案件的公正。
 *
 *  【水龙头】每 24h 领 100 YD = 恰好一张陪审门票（MIN_STAKE 同额），
 *    测试网上人人可当陪审员；生产网准入要靠真实获取成本（生产替换点）。
 */

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract YidengToken is ERC20, Ownable {
    // ─────────────── 常量 ───────────────

    /// @notice 水龙头每次发 100 YD——正好等于 JuryCourt 的 MIN_STAKE
    uint256 public constant FAUCET_AMOUNT = 100 ether;

    /// @notice 领水冷却 24 小时（与 MyToken 同款限频写法）
    uint256 public constant FAUCET_COOLDOWN = 24 hours;

    /// @notice 初始供应 100 万 YD，全部铸造给部署者（平台）
    uint256 public constant INITIAL_SUPPLY = 1_000_000 ether;

    // ─────────────── 状态 ───────────────

    mapping(address => uint256) private _lastFaucetAt;

    event FaucetUsed(address indexed user, uint256 amount, uint256 nextAvailableAt);
    event Airdropped(address indexed operator, uint256 recipientCount);

    constructor() ERC20("Yideng", "YD") Ownable(msg.sender) {
        _mint(msg.sender, INITIAL_SUPPLY);
    }

    // ─────────────── 水龙头（测试网陪审员自助领门票） ───────────────

    function faucet() external {
        uint256 last = _lastFaucetAt[msg.sender];
        require(block.timestamp >= last + FAUCET_COOLDOWN, "YD: faucet cooldown");
        _lastFaucetAt[msg.sender] = block.timestamp;
        _mint(msg.sender, FAUCET_AMOUNT);
        emit FaucetUsed(msg.sender, FAUCET_AMOUNT, block.timestamp + FAUCET_COOLDOWN);
    }

    // ─────────────── 批量空投（仅平台，给陪审奖池/活动注资用） ───────────────

    function airdrop(address[] calldata to, uint256[] calldata amounts) external onlyOwner {
        require(to.length == amounts.length, "YD: length mismatch");
        for (uint256 i = 0; i < to.length; i++) {
            _mint(to[i], amounts[i]);
        }
        emit Airdropped(msg.sender, to.length);
    }
}
