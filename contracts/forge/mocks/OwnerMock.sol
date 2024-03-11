// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import {RewardPool} from "../../hardhat/contracts/RewardPool.sol";
import {TestERC20} from "../../hardhat/contracts/mocks/TestToken.sol";
import {Upgrades} from "@openzeppelin/foundry-upgrades/Upgrades.sol";

contract OwnerMock {
    RewardPool public pool;
    TestERC20 public token;

    uint256 constant INIT_MINT = 100000 ether;
    uint256 constant UNSTAKE_PERIOD = 1 weeks;

    constructor() {
        token = new TestERC20("AZUR", "AZUR", INIT_MINT);

        pool = RewardPool(
            Upgrades.deployTransparentProxy(
                "RewardPool.sol",
                address(this), // owner
                abi.encodeCall(RewardPool.initialize, (token, UNSTAKE_PERIOD))
            )
        );
        token.approve(address(pool), 2 ** 256 - 1);
    }

    function mintToken(address addr, uint amount) external {
        token.mint(addr, amount);
    }

    function changeUnstakePeriod(uint256 newUnstakePeriod) external {
        pool.changeUnstakePeriod(newUnstakePeriod);
    }

    function distributeReward(uint256 reward) external {
        token.mint(address(this), reward);
        pool.distributeReward(reward);
    }
}
