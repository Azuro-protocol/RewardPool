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

chai.Assertion.addMethod("closeToRelative", function (expected, threshold = 1) {
  expected = BigInt(expected);
  const actual = BigInt(this._obj);
  this.assert(
    ((expected - actual) * BigInt(1e18)) / actual <= threshold && expected >= actual,
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

describe("RewardPool V2", function () {
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

  const depositFor = async (account, value) => {
    const balanceBefore = await stAzur.balanceOf(account.address);
    await stAzur.connect(account).depositFor(account.address, value);
    return (await stAzur.balanceOf(account.address)) - balanceBefore;
  };

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
    return await stAzur.calculateWithdrawalAmount(stAzurBalance);
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
      await depositFor(user, DEPOSIT);
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
      await depositFor(user, DEPOSIT);
      await stAzur.connect(user).transfer(owner.address, DEPOSIT);
      expect(await stAzur.balanceOf(owner.address)).to.be.equal(DEPOSIT);
      expect(await stAzur.balanceOf(user.address)).to.be.equal(0);
    });
    it("Should withdraw to the same account", async function () {
      await depositFor(user, DEPOSIT);
      const { requestId } = await requestWithdrawal(user, WITHDRAWAL);
      expect(await stAzur.balanceOf(user.address)).to.be.equal(DEPOSIT - WITHDRAWAL);
      expect(await azur.balanceOf(user.address)).to.be.equal(userBalanceBefore - DEPOSIT);

      await timeShiftBy(ethers, WITHDRAWAL_DELAY);
      await stAzur.connect(user).withdrawTo(user.address, requestId);
      expect(await stAzur.balanceOf(user.address)).to.be.equal(DEPOSIT - WITHDRAWAL);
      expect(await azur.balanceOf(user.address)).to.be.equal(userBalanceBefore - DEPOSIT + WITHDRAWAL);
    });
    it("Should withdraw to the same account by non-depositor", async function () {
      await depositFor(user, DEPOSIT);
      const { requestId } = await requestWithdrawal(user, WITHDRAWAL);

      await timeShiftBy(ethers, WITHDRAWAL_DELAY);
      await stAzur.connect(owner).withdrawTo(user.address, requestId);
      expect(await stAzur.balanceOf(user.address)).to.be.equal(DEPOSIT - WITHDRAWAL);
      expect(await azur.balanceOf(user.address)).to.be.equal(userBalanceBefore - DEPOSIT + WITHDRAWAL);
    });
    it("Should withdraw to a different account", async function () {
      await depositFor(user, DEPOSIT);
      const { requestId } = await requestWithdrawal(user, WITHDRAWAL);

      await timeShiftBy(ethers, WITHDRAWAL_DELAY);
      await stAzur.connect(user).withdrawTo(owner.address, requestId);
      expect(await stAzur.balanceOf(user.address)).to.be.equal(DEPOSIT - WITHDRAWAL);
      expect(await azur.balanceOf(owner.address)).to.be.equal(ownerBalanceBefore + WITHDRAWAL);
    });
    it("Should withdraw after transfer", async function () {
      await depositFor(user, DEPOSIT);
      await stAzur.connect(user).transfer(owner.address, WITHDRAWAL);
      const { requestId } = await requestWithdrawal(owner, WITHDRAWAL);

      await timeShiftBy(ethers, WITHDRAWAL_DELAY);
      await stAzur.connect(owner).withdrawTo(owner.address, requestId);
      expect(await stAzur.balanceOf(user.address)).to.be.equal(DEPOSIT - WITHDRAWAL);
      expect(await azur.balanceOf(owner.address)).to.be.equal(ownerBalanceBefore + WITHDRAWAL);
    });
    it("Should perform batch withdrawal to the same account", async function () {
      await depositFor(user, DEPOSIT);
      const requestId1 = (await requestWithdrawal(user, WITHDRAWAL)).requestId;
      const requestId2 = (await requestWithdrawal(user, DEPOSIT - WITHDRAWAL)).requestId;

      await timeShiftBy(ethers, WITHDRAWAL_DELAY);
      await stAzur.connect(user).batchWithdrawTo(user.address, [requestId1, requestId2]);
      expect(await stAzur.balanceOf(user.address)).to.be.equal(0);
      expect(await azur.balanceOf(user.address)).to.be.equal(userBalanceBefore);
    });
    it("Should perform batch withdrawal to a different account", async function () {
      await depositFor(user, DEPOSIT);
      const requestId1 = (await requestWithdrawal(user, WITHDRAWAL)).requestId;
      const requestId2 = (await requestWithdrawal(user, DEPOSIT - WITHDRAWAL)).requestId;

      await timeShiftBy(ethers, WITHDRAWAL_DELAY);
      await stAzur.connect(user).batchWithdrawTo(owner.address, [requestId1, requestId2]);
      expect(await stAzur.balanceOf(owner.address)).to.be.equal(0);
      expect(await azur.balanceOf(owner.address)).to.be.equal(ownerBalanceBefore + DEPOSIT);
    });
    it("Should change withdrawal delay", async function () {
      await depositFor(user, DEPOSIT);
      await stAzur.connect(owner).changeWithdrawalDelay(ONE_DAY);
      const { requestId } = await requestWithdrawal(user, WITHDRAWAL);

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
      await depositFor(user, DEPOSIT);
      const { requestId } = await requestWithdrawal(user, WITHDRAWAL);

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
  context("Staking Incentive", function () {
    it("Stake before the start of the incentive program and unstake it after the end", async function () {
      await depositFor(user, DEPOSIT);
      await depositFor(user2, DEPOSIT);
      await depositFor(user3, DEPOSIT);

      await updateStakingIncentive(INCENTIVE_REWARD, INCENTIVE_DURATION);
      expect(await azur.balanceOf(owner.address)).to.be.equal(ownerBalanceBefore - INCENTIVE_REWARD);

      await timeShiftBy(ethers, INCENTIVE_DURATION);

      for (const account of [user, user2, user3]) {
        expect(await calculateAzurBalance(account.address)).to.be.closeToRelative(DEPOSIT + INCENTIVE_REWARD / 3n);
      }
    });
    it("Stake before the start of the incentive program and unstake it a long time ago of the end", async function () {
      await depositFor(user, DEPOSIT);
      await updateStakingIncentive(INCENTIVE_REWARD, INCENTIVE_DURATION);
      await timeShiftBy(ethers, ONE_YEAR * 5);

      expect(await calculateAzurBalance(user.address)).to.be.closeToRelative(DEPOSIT + INCENTIVE_REWARD);
    });
    it("Stake before the start of the incentive program and claim reward before it ends", async function () {
      for (const account of [user, user2, user3]) {
        await depositFor(account, DEPOSIT);
      }

      const distributionStartedAt = await updateStakingIncentive(INCENTIVE_REWARD, INCENTIVE_DURATION);

      await timeShift(distributionStartedAt + INCENTIVE_DURATION / 3 - 1);

      const res1 = await requestWithdrawal(user, DEPOSIT);
      expect(res1.withdrawalAmount).to.be.closeToRelative(DEPOSIT + INCENTIVE_REWARD / 9n);

      await timeShift(distributionStartedAt + (INCENTIVE_DURATION * 2) / 3 - 1);
      const res2 = await requestWithdrawal(user2, DEPOSIT);
      expect(res2.withdrawalAmount).to.be.closeToRelative(DEPOSIT + (INCENTIVE_REWARD * 5n) / 18n);

      await timeShift(distributionStartedAt + INCENTIVE_DURATION);
      const res3 = await requestWithdrawal(user3, DEPOSIT);
      expect(res3.withdrawalAmount).to.be.closeToRelative(DEPOSIT + (INCENTIVE_REWARD * 11n) / 18n);

      for (const account of [user, user2, user3]) {
        await expect(requestWithdrawal(account, 1)).to.be.revertedWithCustomError(stAzur, "ERC20InsufficientBalance");
      }
    });
    it("Stake after the start of the incentive program and claim reward after it ends", async function () {
      const stAzurBalance1 = await depositFor(user, DEPOSIT);

      const distributionStartedAt = await updateStakingIncentive(INCENTIVE_REWARD, INCENTIVE_DURATION);

      await timeShift(distributionStartedAt + INCENTIVE_DURATION / 3 - 1);
      const stAzurBalance2 = await depositFor(user2, DEPOSIT);

      await timeShift(distributionStartedAt + (INCENTIVE_DURATION * 2) / 3 - 1);
      const stAzurBalance3 = await depositFor(user3, DEPOSIT);

      await timeShift(distributionStartedAt + INCENTIVE_DURATION);

      const res1 = await requestWithdrawal(user, stAzurBalance1);
      expect(res1.withdrawalAmount).to.be.closeToRelative(
        DEPOSIT +
          INCENTIVE_REWARD / 3n +
          ((INCENTIVE_REWARD / 3n) * stAzurBalance1) / (stAzurBalance1 + stAzurBalance2) +
          ((INCENTIVE_REWARD / 3n) * stAzurBalance1) / (stAzurBalance1 + stAzurBalance2 + stAzurBalance3),
      );

      const res2 = await requestWithdrawal(user2, stAzurBalance2);
      expect(res2.withdrawalAmount).to.be.closeToRelative(
        DEPOSIT +
          ((INCENTIVE_REWARD / 3n) * stAzurBalance2) / (stAzurBalance1 + stAzurBalance2) +
          ((INCENTIVE_REWARD / 3n) * stAzurBalance2) / (stAzurBalance1 + stAzurBalance2 + stAzurBalance3),
      );

      const res3 = await requestWithdrawal(user3, stAzurBalance3);
      expect(res3.withdrawalAmount).to.be.closeToRelative(
        DEPOSIT + ((INCENTIVE_REWARD / 3n) * stAzurBalance3) / (stAzurBalance1 + stAzurBalance2 + stAzurBalance3),
      );
    });
    it("Stake after the start of the incentive program and unstake it before the end", async function () {
      const distributionStartedAt = await updateStakingIncentive(INCENTIVE_REWARD, INCENTIVE_DURATION);

      await timeShift(distributionStartedAt + INCENTIVE_DURATION / 3 - 1);
      await depositFor(user, DEPOSIT);

      await timeShift(distributionStartedAt + (INCENTIVE_DURATION * 2) / 3 - 1);
      const res1 = await requestWithdrawal(user, DEPOSIT);
      expect(res1.withdrawalAmount).to.be.closeToRelative(DEPOSIT + INCENTIVE_REWARD / 3n);
    });
    it("Stake different stakes after the start of the incentive program and unstake it after the end", async function () {
      const stAzurBalance1 = await depositFor(user, DEPOSIT);

      const distributionStartedAt = await updateStakingIncentive(INCENTIVE_REWARD, INCENTIVE_DURATION);

      await timeShift(distributionStartedAt + INCENTIVE_DURATION / 3 - 1);
      const stAzurBalance2 = await depositFor(user2, DEPOSIT * 2n);

      await timeShift(distributionStartedAt + (INCENTIVE_DURATION * 2) / 3 - 1);
      const stAzurBalance3 = await depositFor(user3, DEPOSIT * 3n);

      await timeShift(distributionStartedAt + INCENTIVE_DURATION);

      const res1 = await requestWithdrawal(user, stAzurBalance1);
      expect(res1.withdrawalAmount).to.be.closeToRelative(
        DEPOSIT +
          INCENTIVE_REWARD / 3n +
          ((INCENTIVE_REWARD / 3n) * stAzurBalance1) / (stAzurBalance1 + stAzurBalance2) +
          ((INCENTIVE_REWARD / 3n) * stAzurBalance1) / (stAzurBalance1 + stAzurBalance2 + stAzurBalance3),
      );

      const res2 = await requestWithdrawal(user2, stAzurBalance2);
      expect(res2.withdrawalAmount).to.be.closeToRelative(
        DEPOSIT * 2n +
          ((INCENTIVE_REWARD / 3n) * stAzurBalance2) / (stAzurBalance1 + stAzurBalance2) +
          ((INCENTIVE_REWARD / 3n) * stAzurBalance2) / (stAzurBalance1 + stAzurBalance2 + stAzurBalance3),
      );

      const res3 = await requestWithdrawal(user3, stAzurBalance3);
      expect(res3.withdrawalAmount).to.be.closeToRelative(
        DEPOSIT * 3n + ((INCENTIVE_REWARD / 3n) * stAzurBalance3) / (stAzurBalance1 + stAzurBalance2 + stAzurBalance3),
      );
    });
    it("Stake different stakes by one staker after the start of the incentive program and unstake it after the end", async function () {
      let stAzurBalance = await depositFor(user, DEPOSIT);
      const distributionStartedAt = await updateStakingIncentive(INCENTIVE_REWARD, INCENTIVE_DURATION);

      await timeShift(distributionStartedAt + INCENTIVE_DURATION / 3 - 1);
      stAzurBalance += await depositFor(user, DEPOSIT * 2n);

      await timeShift(distributionStartedAt + (INCENTIVE_DURATION * 2) / 3 - 1);
      stAzurBalance += await depositFor(user, DEPOSIT * 3n);

      await timeShift(distributionStartedAt + INCENTIVE_DURATION);
      const res1 = await requestWithdrawal(user, stAzurBalance);
      expect(res1.withdrawalAmount).to.be.closeToRelative(DEPOSIT * 6n + INCENTIVE_REWARD);
    });
    it("Update incentive in bounds of previous incentive", async function () {
      await depositFor(user, DEPOSIT * 3n);
      for (const account of [user2, user3]) {
        await stAzur.connect(user).transfer(account.address, DEPOSIT);
      }

      const distributionStartedAt = await updateStakingIncentive(INCENTIVE_REWARD, INCENTIVE_DURATION);

      await timeShift(distributionStartedAt + INCENTIVE_DURATION / 4 - 1);
      const res1 = await requestWithdrawal(user, DEPOSIT);
      expect(res1.withdrawalAmount).to.be.closeToRelative(DEPOSIT + INCENTIVE_REWARD / 12n);

      await timeShift(distributionStartedAt + INCENTIVE_DURATION / 2 - 1);
      await updateStakingIncentive(INCENTIVE_REWARD / 2n, INCENTIVE_DURATION / 2);

      /*
      317097919667 - the reward amount for one second of staking.
      The unstake transaction will be created one second after updating the incentive program.
      */
      const user2RewardForOneSecond = 317097919667n;
      const res2 = await requestWithdrawal(user2, DEPOSIT);
      expect(res2.withdrawalAmount).to.be.closeToRelative(
        DEPOSIT + INCENTIVE_REWARD / 12n + INCENTIVE_REWARD / 8n + user2RewardForOneSecond,
      );

      await timeShift(distributionStartedAt + INCENTIVE_DURATION);
      const res3 = await requestWithdrawal(user3, DEPOSIT);
      expect(res3.withdrawalAmount).to.be.closeToRelative(
        DEPOSIT + INCENTIVE_REWARD / 12n + INCENTIVE_REWARD / 8n + INCENTIVE_REWARD - user2RewardForOneSecond,
        10,
      );
    });
    it("Update incentive out of bounds of previous incentive", async function () {
      await depositFor(user, DEPOSIT * 4n);
      for (const account of [user2, user3, user4]) {
        await stAzur.connect(user).transfer(account.address, DEPOSIT);
      }

      let distributionStartedAt = await updateStakingIncentive(INCENTIVE_REWARD, INCENTIVE_DURATION);

      await timeShift(distributionStartedAt + INCENTIVE_DURATION / 2 - 1);
      const res1 = await requestWithdrawal(user, DEPOSIT);
      expect(res1.withdrawalAmount).to.be.closeToRelative(DEPOSIT + INCENTIVE_REWARD / 8n);

      await timeShift(distributionStartedAt + INCENTIVE_DURATION);

      const res2 = await requestWithdrawal(user2, DEPOSIT);
      expect(res2.withdrawalAmount).to.be.closeToRelative(DEPOSIT + INCENTIVE_REWARD / 8n + INCENTIVE_REWARD / 6n);

      distributionStartedAt = await updateStakingIncentive(INCENTIVE_REWARD, INCENTIVE_DURATION);

      await timeShift(distributionStartedAt + INCENTIVE_DURATION / 2 - 1);
      const res3 = await requestWithdrawal(user3, DEPOSIT);
      expect(res3.withdrawalAmount).to.be.closeToRelative(
        DEPOSIT + INCENTIVE_REWARD / 8n + INCENTIVE_REWARD / 6n + INCENTIVE_REWARD / 4n,
        3,
      );

      await timeShift(distributionStartedAt + INCENTIVE_DURATION);
      const res4 = await requestWithdrawal(user4, DEPOSIT);
      expect(res4.withdrawalAmount).to.be.closeToRelative(
        DEPOSIT + INCENTIVE_REWARD / 8n + INCENTIVE_REWARD / 6n + INCENTIVE_REWARD / 4n + INCENTIVE_REWARD / 2n,
        3,
      );
    });
  });
  context("Not allowed", function () {
    it("Withdrawal to another account by a non-depositor", async function () {
      await depositFor(user, DEPOSIT);
      const { requestId } = await requestWithdrawal(user, WITHDRAWAL);

      await timeShiftBy(ethers, WITHDRAWAL_DELAY);
      await expect(stAzur.connect(owner).withdrawTo(owner.address, requestId)).to.be.revertedWithCustomError(
        stAzur,
        "OnlyRequesterCanWithdrawToAnotherAddress",
      );
    });
    it("Batch withdrawal to another account by a non-depositor", async function () {
      await stAzur.connect(user).depositFor(user.address, DEPOSIT);
      await stAzur.connect(user).depositFor(owner.address, DEPOSIT);
      const requestId1 = (await requestWithdrawal(user, WITHDRAWAL)).requestId;
      const requestId2 = (await requestWithdrawal(owner, WITHDRAWAL)).requestId;

      await timeShiftBy(ethers, WITHDRAWAL_DELAY);
      await expect(
        stAzur.connect(owner).batchWithdrawTo(owner.address, [requestId1, requestId2]),
      ).to.be.revertedWithCustomError(stAzur, "OnlyRequesterCanWithdrawToAnotherAddress");
      await expect(
        stAzur.connect(user).batchWithdrawTo(user.address, [requestId1, requestId2]),
      ).to.be.revertedWithCustomError(stAzur, "OnlyRequesterCanWithdrawToAnotherAddress");
    });
    it("Withdrawal with a non-existent request", async function () {
      await expect(stAzur.connect(user).withdrawTo(owner.address, 1234)).to.be.revertedWithCustomError(
        stAzur,
        "RequestDoesNotExist",
      );
    });
    it("Withdrawal with an already executed request", async function () {
      await depositFor(user, DEPOSIT);
      const { requestId } = await requestWithdrawal(user, WITHDRAWAL);

      await timeShiftBy(ethers, WITHDRAWAL_DELAY);
      await stAzur.connect(user).withdrawTo(user.address, requestId);
      await expect(stAzur.connect(user).withdrawTo(user.address, requestId)).to.be.revertedWithCustomError(
        stAzur,
        "RequestDoesNotExist",
      );
    });
    it("Withdrawal before the timeout has passed", async function () {
      await depositFor(user, DEPOSIT);
      const { requestId } = await requestWithdrawal(user, WITHDRAWAL);

      await timeShiftBy(ethers, WITHDRAWAL_DELAY - 10);
      await expect(stAzur.connect(user).withdrawTo(user.address, requestId)).to.be.revertedWithCustomError(
        stAzur,
        "WithdrawalLocked",
      );
    });
    it("Deposit insufficient value", async function () {
      await updateStakingIncentive(INCENTIVE_REWARD, ONE_YEAR);
      await depositFor(user, DEPOSIT);
      await timeShiftBy(ethers, ONE_DAY);

      const incorrectDeposit = 1n;
      await azur.connect(user).approve(stAzur.address, incorrectDeposit);

      await expect(depositFor(user, incorrectDeposit)).to.be.revertedWithCustomError(stAzur, "InsufficientDeposit");
    });
    it("Deposit with insufficient funds", async function () {
      const incorrectDeposit = userBalanceBefore + 1n;
      await azur.connect(user).approve(stAzur.address, incorrectDeposit);
      await expect(depositFor(user, incorrectDeposit)).to.be.revertedWithCustomError(
        stAzur,
        "ERC20InsufficientBalance",
      );
    });
    it("Request with a zero value", async function () {
      await depositFor(user, DEPOSIT);
      await expect(requestWithdrawal(user, 0)).to.be.revertedWithCustomError(stAzur, "ZeroAmount");
    });
    it("Request for a fund amount exceeding the balance", async function () {
      await expect(requestWithdrawal(user, 0)).to.be.revertedWithCustomError(stAzur, "ZeroAmount");
    });
    it("Incentive reward to be equal zero", async function () {
      await expect(stAzur.updateStakingIncentive(0, ONE_YEAR)).to.be.revertedWithCustomError(stAzur, "NoReward");
    });
    it("Incentive duration to be out of the allowed range", async function () {
      await depositFor(owner, DEPOSIT);
      await expect(stAzur.updateStakingIncentive(1000, 0)).to.be.revertedWithCustomError(
        stAzur,
        "InvalidIncentiveDuration",
      );
      await expect(stAzur.updateStakingIncentive(1000, ONE_YEAR * 3 + 1)).to.be.revertedWithCustomError(
        stAzur,
        "InvalidIncentiveDuration",
      );
    });
    it("Changing the withdrawal delay for already requested withdrawals", async function () {
      await depositFor(user, DEPOSIT);
      const { requestId } = await requestWithdrawal(user, WITHDRAWAL);
      await stAzur.connect(owner).changeWithdrawalDelay(0);

      await expect(stAzur.connect(user).withdrawTo(user.address, requestId)).to.be.revertedWithCustomError(
        stAzur,
        "WithdrawalLocked",
      );
    });
    it("Non-owners to call restricted functions", async function () {
      await expect(stAzur.connect(user).changeWithdrawalDelay(ONE_DAY)).to.be.revertedWithCustomError(
        stAzur,
        "OwnableUnauthorizedAccount",
      );
      await expect(stAzur.connect(user).updateStakingIncentive(123, 456)).to.be.revertedWithCustomError(
        stAzur,
        "OwnableUnauthorizedAccount",
      );
      await expect(stAzur.connect(user).recover(user.address)).to.be.revertedWithCustomError(
        stAzur,
        "OwnableUnauthorizedAccount",
      );
    });
  });
});
