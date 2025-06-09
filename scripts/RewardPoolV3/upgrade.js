const { ethers } = require("hardhat");
const hre = require("hardhat");
const { getTimeout } = require("../../utils/utils");

async function main() {
  const [deployer] = await ethers.getSigners();

  // ........................ ENV ENV ENV ................
  const REWARD_POOL_V3_ADDRESS = process.env.REWARD_POOL_V3_ADDRESS;
  // ........................ ENV ENV ENV ................

  console.log("Deployer wallet:", deployer.address);
  console.log("Upgrading RewardPoolV3:", REWARD_POOL_V3_ADDRESS);

  const chainId = await hre.network.provider.send("eth_chainId");
  const timeout = getTimeout(chainId);

  const RewardPoolV3 = await ethers.getContractFactory("RewardPoolV3");
  await upgrades.upgradeProxy(REWARD_POOL_V3_ADDRESS, RewardPoolV3);
  await timeout();

  const rewardPoolV3ImplAddress = await upgrades.erc1967.getImplementationAddress(REWARD_POOL_V3_ADDRESS);
  console.log("RewardPoolV3 new implementation address:", rewardPoolV3ImplAddress);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
