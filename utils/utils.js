const hre = require("hardhat");
const { ethers } = require("hardhat");

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

const makeStakeFor = async (rewardPool, staker, amount) => {
  await rewardPool.connect(staker).stakeFor(amount);
  return await getStakeForDetails(rewardPool);
};

const getStakeForDetails = async (rewardPool) => {
  let filter = rewardPool.filters.Staked;
  let e = (await rewardPool.queryFilter(filter, -1))[0].args;
  return {
    stakeId: e.stakeId,
    staker: e.staker,
    amount: e.amount,
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
  getBlockTime,
  timeShiftBy,
  makeStakeFor,
  getStakeForDetails,
  makeUnstake,
  getUnstakeDetails,
  makeRequestUnstake,
  getRequestUnstakeDetails,
  makeDistributeReward,
  makeWithdrawReward,
  getWithdrawRewardDetails,
  makeChangeUnstakePeriod,
  getChangeUnstakePeriodDetails,
};
