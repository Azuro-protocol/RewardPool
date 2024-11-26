const chai = require("chai");
const { loadFixture } = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { expect } = require("chai");

const { tokens, deployRewardPoolV2, timeShift, timeShiftBy, getTransactionTime } = require("../utils/utils");

const INIT_MINT = tokens(1000000);
const INIT_BALANCE = tokens(1000);
const DEPOSIT = tokens(100);
const WITHDRAWAL = DEPOSIT / 2n;
const ACCIDENTALLY_TRANSFERRED = tokens(50);

const ONE_DAY = 60 * 60 * 24;
const ONE_WEEK = ONE_DAY * 7;
const ONE_YEAR = ONE_DAY * 365;

const WITHDRAWAL_DELAY = ONE_WEEK;
const INCENTIVE_DURATION = ONE_YEAR;
const INCENTIVE_REWARD = tokens(10);


chai.Assertion.addMethod("closeToRelative", function (expected) {
  expected = BigInt(expected);
  const actual = BigInt(this._obj);
  this.assert(
    ((expected - actual) * BigInt(1e18)) / actual <= 1 && expected >= actual,
    "expected #{this} to be close to and to be less or equal than #{exp}",
    "expected #{this} to not be close to and to bet not greater than #{exp}",
    expected,
    actual,
  );
});

describe("Custom Chai Assertion: closeToRelative", function () {
  it("should pass when value is within negative relative tolerance", function () {
    expect(1e18).to.be.closeToRelative(BigInt(1e18) + 1n);
  });

  it("should fail when value is outside negative tolerance", function () {
    expect(1e18).to.not.closeToRelative(BigInt(1e18) + 10000000n);
  });

  it("should fail when value is within negative tolerance but greater than expected", function () {
    expect(1e18).to.be.not.closeToRelative(BigInt(1e18) - 1n);
    expect(1).to.be.not.closeToRelative(2);
  });
});

