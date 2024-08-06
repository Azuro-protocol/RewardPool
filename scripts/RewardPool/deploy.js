const { ethers } = require("hardhat");
const hre = require("hardhat");
const { getTimeout, deployRewardPool } = require("../../utils/utils");

async function main() {
  const [deployer] = await ethers.getSigners();

  // ........................ ENV ENV ENV ................
  const AZUR = process.env.AZUR;
  const UNSTAKEPERIOD = process.env.UNSTAKEPERIOD;
  // ........................ ENV ENV ENV ................

  let summary = {};

  console.log("Deployer wallet:", deployer.address);

  const chainId = await hre.network.provider.send("eth_chainId");
  const timeout = getTimeout(chainId);

  const rewardPool = await deployRewardPool(AZUR, deployer, UNSTAKEPERIOD);

  await timeout();
  summary["UNSTAKEPERIOD"] = UNSTAKEPERIOD;

  console.log("Reward settings:", JSON.stringify(summary));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
