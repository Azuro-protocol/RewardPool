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

const makeStakeFor = async (staking, staker, node, amount) => {
  await staking.connect(staker).stakeFor(node, amount);
  return await getStakeForDetails(staking);
};

const getStakeForDetails = async (staking) => {
  let filter = staking.filters.Staked;
  let e = (await staking.queryFilter(filter, -1))[0].args;
  return {
    stakeId: e.stakeId,
    staker: e.staker,
    nodeId: e.nodeId,
    amount: e.amount,
  };
};

const makeUnstake = async (staking, staker, stakeId) => {
  await staking.connect(staker).unstake(stakeId);
  return await getUnstakeDetails(staking);
};

const getUnstakeDetails = async (staking) => {
  let filter = staking.filters.Unstaked;
  let filterReward = staking.filters.RewardWithdrawn;
  let e = (await staking.queryFilter(filter, -1))[0].args;
  let eReward = (await staking.queryFilter(filterReward, -1))[0].args;
  return {
    stakeId: e.stakeId,
    staker: e.staker,
    nodeId: e.nodeId,
    amount: e.amount,
    reward: eReward.reward,
  };
};

const makeDistributeReward = async (staking, owner, nodeIds, rewards) => {
  await staking.connect(owner).distributeReward(nodeIds, rewards);
  return await getDistributeRewardDetails(staking);
};

const getDistributeRewardDetails = async (staking) => {
  let filter = staking.filters.RewardDistributed;
  let e = (await staking.queryFilter(filter, -1))[0].args;
  return {
    nodeId: e.nodeId,
    reward: e.reward,
    fee: e.fee,
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
  makeDistributeReward,
};
