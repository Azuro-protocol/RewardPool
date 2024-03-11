// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import {Test, console} from "forge-std/Test.sol";
import {RewardPool} from "../../contracts/hardhat/contracts/RewardPool.sol";
import {IRewardPool} from "../../contracts/hardhat/contracts/interface/IRewardPool.sol";
import {TestERC20} from "../../contracts/hardhat/contracts/mocks/TestToken.sol";
import {OwnerMock} from "../../contracts/forge/mocks/OwnerMock.sol";
import {Upgrades} from "openzeppelin-foundry-upgrades/Upgrades.sol";

error InvalidInitialization();
error NoStakes();
error IncorrectUnstakeTime();
error OwnableUnauthorizedAccount(address caller);
error NotStakeOwner();

event Unstaked(uint256 stakeId, address owner, uint96 amount);
event Transfer(address from, address to, uint256 amount);
event RewardWithdrawn(uint256 stakeId, uint96 reward);
event UnstakePeriodChanged(uint256 newUnstakePeriod);

contract RewardPoolHandler is Test {
    RewardPool public pool;
    TestERC20 public token;
    OwnerMock public owner;
    bool public distributionEnabled;

    constructor(RewardPool pool_, TestERC20 token_, OwnerMock owner_, bool distributionEnabled_) {
        pool = pool_;
        token = token_;
        owner = owner_;
        distributionEnabled = distributionEnabled_;
        token.approve(address(pool), 2 ** 256 - 1);
    }

    function stake(uint96 amount) external {
        uint96 amount_ = ((amount << 4) >> 4); // decrese max value to avoid overflows on rewards farming
        if (amount_ != 0 && amount_ <= type(uint96).max - pool.totalStaked()){
            owner.mintToken(address(this), amount_);
            pool.stakeFor(amount_);
        }
    }

    function requestUnstake(uint256 stakeId) external {
        uint256 stakeId_ = stakeId % (pool.lastStakeId() + 1);
        (address stakeOwner_, , , , ) = pool.stakes(stakeId_);
        if (stakeOwner_ != address(0)) {
            pool.requestUnstake(stakeId_);
        }
    }

    function unstake(uint256 stakeId) external {
         uint256 stakeId_ = stakeId % (pool.lastStakeId() + 1);
        (address stakeOwner_, uint96 amount_, ) = pool.unstakes(stakeId_);
        if (stakeOwner_ != address(0) && amount_ != 0) {
            vm.warp(block.timestamp + 2 weeks);
            pool.unstake(stakeId_);
        }
    }

    function withdrawReward(uint256 stakeId) external {
        uint256 stakeId_ = stakeId % (pool.lastStakeId() + 1);
        (address stakeOwner_, , , , ) = pool.stakes(stakeId_);
        if (stakeOwner_ != address(0)) {
            pool.withdrawReward(stakeId_);
        }
    }

    function distributeReward(uint96 reward) external {
        if (!distributionEnabled) {
            return;
        }
        uint96 reward_ = ((reward << 4) >> 4); // decrese max value to avoid overflows on rewards farming
        for (uint256 i = 1; i <= pool.lastStakeId(); i++) {
            (address stakeOwner_, , , , ) = pool.stakes(i);
            if (stakeOwner_ != address(0)) { // if there is any active stake
                vm.warp(block.timestamp + 1 weeks);

                // check that the stakes sum is enough to distribute rewards
                (,, uint64 timePrev_,,,) = pool.distributions(pool.lastDistributionId());
                (,,,, uint160 powerXTimeDelta_, uint96 stakedIn_) = pool.distributions(pool.lastDistributionId() + 1);
                uint maxTotalPowerXTime = stakedIn_ * (block.timestamp - timePrev_);
                if (pool.totalStaked() - stakedIn_ == 0
                        && uint256(stakedIn_) * 1000 < uint256(maxTotalPowerXTime) * 1000 / (maxTotalPowerXTime - powerXTimeDelta_)) {
                    return;
                }

                owner.distributeReward(uint256(reward_));
                break;
            }
        }
    }
}