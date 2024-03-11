// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import {Test, console} from "forge-std/Test.sol";
import {RewardPool} from "../contracts/RewardPool.sol";
import {TestERC20} from "../contracts/mocks/TestToken.sol";
import {OwnerMock} from "../contracts/mocks/OwnerMock.sol";
import {Upgrades} from "openzeppelin-foundry-upgrades/Upgrades.sol";
import {RewardPoolHandler} from "./handlers/RewardPoolHandler.t.sol";

error InvalidInitialization();
error NoStakes();
error IncorrectUnstakeTime();
error OwnableUnauthorizedAccount(address caller);
error NotStakeOwner();

event Unstaked(uint256 stakeId, address owner, uint96 amount);
event Transfer(address from, address to, uint256 amount);
event RewardWithdrawn(uint256 stakeId, uint96 reward);
event UnstakePeriodChanged(uint256 newUnstakePeriod);

contract InvariantTests is Test {
    RewardPool pool;
    TestERC20 token;
    OwnerMock owner;

    RewardPool pool2;
    TestERC20 token2;
    OwnerMock owner2;

    RewardPoolHandler handler;
    RewardPoolHandler handler_without_distribution;

    function setUp() public {
        owner = new OwnerMock();
        token = owner.token();
        pool = owner.pool();

        handler = new RewardPoolHandler(pool, token, owner, true);

        owner2 = new OwnerMock();
        token2 = owner2.token();
        pool2 = owner2.pool();

        handler_without_distribution = new RewardPoolHandler(pool2, token2, owner2, false);

        targetContract(address(handler));
        //targetContract(address(handler_without_distribution));
    }

    function invariant_totalStaked_eq_SumOfStakes() public {
        uint256 totalStaked = 0;
        for (uint256 i = 1; i <= pool.lastStakeId(); i++) {
            (, uint96 amount, , , ) = pool.stakes(i);
            totalStaked += amount;
        }
        assertEq(totalStaked, pool.totalStaked());
    }

    function invariant_maxTotalPowerXTime_alwaysGe_realTotalPowerXTime() external {
        for (uint32 i = 1; i <= pool.lastDistributionId(); ++i) {
            (,,uint64 time_,, uint160 powerXTimeDelta_, uint96 stakedIn_) = pool.distributions(i);
            if (time_ == 0) {
                continue;
            }

            (,,uint64 previousTimestamp_,,,) = pool.distributions(i - 1);

            uint256 maxTotalPowerXTime = uint256(stakedIn_) * (time_ - previousTimestamp_);
            uint256 realTotalPowerXTime = maxTotalPowerXTime - powerXTimeDelta_;

            assertGe(maxTotalPowerXTime, realTotalPowerXTime);
        }
    }

    function invariant_realTotalPowerXTime_alwaysGe_stakePowerXTime() external {
        for (uint256 i = 1; i <= pool.lastStakeId(); ++i) {
            (address owner, uint96 amount_, , uint64 stakeTime_, uint32 firstDistributionId) = pool.stakes(i);
            if (owner == address(0)) {
                continue;
            }

            (,,uint64 time_,, uint160 powerXTimeDelta_, uint96 stakedIn_) = pool.distributions(firstDistributionId);
            if (time_ == 0) {
                continue;
            }

            (,,uint64 previousTimestamp_,,,) = pool.distributions(firstDistributionId - 1);
            uint256 maxTotalPowerXTime = uint256(stakedIn_) * (time_ - previousTimestamp_);
            uint256 realTotalPowerXTime = maxTotalPowerXTime - powerXTimeDelta_;

            uint256 stakePowerXTime = uint256(amount_) * (time_ - stakeTime_);
            assertGe(realTotalPowerXTime, stakePowerXTime);
        }
    }

    function invariant_totalStaked_Equals_StakedIn_onFirstDistribution() external {
        (,,,,, uint96 stakedIn_) = pool2.distributions(pool2.lastDistributionId() + 1);
        assertEq(pool2.totalStaked(), stakedIn_);
    }
}