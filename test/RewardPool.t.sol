// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import {Test, console} from "forge-std/Test.sol";
import {RewardPool} from "../contracts/hardhat/contracts/RewardPool.sol";
import {TestERC20} from "../contracts/hardhat/contracts/mocks/TestToken.sol";
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

contract RewardPoolTest is Test {
    uint256 constant INIT_MINT = 100000 ether;
    uint256 constant UNSTAKE_PERIOD = 1 weeks;
    uint256 constant BASE_STAKE = 100 ether;
    uint256 constant BASE_DEPO = BASE_STAKE * 10;
    uint256 constant BASE_REWARD = 100 ether;

    address[3] users = [address(vm.addr(1)), address(vm.addr(2)), address(vm.addr(3))];

    RewardPool public pool;
    TestERC20 public token;

    function setUp() public {
        token = new TestERC20("AZUR", "AZUR", INIT_MINT);
        pool = RewardPool(Upgrades.deployTransparentProxy(
            "RewardPool.sol",
            address(this), // owner
            abi.encodeCall(RewardPool.initialize, (token, UNSTAKE_PERIOD))
        ));

        token.approve(address(pool), INIT_MINT);
        for (uint256 i = 0; i < 3; i++) {
            token.transfer(users[i], BASE_DEPO);
            vm.startPrank(address(vm.addr(i + 1)));
            token.approve(address(pool), BASE_DEPO);
            vm.stopPrank();
        }
    }

    function test_Reinitialize() public {
        vm.expectRevert(InvalidInitialization.selector);
        pool.initialize(token, 0);
    }

    function test_CorrectOwnership() public {
        assertEq(address(pool.owner()), address(this));
    }

    function test_DistributeRewardsWithNoStakes() public {
        vm.expectRevert(NoStakes.selector);
        pool.distributeReward(BASE_REWARD);
    }

    function test_EqualStakesFromThreeStakers_WithdrawStakes() public {
        uint256[4] memory stakeIds;
        uint256 stakeId;
        uint256 amount;

        // Each user stakes BASE_STAKE
        for (uint256 i = 0; i < 3; i++) {
            vm.startPrank(users[i]);
            stakeId = pool.stakeFor(uint96(BASE_STAKE));
            stakeIds[i] = stakeId;
            vm.stopPrank();
            vm.warp(block.timestamp + 1 days);
        }

        // The last user stakes BASE_STAKE again
        vm.startPrank(users[2]);
        stakeId = pool.stakeFor(uint96(BASE_STAKE));
        stakeIds[3] = stakeId;
        vm.stopPrank();

        // Each user requests unstake
        for (uint256 i = 0; i < 3; i++) {
            vm.startPrank(users[i]);
            pool.requestUnstake(stakeIds[i]);
            vm.stopPrank();
        }

        // Each user tries to unstake before UNSTAKE_PERIOD, should fail
        for (uint256 i = 0; i < 3; i++) {
            vm.startPrank(users[i]);
            vm.expectRevert(IncorrectUnstakeTime.selector);
            pool.unstake(stakeIds[i]);
            vm.stopPrank();
        }

        // Time travel by UNSTAKE_PERIOD
        vm.warp(block.timestamp + UNSTAKE_PERIOD);
        uint256 amountBefore;
        // Each user unstakes after UNSTAKE_PERIOD
        for (uint256 i = 0; i < 3; i++) {
            vm.startPrank(users[i]);
            amountBefore = token.balanceOf(users[i]);
            pool.unstake(stakeIds[i]);
            amount = token.balanceOf(users[i]);
            assertEq(amount, amountBefore + BASE_STAKE);
            vm.stopPrank();
            vm.warp(block.timestamp + 1 days);
        }
    }

    function test_EqualStakesFromThreeStakers_AddReward_WithdrawStakes() public {
        uint256[4] memory stakeIds;
        uint256 stakeId;
        uint256 amount;

        // Each user stakes BASE_STAKE
        for (uint256 i = 0; i < 3; i++) {
            vm.startPrank(users[i]);
            stakeId = pool.stakeFor(uint96(BASE_STAKE));
            stakeIds[i] = stakeId;
            vm.stopPrank();
            vm.warp(block.timestamp + 1 weeks);
        }

        vm.warp(block.timestamp + 1 days);
        
        // Try to distribute rewards from a non-owner account, should fail
        for (uint256 i = 0; i < 3; i++) {
            vm.startPrank(users[i]);
            vm.expectRevert(abi.encodeWithSelector(OwnableUnauthorizedAccount.selector, users[i]));
            pool.distributeReward(BASE_REWARD);
            vm.stopPrank();
        }

        pool.distributeReward(BASE_REWARD);

        // Each user tries to request unstake
        for (uint256 i = 0; i < 3; i++) {
            vm.startPrank(users[i]);
            pool.requestUnstake(stakeIds[i]);
            vm.stopPrank();
        }

        // Time travel by UNSTAKE_PERIOD
        vm.warp(block.timestamp + UNSTAKE_PERIOD);

        uint256 totalRewards;
        uint256 gain;
        uint256 amountBefore;
        uint256[] memory balancesGains = new uint256[](3);

        // Each user unstakes after UNSTAKE_PERIOD
        for (uint256 i = 0; i < 3; i++) {
            vm.startPrank(users[i]);
            amountBefore = token.balanceOf(users[i]);
            pool.unstake(stakeIds[i]);
            amount = token.balanceOf(users[i]);
            gain = amount - BASE_DEPO;
            balancesGains[i] = gain;
            totalRewards += gain;
            vm.stopPrank();
        }

        assertApproxEqRel(totalRewards, BASE_REWARD, 0.01e18); // %1 error

        for (uint256 i = 0; i < balancesGains.length - 1; i++) {
            assertTrue(balancesGains[i] > balancesGains[i + 1]);
        }
    }

    function test_EqualStakesFromThreeStakers_WithdrawRewards_SecondReward_CheckEqualityRewards() public {
        uint256[4] memory stakeIds;
        uint256 stakeId;
        uint256 withdrawn;
        uint256 totalRewards = 0;
        uint256[] memory withdrawals = new uint256[](3);
        uint256 amountBefore;

        // Each user stakes
        for (uint256 i = 0; i < 3; i++) {
            vm.startPrank(users[i]);
            stakeId = pool.stakeFor(uint96(BASE_STAKE));
            stakeIds[i] = stakeId;
            vm.stopPrank();
            vm.warp(block.timestamp + 1 days);
        }

        // Distribute rewards
        pool.distributeReward(BASE_REWARD);

        for (uint256 i = 0; i < 3; i++) {
            vm.startPrank(users[i]);
            vm.expectRevert(abi.encodeWithSelector(NotStakeOwner.selector));
            pool.withdrawReward(stakeIds[(i + 2) % 3]);
            vm.stopPrank();
        }

        // Each user tries to withdraw rewards
        for (uint256 i = 0; i < 3; i++) {
            vm.startPrank(users[i]);
            amountBefore = token.balanceOf(users[i]);
            //vm.expectRevert(abi.encodeWithSelector(NotStakeOwner.selector, users[i], stakeIds[(i + 2) % 3]));
            pool.withdrawReward(stakeIds[i]);
            withdrawn = token.balanceOf(users[i]) - amountBefore;
            withdrawals[i] = withdrawn;
            totalRewards += withdrawn;
            vm.warp(block.timestamp + 1 seconds);
            vm.stopPrank();
        }

        assertApproxEqRel(totalRewards, BASE_REWARD, 0.01e18); // %1 error

        for (uint256 i = 0; i < 2; i++) {
            assertTrue(withdrawals[i] > withdrawals[i + 1]);
        }

        // Second reward
        vm.warp(block.timestamp + 1 days);
        pool.distributeReward(BASE_REWARD);

        totalRewards = 0;
        withdrawals = new uint256[](3);

        // Each user tries to withdraw rewards again
        for (uint256 i = 0; i < 3; i++) {
            vm.startPrank(users[i]);
            amountBefore = token.balanceOf(users[i]);
            pool.withdrawReward(stakeIds[i]);
            withdrawn = token.balanceOf(users[i]) - amountBefore;
            withdrawals[i] = withdrawn;
            totalRewards += withdrawn;
            vm.warp(block.timestamp + 1 seconds);
            vm.stopPrank();
        }

        assertApproxEqRel(totalRewards, BASE_REWARD, 0.01e18); // %1 error

        for (uint256 i = 0; i < 2; i++) {
            assertEq(withdrawals[i], withdrawals[i + 1]);
        }
    }

    function test_ThreeEqualStakesFromOneStaker_AddReward_WithdrawRewards_TimeDependent() public {
        uint256[3] memory stakeIds;
        uint256 stakeId;
        uint256 amountBefore;
        uint256 withdrawn;
        uint256 totalRewards = 0;
        uint256 amount;
        uint256[3] memory withdrawals;

        vm.startPrank(users[0]);
        vm.expectRevert(abi.encodeWithSelector(OwnableUnauthorizedAccount.selector, users[0]));
        pool.changeUnstakePeriod(UNSTAKE_PERIOD * 2);
        vm.stopPrank();

        vm.expectEmit();
        emit UnstakePeriodChanged(UNSTAKE_PERIOD * 2);
        pool.changeUnstakePeriod(UNSTAKE_PERIOD * 2);
        assertEq(pool.unstakePeriod(), UNSTAKE_PERIOD * 2);

        amountBefore = token.balanceOf(users[0]);

        for (uint256 i = 0; i < 3; i++) {
            vm.startPrank(users[0]);
            stakeId = pool.stakeFor(uint96(BASE_STAKE));
            stakeIds[i] = stakeId;
            vm.warp(block.timestamp + 1 days);
            vm.stopPrank();
        }

        amount = token.balanceOf(users[0]);
        assertEq(amount, amountBefore - BASE_STAKE * 3);
        
        pool.distributeReward(BASE_REWARD);

        amountBefore = token.balanceOf(users[0]);

        for (uint256 i = 0; i < 3; i++) {
            vm.startPrank(users[0]);
            pool.requestUnstake(stakeIds[i]);
            vm.warp(block.timestamp + 1 seconds);
            vm.stopPrank();
        }

        amount = token.balanceOf(users[0]);

        assertApproxEqRel(amount, amountBefore + BASE_REWARD, 0.01e18);
       
    }

    function test_ThreeEqualStakesFromOneStaker_AddReward_BatchWithdrawRewards_BatchUnstake() public {
        uint256 amountBefore;
        uint256 amount;
        uint256[] memory stakeIdsBatch = new uint256[](3);

        for (uint256 i = 0; i < 3; i++) {
            vm.startPrank(users[0]);
            uint256 stakeId = pool.stakeFor(uint96(BASE_STAKE));
            stakeIdsBatch[i] = stakeId;
            vm.warp(block.timestamp + 1 days);
            vm.stopPrank();
        }

        pool.distributeReward(BASE_REWARD);

        amountBefore = token.balanceOf(users[0]);

        vm.startPrank(users[0]);
        pool.batchWithdrawReward(stakeIdsBatch);
        vm.warp(block.timestamp + 1 seconds);
        vm.stopPrank();

        amount = token.balanceOf(users[0]);
        assertApproxEqRel(amount, amountBefore + BASE_REWARD, 0.01e18);

        vm.startPrank(users[0]);
        pool.batchRequestUnstake(stakeIdsBatch);
        vm.warp(block.timestamp + 1 seconds);
        vm.stopPrank();

        vm.warp(block.timestamp + 1 weeks);

        amountBefore = token.balanceOf(users[0]);

        vm.startPrank(users[0]);
        pool.batchUnstake(stakeIdsBatch);
        vm.stopPrank();

        amount = token.balanceOf(users[0]);
        assertEq(amount, amountBefore + BASE_STAKE * 3);

    }

    function test_ThreeEqualStakesFromThreeStakers_SecondStakerWithdraws_AddReward_WithdrawStakes() public {
        uint256[3] memory stakeIds;
        uint256 stakeId;
        uint256 amountBefore;
        uint256 amount;
        uint256 withdrawn;
        uint256 totalRewards = 0;
        uint256[] memory withdrawals = new uint256[](3);

        for (uint256 i = 0; i < 3; i++) {
            vm.startPrank(users[i]);
            stakeId = pool.stakeFor(uint96(BASE_STAKE));
            stakeIds[i] = stakeId;
            vm.warp(block.timestamp + 7 days);
            vm.stopPrank();
        }

        vm.warp(block.timestamp + 1 days);

        amountBefore = token.balanceOf(users[1]);

        vm.startPrank(users[1]);
        pool.requestUnstake(stakeIds[1]);
        vm.stopPrank();

        vm.warp(block.timestamp + 1 weeks);

        vm.startPrank(users[1]);
        pool.unstake(stakeIds[1]);
        vm.stopPrank();

        amount = token.balanceOf(users[1]);
        assertEq(amount, amountBefore + BASE_STAKE);

        pool.distributeReward(BASE_REWARD);

        totalRewards = 0;
        for (uint256 i = 0; i < 3; i++) {
            if (i == 1) {
                continue;
            }
            vm.startPrank(users[i]);
            amountBefore = token.balanceOf(users[i]);
            pool.requestUnstake(stakeIds[i]);
            amount = token.balanceOf(users[i]);
            totalRewards += amount - amountBefore;
            vm.warp(block.timestamp + 1 seconds);
            vm.stopPrank();
        }

        assertApproxEqRel(totalRewards, BASE_REWARD, 0.01e18); // %1 error

        vm.warp(block.timestamp + UNSTAKE_PERIOD);

        totalRewards = 0;
        for (uint256 i = 0; i < 3; i++) {
            if (i == 1) {
                continue;
            }
            vm.startPrank(users[i]);
            amountBefore = token.balanceOf(users[i]);
            pool.unstake(stakeIds[i]);
            withdrawn = token.balanceOf(users[i]) - amountBefore;
            withdrawals[i] = withdrawn;
            totalRewards += withdrawn;
            vm.stopPrank();
        }

        assertApproxEqRel(totalRewards, BASE_STAKE * 2, 0.01e18); // %1 error

        assertTrue(withdrawals[0] > withdrawals[1]);
    }

    function test_ThreeEqualStakesFromThreeStakers_AddReward_WithdrawRewards() public {
        uint256[3] memory stakeIds;
        uint256 stakeId;
        uint256 amountBefore;
        uint256 amount;
        uint256 withdrawn;
        uint256 totalRewards = 0;
        uint256[] memory withdrawals = new uint256[](3);

        for (uint256 i = 0; i < 2; i++) {
            vm.startPrank(users[i]);
            stakeId = pool.stakeFor(uint96(BASE_STAKE));
            stakeIds[i] = stakeId;
            vm.warp(block.timestamp + 7 days);
            vm.stopPrank();
        }

        vm.warp(block.timestamp + 1 days);
        vm.startPrank(users[2]);
        stakeId = pool.stakeFor(uint96(0));
        stakeIds[2] = stakeId;
        vm.stopPrank();

        pool.distributeReward(BASE_REWARD);

        for (uint256 i = 0; i < 3; i++) {
            vm.startPrank(users[i]);
            amountBefore = token.balanceOf(users[i]);
            pool.withdrawReward(stakeIds[i]);
            withdrawn = token.balanceOf(users[i]) - amountBefore;
            withdrawals[i] = withdrawn;
            totalRewards += withdrawn;
            vm.warp(block.timestamp + 1 seconds);
            vm.stopPrank();
        }

        assertApproxEqRel(totalRewards, BASE_REWARD, 0.01e18); // %1 error
    }

}
