// SPDX-License-Identifier: MIT

pragma solidity 0.8.24;

interface IRewardPool {
    /** @notice Structure describing one reward distribution for node */
    struct Distribution {
        uint256 rewardPerPower;
        uint96 rewardForPartialPower;
        uint64 time;
        uint96 reward;
        uint160 powerXTimeDelta;
        uint96 stakedIn;
    }

    /** @notice Structure describing stake information */
    struct Stake {
        address owner;
        uint96 amount;
        uint96 withdrawnReward;
        uint64 time;
        uint32 firstDistributionId;
    }

    /** @notice Structure describing unstake information */
    struct Unstake {
        address owner;
        uint96 amount;
        uint64 time;
    }

    /** @notice Event emitted when new stake is created */
    event Staked(
        uint256 indexed stakeId,
        address indexed staker,
        uint256 amount
    );

    /** @notice Event emitted when reward is wihdrawn for some stake */
    event RewardWithdrawn(uint256 indexed stakeId, uint256 reward);

    /** @notice Event emitted when some unstake is requested */
    event UnstakeRequested(
        uint256 indexed stakeId,
        address indexed staker,
        uint256 amount
    );

    /** @notice Event emitted when some stake is withdrawn */
    event Unstaked(
        uint256 indexed stakeId,
        address indexed staker,
        uint256 amount
    );

    /** @notice Event emitted when unstake period changed */
    event UnstakePeriodChanged(uint256 newUnstakePeriod);

    /** @notice Event emitted when reward is distributed */
    event RewardDistributed(uint256 reward);

    error NoStakes();
    error NotStakeOwner();
    error IncorrectUnstake();
    error IncorrectUnstakeTime();
    error MaxUnstakePeriodExceeded();
}
