const { ethers } = require("hardhat");
const hre = require("hardhat");
const { getTimeout, deployRewardPool } = require("../utils/utils");

async function main() {
  const [deployer] = await ethers.getSigners();

  // ........................ ENV ENV ENV ................
  const REWARD_POOL_ADDRESS = process.env.REWARD_POOL_ADDRESS;
  // ........................ ENV ENV ENV ................

  let summary = {};

  console.log("Deployer wallet:", deployer.address);
  console.log("Upgrading reward pool:", REWARD_POOL_ADDRESS);

  const chainId = await hre.network.provider.send("eth_chainId");
  const timeout = getTimeout(chainId);

  const REWARDPOOL = await ethers.getContractFactory("RewardPool");

  const rewardPool = await upgrades.upgradeProxy(REWARD_POOL_ADDRESS, REWARDPOOL);
  await timeout();
  let rewardPoolImplAddress = await upgrades.erc1967.getImplementationAddress(REWARD_POOL_ADDRESS);

  summary["rewardPoolImplAddress"] = rewardPoolImplAddress;
  console.log("Reward settings:", JSON.stringify(summary));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
