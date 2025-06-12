// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IRewardPoolV3 {
    struct Stake {
        uint96 amount;
        uint32 withdrawAfter;
    }

    event RewardClaimed(address indexed account, uint256 amount);
    event Staked(
        uint256 indexed stakeId,
        address indexed account,
        uint96 amount,
        uint32 withdrawAfter
    );
    event StakingIncentiveUpdated(uint256 reward, uint32 incentiveEndsAt);
    event Unstaked(uint256 indexed stakeId, uint256 amount);
    event UnstakePeriodChanged(uint256 newUnstakePeriod);

    error InvalidIncentiveDuration(uint256 min, uint256 max);
    error InvalidReceiver(address account);
    error NoAvailableBalance(address token);
    error NoReward();
    error NoUnclaimedReward(address account);
    error NonTransferableToken();
    error OnlyStakeOwner(uint256 stakeId, address owner);
    error SameStakingAndRewardToken();
    error StakeLocked(uint256 stakeId, uint256 secondsBeforeUnstake);
    error ZeroAmount();

    function stakeFor(address account, uint96 amount) external;

    function claimReward(address account) external;

    function unstake(address to, uint256[] calldata stakeIds) external;

    function changeUnstakePeriod(uint32 newUnstakePeriod) external;

    function updateStakingIncentive(
        uint256 extraReward,
        uint256 incentiveDuration
    ) external;

    function recover(IERC20 token, address to) external;

    function rewardPerToken() external view returns (uint256);

    function earnedReward(address account) external view returns (uint256);

    function stakes(
        uint256 stakeId
    ) external view returns (uint96 amount, uint32 withdrawAfter);
}
