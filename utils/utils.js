const { ethers } = require("hardhat");

function getTimeout(chainId) {
  let timeout;
  switch (chainId) {
    case "0x2a":
      timeout = 8000;
      break; // Kovan
    case "0x4d":
      timeout = 35000;
      break; // Sokol
    case "0x7a69":
      timeout = 800;
      break; // Hardhat
    default:
      timeout = 20000;
  }

  return () => {
    return new Promise((resolve) => setTimeout(resolve, timeout));
  };
}

function tokens(val) {
  return BigInt(val) * 10n ** 18n;
}

async function getBlockTime(ethers) {
  const blockNumBefore = await ethers.provider.getBlockNumber();
  const blockBefore = await ethers.provider.getBlock(blockNumBefore);
  const time = blockBefore.timestamp;
  return time;
}

async function timeShiftBy(ethers, timeDelta) {
  let time = (await getBlockTime(ethers)) + timeDelta;
  await network.provider.send("evm_setNextBlockTimestamp", [time]);
  await network.provider.send("evm_mine");
}

const deployRewardPool = async (azurAddress, owner, unstakedPeriod) => {
  const REWARDPOOL = await ethers.getContractFactory("RewardPool", { signer: owner });
  const rewardPool = await upgrades.deployProxy(REWARDPOOL, [azurAddress, unstakedPeriod]);
  await rewardPool.waitForDeployment();
  return rewardPool;
};

const deployRewardPoolV2 = async (azurAddress, owner, name, symbol, unstakePeriod) => {
  const RewardPoolV2 = await ethers.getContractFactory("RewardPoolV2", { signer: owner });
  const rewardPoolV2 = await upgrades.deployProxy(RewardPoolV2, [azurAddress, name, symbol, unstakePeriod]);
  await rewardPoolV2.waitForDeployment();
  return rewardPoolV2;
};

const makeStake = async (rewardPool, staker, amount) => {
  const tx = await rewardPool.connect(staker).stake(amount);
  return await getStakeDetails(tx);
};

const makeStakeFor = async (rewardPool, staker, amount, recepient) => {
  const tx = await rewardPool.connect(staker).stakeFor(recepient, amount);
  return await getStakeDetails(tx);
};

const getStakeDetails = async (tx) => {
  const result = await tx.wait();
  return {
    stakeId: result.logs[1].args.stakeId,
    staker: result.logs[1].args.staker,
    amount: result.logs[1].args.amount,
  };
};

const makeRequestUnstake = async (rewardPool, staker, stakeId) => {
  await rewardPool.connect(staker).requestUnstake(stakeId);
  return await getRequestUnstakeDetails(rewardPool);
};

const getRequestUnstakeDetails = async (rewardPool) => {
  let filter = rewardPool.filters.UnstakeRequested;
  let filterReward = rewardPool.filters.RewardWithdrawn;
  let e = (await rewardPool.queryFilter(filter, -1))[0].args;
  let eReward = (await rewardPool.queryFilter(filterReward, -1))[0].args;
  return {
    stakeId: e.stakeId,
    staker: e.staker,
    amount: e.amount,
    reward: eReward.reward,
  };
};

const makeMigrationToV2 = async (rewardPool, staker, stakeId) => {
  await rewardPool.connect(staker).migrateToV2(stakeId);
};

const makeUnstake = async (rewardPool, staker, stakeId) => {
  await rewardPool.connect(staker).unstake(stakeId);
  return await getUnstakeDetails(rewardPool);
};

const getUnstakeDetails = async (rewardPool) => {
  let filter = rewardPool.filters.Unstaked;
  let e = (await rewardPool.queryFilter(filter, -1))[0].args;
  return {
    stakeId: e.stakeId,
    staker: e.staker,
    amount: e.amount,
  };
};

const makeDistributeReward = async (rewardPool, owner, reward) => {
  await rewardPool.connect(owner).distributeReward(reward);
  return await getDistributeRewardDetails(rewardPool);
};

const getDistributeRewardDetails = async (rewardPool) => {
  let filter = rewardPool.filters.RewardDistributed;
  let e = (await rewardPool.queryFilter(filter, -1))[0].args;
  return {
    reward: e.reward,
    fee: e.fee,
  };
};

const makeWithdrawReward = async (rewardPool, staker, stakeId) => {
  await rewardPool.connect(staker).withdrawReward(stakeId);
  return await getWithdrawRewardDetails(rewardPool);
};

const getWithdrawRewardDetails = async (rewardPool) => {
  let filter = rewardPool.filters.RewardWithdrawn;
  let e = (await rewardPool.queryFilter(filter, -1))[0].args;
  return {
    stakeId: e.stakeId,
    reward: e.reward,
  };
};

const makeChangeUnstakePeriod = async (rewardPool, owner, newUnstakePeriod) => {
  await rewardPool.connect(owner).changeUnstakePeriod(newUnstakePeriod);
  return await getChangeUnstakePeriodDetails(rewardPool);
};

const getChangeUnstakePeriodDetails = async (rewardPool) => {
  let filter = rewardPool.filters.UnstakePeriodChanged;
  let e = (await rewardPool.queryFilter(filter, -1))[0].args;
  return {
    newUnstakePeriod: e.newUnstakePeriod,
  };
};

module.exports = {
  tokens,
  getTimeout,
  timeShiftBy,
  makeStake,
  makeStakeFor,
  deployRewardPool,
  deployRewardPoolV2,
  getStakeDetails,
  makeUnstake,
  getUnstakeDetails,
  makeRequestUnstake,
  getRequestUnstakeDetails,
  makeDistributeReward,
  makeWithdrawReward,
  getWithdrawRewardDetails,
  makeChangeUnstakePeriod,
  getChangeUnstakePeriodDetails,
  makeMigrationToV2,
};
