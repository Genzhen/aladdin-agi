// 合约地址 + 精简 ABI（human-readable 形式，只写前端用到的函数/事件）
// 地址单一来源：项目根 deployed.json（部署脚本产物）——这里手工同步一份并注明
import { parseEther, parseAbi } from 'viem'

export const ADDR = {
  MyToken: '0xA1250f0B4d812E04610Ad33e13ff1741cA21Fee0',
  AgentRegistry: '0xCac00e365368bCA444fA1d493eD17Df0F506e7b1',
  TaskEscrow: '0xa934CAA9D6D0e2ca68985A775A482091390Cf6aa',
  // 第 11 步（2026-08-22 部署）：YD 陪审资格币 + 陪审法庭
  YidengToken: '0xB14CcEd2ee774c51ac98b7f72f1D62Be86506409',
  JuryCourt: '0x8fa498A43d7F6A87caa594735F305b1B8D8ba7f4',
}

// 费率基点（和合约常量一一对应：10/10000=0.1% 手续费、600=6% 保证金、50=0.5% 仲裁费）
export const BPS = { fee: 10n, deposit: 600n, arb: 50n, scale: 10_000n }
export const feeOf = (priceWei) => (priceWei * BPS.fee) / BPS.scale
export const depositOf = (priceWei) => (priceWei * BPS.deposit) / BPS.scale
export const arbFeeOf = (priceWei) => (priceWei * BPS.arb) / BPS.scale

export const ABI = {
  token: parseAbi([
    'function name() view returns (string)',
    'function balanceOf(address) view returns (uint256)',
    'function faucet()',
    'function airdrop(address[] calldata to, uint256[] calldata amounts)',
    'event Airdropped(address indexed sender, uint256 count, uint256 totalAmount)',
  ]),
  registry: parseAbi([
    'function totalAgents() view returns (uint256)',
    'function ownerOf(uint256) view returns (address)',
    // ⚠️ 坑：human-readable ABI 里内联 tuple(...) 一律 InvalidParameterError——
    // abitype 要求先声明 struct、函数签名里按名字引用（parseStructs 专门收集这种行）
    'struct AgentInfo { address owner; string name; string category; string tags; uint256 pricePerRun; uint256 score; bool exists; }',
    'function agents(uint256) view returns (AgentInfo)',
    'function register(string name, string category, string tags, uint256 pricePerRun)',
    'event AgentRegistered(uint256 indexed id, address indexed owner, string name, string category, uint256 pricePerRun)',
  ]),
  escrow: parseAbi([
    'function tasks(uint256) view returns (uint8 state, address publisher, uint256 price, uint256 deadline, address agent, uint256 agentId, bool disputed)',
    'function nextTaskId() view returns (uint256)',
    'function postTask(uint256 price, uint256 deadline) payable',
    'function accept(uint256 taskId, uint256 agentId) payable',
    'function submit(uint256 taskId)',
    'function approve(uint256 taskId)',
    'function openDispute(uint256 taskId)', // non-payable：仲裁费 0.5% 在 executeRuling 时从托管池扣
    'function executeRuling(uint256 taskId, uint8 ruling)',
    'function owner() view returns (address)', // OZ Ownable：平台仲裁人（前端只判显示，真权限在 onlyOwner）
    'function claimTimeout(uint256 taskId)',
    'event TaskPosted(uint256 indexed id, address indexed publisher, uint256 price, uint256 totalStaked, uint64 deadline)',
    'event TaskApproved(uint256 indexed id, address indexed agent, uint256 payout)',
    'event TaskRuled(uint256 indexed id, uint8 ruling, uint256 arbitrationFee)',
  ]),
  // 第 11 步：YD 陪审资格币（水龙头恰好发 100 = 一张陪审门票）
  yd: parseAbi([
    'function name() view returns (string)',
    'function balanceOf(address) view returns (uint256)',
    'function faucet()',
    'function approve(address spender, uint256 amount)',
    'function allowance(address owner, address spender) view returns (uint256)',
    'event FaucetUsed(address indexed user, uint256 amount, uint256 nextAvailableAt)',
  ]),
  // 第 11 步：陪审法庭（getCase 返回 struct——坑：含数组的 struct 必须
  // 先声明 struct 行再引用，和 registry 的 AgentInfo 同一招）
  court: parseAbi([
    'struct CaseView { uint8 phase; address publisher; address agent; address[3] panel; uint8[3] votes; bool[3] voted; uint256 voteEnds; uint8 finalRuling; }',
    'function getCase(uint256 taskId) view returns (CaseView)',
    'function jurors(address) view returns (uint256 stake, uint256 activeCaseId)',
    'function jurorCount() view returns (uint256)',
    'function rewardPool() view returns (uint256)',
    'function MIN_STAKE() view returns (uint256)',
    'function stake(uint256 amount)',
    'function unstake(uint256 amount)',
    'function openCase(uint256 taskId)',
    'function castVote(uint256 taskId, uint8 vote)',
    'function closeCase(uint256 taskId)',
    'event CaseOpened(uint256 indexed taskId, address[3] panel, uint256 voteEnds)',
    'event VoteCast(uint256 indexed taskId, address indexed juror, uint8 vote)',
    'event CaseRuled(uint256 indexed taskId, uint8 ruling, uint256 winnerCount, uint256 slashedCount)',
  ]),
}

/** 价格展示：wei(字符串) → ETH 数字（两位小数以上自动保留） */
export const toEthNum = (wei) => Number(BigInt(wei || 0)) / 1e18
export const ethToWei = (eth) => parseEther(String(eth))
