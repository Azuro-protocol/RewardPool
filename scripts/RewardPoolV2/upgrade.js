const { ethers } = require("hardhat");
const hre = require("hardhat");
const { getTimeout } = require("../../utils/utils");

async function main() {
  const [deployer] = await ethers.getSigners();

  // ........................ ENV ENV ENV ................
  const REWARD_POOL_V2_ADDRESS = process.env.REWARD_POOL_V2_ADDRESS;
  // ........................ ENV ENV ENV ................

  console.log("Deployer wallet:", deployer.address);
  console.log("Upgrading RewardPoolV2:", REWARD_POOL_V2_ADDRESS);

  const chainId = await hre.network.provider.send("eth_chainId");
  const timeout = getTimeout(chainId);

  const RewardPoolV2 = await ethers.getContractFactory("RewardPoolV2");
  await upgrades.upgradeProxy(REWARD_POOL_V2_ADDRESS, RewardPoolV2);
  await timeout();

  const rewardPoolV2ImplAddress = await upgrades.erc1967.getImplementationAddress(REWARD_POOL_V2_ADDRESS);
  console.log("RewardPoolV2 new implementation address:", rewardPoolV2ImplAddress);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
