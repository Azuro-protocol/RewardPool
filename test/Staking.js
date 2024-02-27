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
const ONE_SECOND = 1;
const ONE_DAY = 60 * 60 * 24;
const ONE_WEEK = ONE_DAY * 7;

describe("Staking", function () {
  async function deployDistributorFixture() {
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
      const { staking, users, node } = await loadFixture(deployDistributorFixture);
      let resStakes = [];
      let resUnstake;

      for (const i of users) {
        resStakes.push({ stake: await makeStakeFor(staking, i, node, BASE_STAKE), staker: i });
        await timeShiftBy(ethers, ONE_DAY);
      }
      // last staker add second stake
      resStakes.push({ stake: await makeStakeFor(staking, users[2], node, BASE_STAKE), staker: users[2] });

      for (const i of resStakes) {
        resUnstake = await makeUnstake(staking, i.staker, i.stake.stakeId);
        await timeShiftBy(ethers, ONE_DAY);
        expect(resUnstake.amount).to.be.eq(BASE_STAKE);
      }
    });
    it("Get equal stakes from 3 stakers, add reward, withdraw stakes", async function () {
      const { staking, azur, owner, users, node } = await loadFixture(deployDistributorFixture);
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
    it("Get 3 equal stakes from one staker, add reward, withdraw stakes with rewards depends of time", async function () {
      const { staking, owner, users, node } = await loadFixture(deployDistributorFixture);
      let resStakes = [];
      let resUnstakes = [];
      let unstaked,
        totalRewards = 0n,
        user = users[0];

      for (const i of Array(3).keys()) {
        resStakes.push(await makeStakeFor(staking, user, node, BASE_STAKE));
        await timeShiftBy(ethers, ONE_DAY);
      }

      await makeDistributeReward(staking, owner, [1], [BASE_STAKE]);

      for (const i of resStakes) {
        unstaked = await makeUnstake(staking, user, i.stakeId);
        await timeShiftBy(ethers, ONE_SECOND);

        resUnstakes.push(unstaked);
        totalRewards += unstaked.reward;
        expect(unstaked.amount).to.be.eq(BASE_STAKE);
      }

      expect(totalRewards).to.be.closeTo(BASE_STAKE, 1);
      for (let i = 0; i < resUnstakes.length - 1; i++) expect(resUnstakes[i].reward).gt(resUnstakes[i + 1].reward);
    });
    it("Get equal stakes from 3 stakers, second staker withdrawn, add reward, withdraw stakes with rewards", async function () {
      const { staking, azur, owner, users, node } = await loadFixture(deployDistributorFixture);
      let resStakes = [];
      let balancesGains = [];
      let totalRewards = 0n,
        gain;

      for (const i of users) {
        resStakes.push({ stake: await makeStakeFor(staking, i, node, BASE_STAKE), staker: i });
        await timeShiftBy(ethers, ONE_WEEK);
      }
      await timeShiftBy(ethers, ONE_DAY);

      // second staker withdraw
      expect((await makeUnstake(staking, resStakes[1].staker, resStakes[1].stake.stakeId)).amount).to.be.eq(BASE_STAKE);

      await makeDistributeReward(staking, owner, [1], [BASE_STAKE]);

      for (const i of resStakes) {
        // exclude second staker
        if (i.staker == resStakes[1].staker) continue;
        expect((await makeUnstake(staking, i.staker, i.stake.stakeId)).amount).to.be.eq(BASE_STAKE);

        gain = (await azur.balanceOf(i.staker.address)) - BASE_DEPO;
        balancesGains.push(gain);
        totalRewards += gain;
      }
      expect(await azur.balanceOf(resStakes[1].staker)).to.be.eq(BASE_DEPO);
      expect(totalRewards).to.be.closeTo(BASE_STAKE, 1);
      expect(balancesGains[0]).gt(balancesGains[1]);
    });
  });
});
