const { ethers } = require("hardhat");
const hre = require("hardhat");
const { getTimeout } = require("../../utils/utils");
const { parse } = require("csv-parse/sync");
const fs = require("fs");

async function main() {
  const [maintainer] = await ethers.getSigners();

  // ........................ ENV ENV ENV ................
  const REWARD_POOL_ADDRESS = process.env.REWARD_POOL_ADDRESS;
  // ........................ ENV ENV ENV ................

  console.log("Maintainer wallet:", maintainer.address);

  const chainId = await hre.network.provider.send("eth_chainId");
  const timeout = getTimeout(chainId);

  const RewardPool = await ethers.getContractFactory("RewardPool");
  const rewardPool = await RewardPool.attach(REWARD_POOL_ADDRESS);

  const input = fs.readFileSync("./scripts/RewardPool/active-stakes.csv");
  const activeStakes = parse(input, { skip_records_with_error: true, columns: true, trim: true });

  const midIndex = Math.ceil(activeStakes.length / 2);
  const batch1 = activeStakes.slice(0, midIndex);
  const batch2 = activeStakes.slice(midIndex);

  const walletsBatch1 = batch1.map((row) => row.wallet);
  const amountsBatch1 = batch1.map((row) => BigInt(row.amount));

  const walletsBatch2 = batch2.map((row) => row.wallet);
  const amountsBatch2 = batch2.map((row) => BigInt(row.amount));

  let totalAmount1 = BigInt(0);
  for (const amount of amountsBatch1) {
    totalAmount1 += amount;
  }
  await rewardPool.connect(maintainer).forceMigrateToV2(walletsBatch1, amountsBatch1, totalAmount1);
  console.log("Batch 1 successfully migrated. Total amount:", totalAmount1);

  await timeout();

  let totalAmount2 = BigInt(0);
  for (const amount of amountsBatch2) {
    totalAmount2 += amount;
  }
  await rewardPool.connect(maintainer).forceMigrateToV2(walletsBatch2, amountsBatch2, totalAmount2);
  console.log("Batch 2 successfully migrated. Total amount:", totalAmount2);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
