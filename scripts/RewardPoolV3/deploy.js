const { ethers } = require("hardhat");
const hre = require("hardhat");
const { getTimeout, deployRewardPoolV3 } = require("../../utils/utils");

async function main() {
  const [deployer] = await ethers.getSigners();

  // ........................ ENV ENV ENV ................
  const AZUR = process.env.AZUR;
  const REWARD_TOKEN = process.env.REWARD_TOKEN;
  const UNSTAKEPERIOD = process.env.UNSTAKEPERIOD;
  // ........................ ENV ENV ENV ................

  console.log("Deployer wallet:", deployer.address);

  const chainId = await hre.network.provider.send("eth_chainId");
  const timeout = getTimeout(chainId);

  const rewardPoolV2 = await deployRewardPoolV3(AZUR, REWARD_TOKEN, UNSTAKEPERIOD);

  await timeout();
  console.log("RewardPoolV3:", await rewardPoolV2.getAddress());
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