describe.only("RewardPool V2", function () {
  let azur,
    stAzur,
    owner,
    user,
    user2,
    user3,
    user4,
    ownerBalanceBefore,
    userBalanceBefore,
    user2BalanceBefore,
    user3BalanceBefore,
    user4BalanceBefore;

  const requestWithdrawal = async (account, value) => {
    const tx = await stAzur.connect(account).requestWithdrawal(value);
    const result = await tx.wait();
    return result.logs[1].args;
  };

  const updateStakingIncentive = async (reward, duration) => {
    const tx = await stAzur.connect(owner).updateStakingIncentive(reward, duration);
    return await getTransactionTime(ethers, tx);
  };

  const calculateAzurBalance = async (account) => {
    const stAzurBalance = await stAzur.balanceOf(account);
    return await rewardPoolV2.calculateWithdrawalAmount(stAzurBalance);
  };

  beforeEach(async function () {
    ({
      azur,
          stAzur,
      owner,
          user,
          user2,
          user3,
          user4,
          ownerBalanceBefore,
          userBalanceBefore,
          user2BalanceBefore,
          user3BalanceBefore,
          user4BalanceBefore,
    } = await loadFixture(deployFixture));
  });

  async function deployFixture() {
    const [owner, user, user2, user3, user4] = await ethers.getSigners();

    const AZUR = await ethers.getContractFactory("TestERC20", { signer: owner });
    const azur = await AZUR.deploy("AZUR", "AZUR", INIT_MINT);
    await azur.waitForDeployment();
    azur.address = await azur.getAddress();

    const stAzur = await deployRewardPoolV2(azur.address, owner, "Staked $AZUR", "stAZUR", WITHDRAWAL_DELAY);
    stAzur.address = await stAzur.getAddress();

    await azur.connect(owner).approve(stAzur.address, INIT_BALANCE);
    for (const account of [user, user2, user3, user4]) {
      await azur.connect(owner).transfer(account.address, INIT_BALANCE);
      await azur.connect(account).approve(stAzur.address, INIT_BALANCE);
    }

    const ownerBalanceBefore = await azur.balanceOf(owner.address);
    const userBalanceBefore = await azur.balanceOf(user.address);
    const user2BalanceBefore = await azur.balanceOf(user.address);
    const user3BalanceBefore = await azur.balanceOf(user.address);
    const user4BalanceBefore = await azur.balanceOf(user.address);

    return {
      azur,
      stAzur,
      owner,
      user,
      user2,
      user3,
      user4,
      ownerBalanceBefore,
      userBalanceBefore,
      user2BalanceBefore,
      user3BalanceBefore,
      user4BalanceBefore,
    };
  }

  context("Wrapper mechanics", function () {
    it("Should deposit via method call to the same account", async function () {
      await stAzur.connect(user).depositFor(user.address, DEPOSIT);
      expect(await azur.balanceOf(user.address)).to.be.equal(userBalanceBefore - DEPOSIT);
      expect(await stAzur.balanceOf(user.address)).to.be.equal(DEPOSIT);
    });
    it("Should deposit via method call to another account", async function () {
      await stAzur.connect(user).depositFor(owner.address, DEPOSIT);
      expect(await azur.balanceOf(owner.address)).to.be.equal(ownerBalanceBefore);
      expect(await stAzur.balanceOf(owner.address)).to.be.equal(DEPOSIT);
      expect(await azur.balanceOf(user.address)).to.be.equal(userBalanceBefore - DEPOSIT);
      expect(await stAzur.balanceOf(user.address)).to.be.equal(0);
    });
    it("Should perform a transfer", async function () {
      await stAzur.connect(user).depositFor(user.address, DEPOSIT);
      await stAzur.connect(user).transfer(owner.address, DEPOSIT);
      expect(await stAzur.balanceOf(owner.address)).to.be.equal(DEPOSIT);
      expect(await stAzur.balanceOf(user.address)).to.be.equal(0);
    });
    it("Should withdraw to the same account", async function () {
      await stAzur.connect(user).depositFor(user.address, DEPOSIT);
      const {requestId} = await requestWithdrawal( user, WITHDRAWAL);
      expect(await stAzur.balanceOf(user.address)).to.be.equal(DEPOSIT - WITHDRAWAL);
      expect(await azur.balanceOf(user.address)).to.be.equal(userBalanceBefore - DEPOSIT);

      await timeShiftBy(ethers, WITHDRAWAL_DELAY);
      await stAzur.connect(user).withdrawTo(user.address, requestId);
      expect(await stAzur.balanceOf(user.address)).to.be.equal(DEPOSIT - WITHDRAWAL);
      expect(await azur.balanceOf(user.address)).to.be.equal(userBalanceBefore - DEPOSIT + WITHDRAWAL);
    });
    it("Should withdraw to the same account by non-depositor", async function () {
      await stAzur.connect(user).depositFor(user.address, DEPOSIT);
      const {requestId} = await requestWithdrawal( user, WITHDRAWAL);

      await timeShiftBy(ethers, WITHDRAWAL_DELAY);
      await stAzur.connect(owner).withdrawTo(user.address, requestId);
      expect(await stAzur.balanceOf(user.address)).to.be.equal(DEPOSIT - WITHDRAWAL);
      expect(await azur.balanceOf(user.address)).to.be.equal(userBalanceBefore - DEPOSIT + WITHDRAWAL);
    });
    it("Should withdraw to a different account", async function () {
      await stAzur.connect(user).depositFor(user.address, DEPOSIT);
      const {requestId} = await requestWithdrawal( user, WITHDRAWAL);

      await timeShiftBy(ethers, WITHDRAWAL_DELAY);
      await stAzur.connect(user).withdrawTo(owner.address, requestId);
      expect(await stAzur.balanceOf(user.address)).to.be.equal(DEPOSIT - WITHDRAWAL);
      expect(await azur.balanceOf(owner.address)).to.be.equal(ownerBalanceBefore + WITHDRAWAL);
    });
    it("Should withdraw after transfer", async function () {
      await stAzur.connect(user).depositFor(user.address, DEPOSIT);
      await stAzur.connect(user).transfer(owner.address, WITHDRAWAL);
      const {requestId} = await requestWithdrawal( owner, WITHDRAWAL);

      await timeShiftBy(ethers, WITHDRAWAL_DELAY);
      await stAzur.connect(owner).withdrawTo(owner.address, requestId);
      expect(await stAzur.balanceOf(user.address)).to.be.equal(DEPOSIT - WITHDRAWAL);
      expect(await azur.balanceOf(owner.address)).to.be.equal(ownerBalanceBefore + WITHDRAWAL);
    });
    it("Should perform batch withdrawal to the same account", async function () {
      await stAzur.connect(user).depositFor(user.address, DEPOSIT);
      const requestId1 = (await requestWithdrawal( user, WITHDRAWAL)).requestId;
      const requestId2 = (await requestWithdrawal( user, DEPOSIT - WITHDRAWAL)).requestId;

      await timeShiftBy(ethers, WITHDRAWAL_DELAY);
      await stAzur.connect(user).batchWithdrawTo(user.address, [requestId1, requestId2]);
      expect(await stAzur.balanceOf(user.address)).to.be.equal(0);
      expect(await azur.balanceOf(user.address)).to.be.equal(userBalanceBefore);
    });
    it("Should perform batch withdrawal to a different account", async function () {
      await stAzur.connect(user).depositFor(user.address, DEPOSIT);
      const requestId1 = (await requestWithdrawal( user, WITHDRAWAL)).requestId;
      const requestId2 = (await requestWithdrawal( user, DEPOSIT - WITHDRAWAL)).requestId;

      await timeShiftBy(ethers, WITHDRAWAL_DELAY);
      await stAzur.connect(user).batchWithdrawTo(owner.address, [requestId1, requestId2]);
      expect(await stAzur.balanceOf(owner.address)).to.be.equal(0);
      expect(await azur.balanceOf(owner.address)).to.be.equal(ownerBalanceBefore + DEPOSIT);
    });
    it("Should change withdrawal delay", async function () {
      await stAzur.connect(user).depositFor(user.address, DEPOSIT);
      await stAzur.connect(owner).changeWithdrawalDelay(ONE_DAY);
      const {requestId} = await requestWithdrawal( user, WITHDRAWAL);

      await timeShiftBy(ethers, ONE_DAY);
      await stAzur.connect(user).withdrawTo(user.address, requestId);
      expect(await stAzur.balanceOf(user.address)).to.be.equal(DEPOSIT - WITHDRAWAL);
      expect(await azur.balanceOf(user.address)).to.be.equal(userBalanceBefore - DEPOSIT + WITHDRAWAL);
    });
    it("Should recover accidentally transferred funds", async function () {
      await azur.connect(user).transfer(stAzur.address, ACCIDENTALLY_TRANSFERRED);
      expect(await azur.balanceOf(user.address)).to.be.equal(userBalanceBefore - ACCIDENTALLY_TRANSFERRED);

      await stAzur.connect(owner).recover(owner.address);
      expect(await azur.balanceOf(owner.address)).to.be.equal(ownerBalanceBefore);
      expect(await stAzur.balanceOf(owner.address)).to.be.equal(ACCIDENTALLY_TRANSFERRED);
    });
    it("Should recover accidentally transferred funds with requested withdrawals", async function () {
      await stAzur.connect(user).depositFor(user.address, DEPOSIT);
      const {requestId} = await requestWithdrawal( user, WITHDRAWAL);

      await azur.connect(user).transfer(stAzur.address, ACCIDENTALLY_TRANSFERRED);
      expect(await azur.balanceOf(user.address)).to.be.equal(userBalanceBefore - DEPOSIT - ACCIDENTALLY_TRANSFERRED);

      await stAzur.connect(owner).recover(owner.address);
      expect(await azur.balanceOf(owner.address)).to.be.equal(ownerBalanceBefore);
      expect(await stAzur.balanceOf(owner.address)).to.be.equal(ACCIDENTALLY_TRANSFERRED);

      await timeShiftBy(ethers, WITHDRAWAL_DELAY);
      await stAzur.connect(user).withdrawTo(user.address, requestId);
      expect(await stAzur.balanceOf(user.address)).to.be.equal(DEPOSIT - WITHDRAWAL);
      expect(await azur.balanceOf(user.address)).to.be.equal(
        userBalanceBefore - DEPOSIT + WITHDRAWAL - ACCIDENTALLY_TRANSFERRED,
      );
    });
  });
  context.only("Staking Incentive", function () {
    it("Stake before the start of token distribution and unstake it after the end", async function () {
      await stAzur.connect(user).depositFor(user, DEPOSIT);
      await stAzur.connect(user).depositFor(user2, DEPOSIT);
      await stAzur.connect(user).depositFor(user3, DEPOSIT);

      await stAzur.connect(owner).updateStakingIncentive(INCENTIVE_REWARD, INCENTIVE_DURATION);
      expect(await azur.balanceOf(owner.address)).to.be.equal(ownerBalanceBefore - INCENTIVE_REWARD);

      await timeShiftBy(ethers, INCENTIVE_DURATION);

      for (const account of [user, user2, user3]) {
        expect(await calculateAzurBalance(account.address)).to.be.closeToRelative(
            DEPOSIT + INCENTIVE_REWARD / 3n,
        );
      }
    });
    it("Stake before the start of token distribution and unstake it a long time ago of the end", async function () {
      await stAzur.connect(user).depositFor(user, DEPOSIT);
      await stAzur.connect(owner).updateStakingIncentive(INCENTIVE_REWARD, INCENTIVE_DURATION);
      await timeShiftBy(ethers, ONE_YEAR * 5);

      expect(await calculateAzurBalance(user.address)).to.be.closeToRelative(
          DEPOSIT + INCENTIVE_REWARD
      );
    });
    it("Stake before the start of token distribution and claim reward before it ends", async function () {
      for (const account of [user, user2, user3]) {
        await stAzur.connect(account).depositFor(account, DEPOSIT);
      }

      const distributionStartedAt = await updateStakingIncentive(INCENTIVE_REWARD, INCENTIVE_DURATION);

      await timeShift(distributionStartedAt + INCENTIVE_DURATION / 3 - 1);

      const res1 = await requestWithdrawal(user, DEPOSIT);
      expect(res1.withdrawalAmount).to.be.closeToRelative(DEPOSIT + INCENTIVE_REWARD / 9n);

      await timeShift(distributionStartedAt + (INCENTIVE_DURATION * 2) / 3 - 1);
      const res2 = await requestWithdrawal(user2, DEPOSIT);
      expect(res2.withdrawalAmount).to.be.closeToRelative(
          DEPOSIT + (INCENTIVE_REWARD * 5n) / 18n,
      );

      await timeShift(distributionStartedAt + INCENTIVE_DURATION);
      const res3 = await requestWithdrawal(user3, DEPOSIT);
      expect(res3.withdrawalAmount).to.be.closeToRelative(
          DEPOSIT + (INCENTIVE_REWARD * 11n) / 18n,
      );

      for (const account of [user, user2, user3]) {
        await expect(requestWithdrawal(account, 1)).to.be.revertedWithCustomError(stAzur, "ERC20InsufficientBalance");
      }
    });
    it.only("Stake after the start of token distribution and claim reward after it ends", async function () {
      await stAzur.connect(user).depositFor(user, DEPOSIT);

      const distributionStartedAt = await updateStakingIncentive(INCENTIVE_REWARD, INCENTIVE_DURATION);

      await timeShiftBy(ethers,distributionStartedAt + INCENTIVE_DURATION / 3 - 1);
      await stAzur.connect(user).depositFor(user2, DEPOSIT);

      await timeShiftBy(ethers,distributionStartedAt + (INCENTIVE_DURATION * 2) / 3 - 1);
      await stAzur.connect(user).depositFor(user3, DEPOSIT);

      await timeShiftBy(ethers,distributionStartedAt + INCENTIVE_DURATION);

      await unstake(user, stakeId);
      await stAzur.claimRewards(user.address);
      expect(await azur.balanceOf(user.address)).to.be.closeToRelative(
          userBalanceBefore + (INCENTIVE_REWARD * 11n) / 18n,
      );

      await unstake(user2, stakeId2);
      await stAzur.claimRewards(user2.address);
      expect(await azur.balanceOf(user2.address)).to.be.closeToRelative(
          user2BalanceBefore + (INCENTIVE_REWARD * 5n) / 18n,
      );

      await unstake(user3, stakeId3);
      await stAzur.claimRewards(user3.address);
      expect(await azur.balanceOf(user3.address)).to.be.closeToRelative(user3BalanceBefore + INCENTIVE_REWARD / 9n);

      await expect(stAzur.claimRewards(user.address)).to.be.revertedWithCustomError(stAzur, "NoUnclaimedRewards");
      await expect(stAzur.claimRewards(user2.address)).to.be.revertedWithCustomError(stAzur, "NoUnclaimedRewards");
      await expect(stAzur.claimRewards(user3.address)).to.be.revertedWithCustomError(stAzur, "NoUnclaimedRewards");
    });
    it("Stake after the start of token distribution and unstake it before the end", async function () {
      await stAzur.connect(user).depositFor(owner, 1);
      const distributionStartedAt = await stAzur.connect(owner).updateStakingIncentive(INCENTIVE_REWARD, INCENTIVE_DURATION);

      await timeShiftBy(ethers,distributionStartedAt + INCENTIVE_DURATION / 3 - 1);
      const stakeId = await stAzur.connect(user).depositFor(user, DEPOSIT);

      await timeShiftBy(ethers,distributionStartedAt + (INCENTIVE_DURATION * 2) / 3 - 1);
      await unstake(user, stakeId);
      await stAzur.claimRewards(user.address);
      expect(await azur.balanceOf(user.address)).to.be.closeToRelative(userBalanceBefore + INCENTIVE_REWARD / 3n);

      await timeShiftBy(ethers,distributionStartedAt + INCENTIVE_DURATION);
      await expect(stAzur.claimRewards(user.address)).to.be.revertedWithCustomError(stAzur, "NoUnclaimedRewards");
    });
    it("Stake different stakes after the start of token distribution and unstake it after the end", async function () {
      const stakeId = await stAzur.connect(user).depositFor(user, DEPOSIT);

      const distributionStartedAt = await stAzur.connect(owner).updateStakingIncentive(INCENTIVE_REWARD, INCENTIVE_DURATION);

      await timeShiftBy(ethers,distributionStartedAt + INCENTIVE_DURATION / 3 - 1);
      const stakeId2 = await stAzur.connect(user).depositFor(user2, DEPOSIT * 2n);

      await timeShiftBy(ethers,distributionStartedAt + (INCENTIVE_DURATION * 2) / 3 - 1);
      const stakeId3 = await stAzur.connect(user).depositFor(user3, DEPOSIT * 3n);

      await timeShiftBy(ethers,distributionStartedAt + INCENTIVE_DURATION);

      await unstake(user, stakeId);
      await stAzur.claimRewards(user.address);
      expect(await azur.balanceOf(user.address)).to.be.closeToRelative(userBalanceBefore + INCENTIVE_REWARD / 2n);

      await unstake(user2, stakeId2);
      await stAzur.claimRewards(user2.address);
      expect(await azur.balanceOf(user2.address)).to.be.closeToRelative(user2BalanceBefore + INCENTIVE_REWARD / 3n);

      await unstake(user3, stakeId3);
      await stAzur.claimRewards(user3.address);
      expect(await azur.balanceOf(user3.address)).to.be.closeToRelative(user3BalanceBefore + INCENTIVE_REWARD / 6n);

      await expect(stAzur.claimRewards(user.address)).to.be.revertedWithCustomError(stAzur, "NoUnclaimedRewards");
      await expect(stAzur.claimRewards(user2.address)).to.be.revertedWithCustomError(stAzur, "NoUnclaimedRewards");
      await expect(stAzur.claimRewards(user3.address)).to.be.revertedWithCustomError(stAzur, "NoUnclaimedRewards");
    });
    it("Stake different stakes by one staker after the start of token distribution and unstake it after the end", async function () {
      const stakeId = await stAzur.connect(user).depositFor(user, DEPOSIT);
      const distributionStartedAt = await stAzur.connect(owner).updateStakingIncentive(INCENTIVE_REWARD, INCENTIVE_DURATION);

      await timeShiftBy(ethers,distributionStartedAt + INCENTIVE_DURATION / 3 - 1);
      const stakeId2 = await stAzur.connect(user).depositFor(user, DEPOSIT * 2n);

      await timeShiftBy(ethers,distributionStartedAt + (INCENTIVE_DURATION * 2) / 3 - 1);
      const stakeId3 = await stAzur.connect(user).depositFor(user, DEPOSIT * 3n);

      await timeShiftBy(ethers,distributionStartedAt + INCENTIVE_DURATION);
      for (const stakeId_ of [stakeId, stakeId2, stakeId3]) {
        await unstake(user, stakeId_);
      }

      await stAzur.claimRewards(user.address);
      expect(await azur.balanceOf(user.address)).to.be.closeToRelative(userBalanceBefore + INCENTIVE_REWARD);

      await expect(stAzur.claimRewards(user.address)).to.be.revertedWithCustomError(stAzur, "NoUnclaimedRewards");
    });
    it("Update incentive in bounds of previous incentive", async function () {
      const stakeId = await stAzur.connect(user).depositFor(user, DEPOSIT);
      const stakeId2 = await stAzur.connect(user).depositFor(user2, DEPOSIT);
      const stakeId3 = await stAzur.connect(user).depositFor(user3, DEPOSIT);
      const stakeId4 = await stAzur.connect(user).depositFor(user4, DEPOSIT);

      const distributionStartedAt = await stAzur.connect(owner).updateStakingIncentive(INCENTIVE_REWARD, INCENTIVE_DURATION);

      await timeShiftBy(ethers,distributionStartedAt + INCENTIVE_DURATION / 4 - 1);
      await unstake(user, stakeId);

      await timeShiftBy(ethers,distributionStartedAt + INCENTIVE_DURATION / 2 - 1);
      await stAzur.connect(owner).updateStakingIncentive(INCENTIVE_REWARD / 2n, INCENTIVE_DURATION / 2);
      expect(await azur.balanceOf(owner.address)).to.be.equal(ownerBalanceBefore - (INCENTIVE_REWARD * 3n) / 2n);
      await unstake(user2, stakeId2);

      await timeShiftBy(ethers,distributionStartedAt + (INCENTIVE_DURATION * 3) / 4 - 1);
      await unstake(user3, stakeId3);

      await timeShiftBy(ethers,distributionStartedAt + INCENTIVE_DURATION - 1);
      await unstake(user4, stakeId4);

      await stAzur.claimRewards(user.address);
      expect(await azur.balanceOf(user.address)).to.be.closeToRelative(userBalanceBefore + INCENTIVE_REWARD / 16n);

      await stAzur.claimRewards(user2.address);

      /*
      2113986132067 - the reward amount for one second of stAzur.
      The unstake transaction will be created one second after changing the incentive reward.
      */
      const user2RewardForOneSecond = 2113986132067n;
      expect(await azur.balanceOf(user2.address)).to.be.closeToRelative(
          user2BalanceBefore + (INCENTIVE_REWARD * 7n) / 48n + user2RewardForOneSecond,
      );

      await stAzur.claimRewards(user3.address);
      expect(await azur.balanceOf(user3.address)).to.be.closeToRelative(
          user3BalanceBefore + (INCENTIVE_REWARD * 19n) / 48n - user2RewardForOneSecond / 2n,
      );

      await stAzur.claimRewards(user4.address);
      expect(await azur.balanceOf(user4.address)).to.be.closeToRelative(
          user4BalanceBefore + (INCENTIVE_REWARD * 43n) / 48n - user2RewardForOneSecond / 2n,
      );

      await expect(stAzur.claimRewards(user.address)).to.be.revertedWithCustomError(stAzur, "NoUnclaimedRewards");
      await expect(stAzur.claimRewards(user2.address)).to.be.revertedWithCustomError(stAzur, "NoUnclaimedRewards");
      await expect(stAzur.claimRewards(user3.address)).to.be.revertedWithCustomError(stAzur, "NoUnclaimedRewards");
      await expect(stAzur.claimRewards(user4.address)).to.be.revertedWithCustomError(stAzur, "NoUnclaimedRewards");
    });
    it("Update incentive out of bounds of previous incentive", async function () {
      const stakeId = await stAzur.connect(user).depositFor(user, DEPOSIT);
      const stakeId2 = await stAzur.connect(user).depositFor(user2, DEPOSIT);
      const stakeId3 = await stAzur.connect(user).depositFor(user3, DEPOSIT);
      const stakeId4 = await stAzur.connect(user).depositFor(user4, DEPOSIT);

      const distributionStartedAt = await stAzur.connect(owner).updateStakingIncentive(INCENTIVE_REWARD, INCENTIVE_DURATION);

      await timeShiftBy(ethers,distributionStartedAt + INCENTIVE_DURATION / 4 - 1);
      await unstake(user, stakeId);

      await timeShiftBy(ethers,distributionStartedAt + INCENTIVE_DURATION / 2 - 1);
      await stAzur.connect(owner).updateStakingIncentive(INCENTIVE_REWARD, INCENTIVE_DURATION);

      await timeShiftBy(ethers,distributionStartedAt + (INCENTIVE_DURATION * 3) / 4 - 1);
      await unstake(user2, stakeId2);

      await timeShiftBy(ethers,distributionStartedAt + INCENTIVE_DURATION - 1);
      await unstake(user3, stakeId3);

      await timeShiftBy(ethers,distributionStartedAt + (INCENTIVE_DURATION * 3) / 2 - 1);
      await unstake(user4, stakeId4);

      await stAzur.claimRewards(user.address);
      expect(await azur.balanceOf(user.address)).to.be.closeToRelative(userBalanceBefore + INCENTIVE_REWARD / 16n);

      await stAzur.claimRewards(user2.address);

      expect(await azur.balanceOf(user2.address)).to.be.closeToRelative(
          user2BalanceBefore + (INCENTIVE_REWARD * 13n) / 48n,
      );

      await stAzur.claimRewards(user3.address);
      expect(await azur.balanceOf(user3.address)).to.be.closeToRelative(
          user3BalanceBefore + (INCENTIVE_REWARD * 22n) / 48n,
      );

      await stAzur.claimRewards(user4.address);
      expect(await azur.balanceOf(user4.address)).to.be.closeToRelative(
          user4BalanceBefore + (INCENTIVE_REWARD * 58n) / 48n,
      );

      await expect(stAzur.claimRewards(user.address)).to.be.revertedWithCustomError(stAzur, "NoUnclaimedRewards");
      await expect(stAzur.claimRewards(user2.address)).to.be.revertedWithCustomError(stAzur, "NoUnclaimedRewards");
      await expect(stAzur.claimRewards(user3.address)).to.be.revertedWithCustomError(stAzur, "NoUnclaimedRewards");
      await expect(stAzur.claimRewards(user4.address)).to.be.revertedWithCustomError(stAzur, "NoUnclaimedRewards");
    });
  });
  context("Check restrictions", function () {
    it("Should not allow withdrawal to another account by non-depositor", async function () {
      await stAzur.connect(user).depositFor(user.address, DEPOSIT);
      const {requestId} = await requestWithdrawal( user, WITHDRAWAL);

      await timeShiftBy(ethers, WITHDRAWAL_DELAY);
      await expect(stAzur.connect(owner).withdrawTo(owner.address, requestId)).to.be.revertedWithCustomError(
        stAzur,
        "OnlyRequesterCanWithdrawToAnotherAddress",
      );
    });
    it("Should not allow batch to another account by non-depositor", async function () {
      await stAzur.connect(user).depositFor(user.address, DEPOSIT);
      await stAzur.connect(user).depositFor(owner.address, DEPOSIT);
      const requestId1 = (await requestWithdrawal( user, WITHDRAWAL)).requestId;
      const requestId2 = (await requestWithdrawal( owner, WITHDRAWAL)).requestId;

      await timeShiftBy(ethers, WITHDRAWAL_DELAY);
      await expect(
        stAzur.connect(owner).batchWithdrawTo(owner.address, [requestId1, requestId2]),
      ).to.be.revertedWithCustomError(stAzur, "OnlyRequesterCanWithdrawToAnotherAddress");
      await expect(
        stAzur.connect(user).batchWithdrawTo(user.address, [requestId1, requestId2]),
      ).to.be.revertedWithCustomError(stAzur, "OnlyRequesterCanWithdrawToAnotherAddress");
    });
    it("Should not allow withdrawal with a non-existent request", async function () {
      await expect(stAzur.connect(user).withdrawTo(owner.address, 1234)).to.be.revertedWithCustomError(
        stAzur,
        "RequestDoesNotExist",
      );
    });
    it("Should not allow withdrawal with an already executed request", async function () {
      await stAzur.connect(user).depositFor(user.address, DEPOSIT);
      const {requestId} = await requestWithdrawal( user, WITHDRAWAL);

      await timeShiftBy(ethers, WITHDRAWAL_DELAY);
      await stAzur.connect(user).withdrawTo(user.address, requestId);
      await expect(stAzur.connect(user).withdrawTo(user.address, requestId)).to.be.revertedWithCustomError(
        stAzur,
        "RequestDoesNotExist",
      );
    });
    it("Should not allow withdrawal before timeout has passed", async function () {
      await stAzur.connect(user).depositFor(user.address, DEPOSIT);
      const {requestId} = await requestWithdrawal( user, WITHDRAWAL);

      await timeShiftBy(ethers, WITHDRAWAL_DELAY - 10);
      await expect(stAzur.connect(user).withdrawTo(user.address, requestId)).to.be.revertedWithCustomError(
        stAzur,
        "WithdrawalLocked",
      );
    });
    it("Should not allow deposit with insufficient funds", async function () {
      const incorrectDeposit = userBalanceBefore + 1n;
      await azur.connect(user).approve(stAzur.address, incorrectDeposit);
      await expect(stAzur.connect(user).depositFor(user.address, incorrectDeposit)).to.be.revertedWithCustomError(
        stAzur,
        "ERC20InsufficientBalance",
      );
    });
    it("Should not allow request zero value", async function () {
      await stAzur.connect(user).depositFor(user.address, DEPOSIT);
      await expect(requestWithdrawal( user, 0)).to.be.revertedWithCustomError(stAzur, "ZeroAmount");
    });
    it("Should not allow request a fund amount exceeding the balance", async function () {
      await stAzur.connect(user).depositFor(user.address, DEPOSIT + 1n);
      await expect(requestWithdrawal( user, 0)).to.be.revertedWithCustomError(stAzur, "ZeroAmount");
    });
    it("Should not change withdrawal delay for already requested withdrawals", async function () {
      await stAzur.connect(user).depositFor(user.address, DEPOSIT);
      const {requestId} = await requestWithdrawal( user, WITHDRAWAL);
      await stAzur.connect(owner).changeWithdrawalDelay(0);

      await expect(stAzur.connect(user).withdrawTo(user.address, requestId)).to.be.revertedWithCustomError(
        stAzur,
        "WithdrawalLocked",
      );
    });
    it("Reward is zero", async function () {
      await stAzur.connect(user).depositFor(owner, DEPOSIT);
      await expect(stAzur.updateStakingIncentive(0, 100)).to.be.revertedWithCustomError(stAzur, "RewardCanNotBeZero");
    });
    it("Only the owner can change the withdrawal delay", async function () {
      await expect(stAzur.connect(user).changeWithdrawalDelay(ONE_DAY)).to.be.revertedWithCustomError(
        stAzur,
        "OwnableUnauthorizedAccount",
      );
    });
    it("Only the owner can recover funds", async function () {
      await expect(stAzur.connect(user).recover(user.address)).to.be.revertedWithCustomError(
        stAzur,
        "OwnableUnauthorizedAccount",
      );
    });
    it("Not-owner calls restricted functions", async function () {
      await expect(stAzur.connect(user).changeMinStake(123)).to.be.revertedWithCustomError(
          stAzur,
          "OwnableUnauthorizedAccount",
      );
      await expect(stAzur.connect(user).changeUnstakingTimeout(123)).to.be.revertedWithCustomError(
          stAzur,
          "OwnableUnauthorizedAccount",
      );
      await expect(stAzur.connect(user).updateStakingIncentive(123, 456)).to.be.revertedWithCustomError(
          stAzur,
          "OwnableUnauthorizedAccount",
      );
      await expect(stAzur.connect(user).recoverERC20(azur.address, 1)).to.be.revertedWithCustomError(
          stAzur,
          "OwnableUnauthorizedAccount",
      );
    });
    it("Incentive duration is out of allowed range", async function () {
      await stAzur.connect(user).depositFor(owner, DEPOSIT);
      await expect(stAzur.updateStakingIncentive(1000, 0)).to.be.revertedWithCustomError(
          stAzur,
          "InvalidIncentiveDuration",
      );
      await expect(stAzur.updateStakingIncentive(1000, ONE_YEAR * 3 + 1)).to.be.revertedWithCustomError(
          stAzur,
          "InvalidIncentiveDuration",
      );
    });
    it("The owner tries to withdraw the stAzur token", async function () {
      await expect(stAzur.connect(owner).recoverERC20(azur, 1)).to.be.revertedWithCustomError(
          stAzur,
          "CanNotRecoverStakingToken",
      );
    });
    it("The owner tries to withdraw zero amount of token", async function () {
      await expect(stAzur.connect(owner).recoverERC20(azur, 0)).to.be.revertedWithCustomError(
          stAzur,
          "AmountCanNotBeZero",
      );
    });
    it("There are no active stakes", async function () {
      await expect(stAzur.connect(owner).updateStakingIncentive(123, 456)).to.be.revertedWithCustomError(
          stAzur,
          "NoActiveStakes",
      );
    });
    it("There are no unclaimed rewards for user", async function () {
      await expect(stAzur.claimRewards(user.address)).to.be.revertedWithCustomError(stAzur, "NoUnclaimedRewards");
    });
  });
});
