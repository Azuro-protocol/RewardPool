const { ethers } = require("hardhat");
const hre = require("hardhat");
const { getTimeout, deployRewardPoolV2 } = require("../../utils/utils");

async function main() {
  const [deployer] = await ethers.getSigners();

  // ........................ ENV ENV ENV ................
  const AZUR = process.env.AZUR;
  const NAME = process.env.NAME;
  const SYMBOL = process.env.SYMBOL;
  const UNSTAKEPERIOD = process.env.UNSTAKEPERIOD;
  // ........................ ENV ENV ENV ................

  console.log("Deployer wallet:", deployer.address);

  const chainId = await hre.network.provider.send("eth_chainId");
  const timeout = getTimeout(chainId);

  const rewardPoolV2 = await deployRewardPoolV2(AZUR, deployer, NAME, SYMBOL, UNSTAKEPERIOD);

  await timeout();
  console.log("RewardPoolV2:", await rewardPoolV2.getAddress());
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
