const { time, loadFixture } = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");
const { expect } = require("chai");

const {
  tokens,
  getBlockTime,
  timeShiftBy,
  makeStakeFor,
  makeUnstake,
  makeDistributeReward,
} = require("../utils/utils");

const INIT_MINT = tokens("100000");
const VALIDATORMINSTAKE = 0;
const BASE_STAKE = tokens("100");
const BASE_DEPO = BASE_STAKE * 10n;
const ONE_DAY = 60 * 60 * 24;
const ONE_WEEK = ONE_DAY * 7;

describe("Staking", function () {
  async function deployDistributorFixture() {
    // Contracts are deployed using the first signer/account by default
    const [owner, validator, user1, user2, user3] = await ethers.getSigners();
    const users = [user1, user2, user3];

    const AZUR = await ethers.getContractFactory("TestERC20", { signer: owner });
    const azur = await AZUR.deploy("AZUR", "AZUR", INIT_MINT);
    await azur.waitForDeployment();

    const STAKING = await ethers.getContractFactory("Staking", { signer: owner });

    const staking = await upgrades.deployProxy(STAKING, [await azur.getAddress(), VALIDATORMINSTAKE]);
    await staking.waitForDeployment();
    const stakingAddress = await staking.getAddress();

    await staking.createNode(validator, 0);
    filter = staking.filters.NodeCreated;
    events = await staking.queryFilter(filter, -1);
    const node = events[0].args[0];

    await azur.connect(owner).approve(stakingAddress, INIT_MINT);
    for (const i of users) {
      await azur.connect(owner).transfer(i.address, BASE_DEPO);
      await azur.connect(i).approve(stakingAddress, BASE_DEPO);
    }

    return { staking, azur, owner, validator, users, node };
  }

  describe("Deployment", function () {
    it("Should set the right owner and correct node", async function () {
      const { staking, owner, node } = await loadFixture(deployDistributorFixture);
      expect(await staking.owner()).to.equal(owner.address);
      expect(node).to.equal(1);
    });
    it("Get equal stakes from 3 stakers, withdraw stakes", async function () {
      const { staking, azur, owner, validator, users, node } = await loadFixture(deployDistributorFixture);
      let resStakes = [];
      let resUnstake;

      for (const i of users) {
        resStakes.push({ stake: await makeStakeFor(staking, i, node, BASE_STAKE), staker: i });
        await timeShiftBy(ethers, ONE_DAY);
      }

      for (const i of resStakes) {
        resUnstake = await makeUnstake(staking, i.staker, i.stake.stakeId);
        expect(resUnstake.amount).to.be.eq(BASE_STAKE);
      }
    });
    it("Get equal stakes from 3 stakers, add reward, withdraw stakes", async function () {
      const { staking, azur, owner, validator, users, node } = await loadFixture(deployDistributorFixture);
      let resStakes = [];
      let balancesGains = [];
      let totalRewards = 0n,
        gain;

      for (const i of users) {
        resStakes.push({ stake: await makeStakeFor(staking, i, node, BASE_STAKE), staker: i });
        await timeShiftBy(ethers, ONE_WEEK);
      }

      await timeShiftBy(ethers, ONE_DAY);

      await makeDistributeReward(staking, owner, [1], [BASE_STAKE]);

      for (const i of resStakes) {
        expect((await makeUnstake(staking, i.staker, i.stake.stakeId)).amount).to.be.eq(BASE_STAKE);

        gain = (await azur.balanceOf(i.staker.address)) - BASE_DEPO;
        balancesGains.push(gain);
        totalRewards += gain;
      }
      expect(totalRewards).to.be.closeTo(BASE_STAKE, 1);

      for (let i = 0; i < balancesGains.length - 1; i++) expect(balancesGains[i]).gt(balancesGains[i + 1]);
    });
  });
});
