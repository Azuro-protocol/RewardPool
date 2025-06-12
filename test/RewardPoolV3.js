const chai = require("chai");
const { loadFixture } = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { expect } = require("chai");

const { tokens, deployRewardPoolV3, timeShift, timeShiftBy, getTransactionTime } = require("../utils/utils");
const { ethers } = require("hardhat");

const INIT_MINT = tokens(1000000);
const INIT_BALANCE = tokens(1000);
const DEPOSIT = tokens(100);
const ACCIDENTALLY_TRANSFERRED = tokens(50);

const ONE_DAY = 60 * 60 * 24;
const ONE_YEAR = ONE_DAY * 365;

const UNSTAKE_PERIOD = ONE_YEAR * 2;
const INCENTIVE_DURATION = ONE_YEAR;
const INCENTIVE_REWARD = tokens(1000);

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

describe("RewardPool V3", function () {
  let azur, pAzur, usdt, owner, user, user2, user3, user4, ownerUsdtBalanceBefore;

  const stakeFor = async (account, value, to = account) => {
    const tx = await pAzur.connect(account).stakeFor(to, value);
    const result = await tx.wait();
    return result.logs[2].args.stakeId;
  };

  const claimReward = async (account) => {
    const balanceBefore = await usdt.balanceOf(account);
    await pAzur.connect(account).claimReward(account);
    return (await usdt.balanceOf(account)) - balanceBefore;
  };

  const unstake = async (account, stakeIds, to = account) => {
    const balanceBefore = await azur.balanceOf(account);
    await pAzur.connect(account).unstake(to, stakeIds);
    return (await azur.balanceOf(account)) - balanceBefore;
  };

  const updateStakingIncentive = async (reward, duration) => {
    const tx = await pAzur.connect(owner).updateStakingIncentive(reward, duration);
    return await getTransactionTime(ethers, tx);
  };

  const recover = async (token) => {
    const balanceBefore = await token.balanceOf(owner);
    await pAzur.connect(owner).recover(token, owner);
    return (await token.balanceOf(owner)) - balanceBefore;
  };

  beforeEach(async function () {
    ({ azur, pAzur, usdt, owner, user, user2, user3, user4, ownerUsdtBalanceBefore } =
      await loadFixture(deployFixture));
  });

  async function deployFixture() {
    const [owner, user, user2, user3, user4] = await ethers.getSigners();

    const Token = await ethers.getContractFactory("TestERC20");

    const azur = await Token.deploy("AZUR", "AZUR", INIT_MINT);
    await azur.waitForDeployment();
    azur.address = await azur.getAddress();

    const usdt = await Token.deploy("Tether USD", "USDT", INIT_MINT);
    await usdt.waitForDeployment();
    usdt.address = await usdt.getAddress();

    const pAzur = await deployRewardPoolV3(azur.address, usdt.address, 0);
    pAzur.address = await pAzur.getAddress();

    await usdt.connect(owner).approve(pAzur.address, INIT_MINT);
    for (const account of [user, user2, user3, user4]) {
      await azur.connect(owner).transfer(account.address, INIT_BALANCE);
      await azur.connect(account).approve(pAzur.address, INIT_BALANCE);
    }

    const ownerUsdtBalanceBefore = await usdt.balanceOf(owner.address);

    return {
      azur,
      pAzur,
      usdt,
      owner,
      user,
      user2,
      user3,
      user4,
      ownerUsdtBalanceBefore,
    };
  }

  context("Incentive program", function () {
    it("No incentive program interactions", async function () {
      expect(await pAzur.rewardRate()).to.be.equal(0);

      const stakeId1 = await stakeFor(user, DEPOSIT);
      expect(await pAzur.ownerOf(stakeId1)).to.equal(user);

      await updateStakingIncentive(INCENTIVE_REWARD, INCENTIVE_DURATION);
      await timeShiftBy(ethers, INCENTIVE_DURATION);

      const stakeId2 = await stakeFor(user2, DEPOSIT);
      expect(await pAzur.ownerOf(stakeId2)).to.equal(user2);

      const rewardPerToken = (tokens(1) * INCENTIVE_REWARD) / DEPOSIT;
      expect(await pAzur.rewardPerToken()).to.be.closeToRelative(rewardPerToken);

      await timeShiftBy(ethers, ONE_YEAR);
      expect(await pAzur.rewardPerToken()).to.be.closeToRelative(rewardPerToken);

      expect(await claimReward(user)).to.be.closeToRelative(INCENTIVE_REWARD);
      await expect(claimReward(user2)).to.revertedWithCustomError(pAzur, "NoUnclaimedReward");

      await timeShiftBy(ethers, ONE_YEAR);

      await expect(claimReward(user)).to.revertedWithCustomError(pAzur, "NoUnclaimedReward");
      await expect(claimReward(user2)).to.revertedWithCustomError(pAzur, "NoUnclaimedReward");

      expect(await unstake(user, [stakeId1])).to.equal(DEPOSIT);
      await expect(pAzur.ownerOf(stakeId1)).to.revertedWithCustomError(pAzur, "ERC721NonexistentToken");

      expect(await unstake(user2, [stakeId2])).to.equal(DEPOSIT);
      await expect(pAzur.ownerOf(stakeId2)).to.revertedWithCustomError(pAzur, "ERC721NonexistentToken");
    });
    it("Stake before the start of the incentive program and claim reward after it's end", async function () {
      for (const account of [user, user2, user3]) {
        await stakeFor(account, DEPOSIT);
      }

      await updateStakingIncentive(INCENTIVE_REWARD, INCENTIVE_DURATION);
      expect(await usdt.balanceOf(owner.address)).to.be.equal(ownerUsdtBalanceBefore - INCENTIVE_REWARD);

      await timeShiftBy(ethers, INCENTIVE_DURATION);

      for (const account of [user, user2, user3]) {
        expect(await claimReward(account)).to.be.closeToRelative(INCENTIVE_REWARD / 3n);
      }
    });
    it("Stake before the start of the incentive program and claim reward a long time ago of it's end", async function () {
      await stakeFor(user, DEPOSIT);
      await updateStakingIncentive(INCENTIVE_REWARD, INCENTIVE_DURATION);
      await timeShiftBy(ethers, ONE_YEAR * 5);

      expect(await claimReward(user)).to.be.closeToRelative(INCENTIVE_REWARD);
    });
    it("Stake before the start of the incentive program and unstake stake before it's end", async function () {
      const stakeId1 = await stakeFor(user, DEPOSIT);
      const stakeId2 = await stakeFor(user2, DEPOSIT);
      const stakeId3 = await stakeFor(user3, DEPOSIT);

      const distributionStartedAt = await updateStakingIncentive(INCENTIVE_REWARD, INCENTIVE_DURATION);

      await timeShift(distributionStartedAt + INCENTIVE_DURATION / 3 - 1);

      await unstake(user, [stakeId1]);
      expect(await claimReward(user)).to.be.closeToRelative(INCENTIVE_REWARD / 9n);

      await timeShift(distributionStartedAt + (INCENTIVE_DURATION * 2) / 3 - 1);
      await unstake(user2, [stakeId2]);
      expect(await claimReward(user2)).to.be.closeToRelative((INCENTIVE_REWARD * 5n) / 18n);

      await timeShift(distributionStartedAt + INCENTIVE_DURATION);
      await unstake(user3, [stakeId3]);
      expect(await claimReward(user3)).to.be.closeToRelative((INCENTIVE_REWARD * 11n) / 18n);

      await expect(claimReward(user)).to.revertedWithCustomError(pAzur, "NoUnclaimedReward");
      await expect(claimReward(user2)).to.revertedWithCustomError(pAzur, "NoUnclaimedReward");
    });
    it("Stake after the start of the incentive program and claim reward after it's end", async function () {
      await stakeFor(user, DEPOSIT);

      const distributionStartedAt = await updateStakingIncentive(INCENTIVE_REWARD, INCENTIVE_DURATION);

      await timeShift(distributionStartedAt + INCENTIVE_DURATION / 3 - 1);
      await stakeFor(user2, DEPOSIT);

      await timeShift(distributionStartedAt + (INCENTIVE_DURATION * 2) / 3 - 1);
      await stakeFor(user3, DEPOSIT);

      await timeShift(distributionStartedAt + INCENTIVE_DURATION);

      expect(await claimReward(user)).to.be.closeToRelative(
        INCENTIVE_REWARD / 3n + INCENTIVE_REWARD / 6n + INCENTIVE_REWARD / 9n,
      );
      expect(await claimReward(user2)).to.be.closeToRelative(INCENTIVE_REWARD / 6n + INCENTIVE_REWARD / 9n);
      expect(await claimReward(user3)).to.be.closeToRelative(INCENTIVE_REWARD / 9n);
    });
    it("Stake after the start of the incentive program and unstake stake before it's end", async function () {
      const distributionStartedAt = await updateStakingIncentive(INCENTIVE_REWARD, INCENTIVE_DURATION);

      await timeShift(distributionStartedAt + INCENTIVE_DURATION / 3 - 1);
      const stakeId = await stakeFor(user, DEPOSIT);

      await timeShift(distributionStartedAt + (INCENTIVE_DURATION * 2) / 3 - 1);
      await unstake(user, [stakeId]);
      expect(await claimReward(user)).to.be.closeToRelative(INCENTIVE_REWARD / 3n);

      await timeShift(distributionStartedAt + INCENTIVE_DURATION);
      await expect(claimReward(user)).to.revertedWithCustomError(pAzur, "NoUnclaimedReward");
    });
    it("Stake different amounts after the start of the incentive program and claim reward after it's end", async function () {
      const stake1 = DEPOSIT;
      const stake2 = DEPOSIT * 2n;
      const stake3 = DEPOSIT * 3n;

      await stakeFor(user, stake1);

      const distributionStartedAt = await updateStakingIncentive(INCENTIVE_REWARD, INCENTIVE_DURATION);

      await timeShift(distributionStartedAt + INCENTIVE_DURATION / 3 - 1);
      await stakeFor(user2, stake2);

      await timeShift(distributionStartedAt + (INCENTIVE_DURATION * 2) / 3 - 1);
      await stakeFor(user3, stake3);

      await timeShift(distributionStartedAt + INCENTIVE_DURATION);

      expect(await claimReward(user)).to.be.closeToRelative(
        INCENTIVE_REWARD / 3n +
          ((INCENTIVE_REWARD / 3n) * stake1) / (stake1 + stake2) +
          ((INCENTIVE_REWARD / 3n) * stake1) / (stake1 + stake2 + stake3),
      );

      expect(await claimReward(user2)).to.be.closeToRelative(
        ((INCENTIVE_REWARD / 3n) * stake2) / (stake1 + stake2) +
          ((INCENTIVE_REWARD / 3n) * stake2) / (stake1 + stake2 + stake3),
      );

      expect(await claimReward(user3)).to.be.closeToRelative(
        ((INCENTIVE_REWARD / 3n) * stake3) / (stake1 + stake2 + stake3),
      );
    });
    it("Stake different amounts by one staker after the start of the incentive program and claim reward after it's end", async function () {
      await stakeFor(user, DEPOSIT);
      const distributionStartedAt = await updateStakingIncentive(INCENTIVE_REWARD, INCENTIVE_DURATION);

      await timeShift(distributionStartedAt + INCENTIVE_DURATION / 3 - 1);
      await stakeFor(user, DEPOSIT * 2n);

      await timeShift(distributionStartedAt + (INCENTIVE_DURATION * 2) / 3 - 1);
      await stakeFor(user, DEPOSIT * 3n);

      await timeShift(distributionStartedAt + INCENTIVE_DURATION);
      expect(await claimReward(user)).to.be.closeToRelative(INCENTIVE_REWARD);
    });
    it("Update incentive in bounds of previous incentive", async function () {
      for (const account of [user, user2, user3]) {
        await stakeFor(account, DEPOSIT);
      }

      const distributionStartedAt = await updateStakingIncentive(INCENTIVE_REWARD, INCENTIVE_DURATION);

      await timeShift(distributionStartedAt + INCENTIVE_DURATION / 4 - 1);
      expect(await claimReward(user)).to.be.closeToRelative(INCENTIVE_REWARD / 12n);

      await timeShift(distributionStartedAt + INCENTIVE_DURATION / 2 - 1);
      await updateStakingIncentive(INCENTIVE_REWARD / 2n, INCENTIVE_DURATION / 2);

      /*
      21139861322434 - the reward amount for one second of staking.
      The claim transaction will be created one second after updating the incentive program.
      */
      const user2RewardForOneSecond = 21139861322434n;
      expect(await claimReward(user2)).to.be.closeToRelative(INCENTIVE_REWARD / 6n + user2RewardForOneSecond);

      await timeShift(distributionStartedAt + INCENTIVE_DURATION);
      expect(await claimReward(user3)).to.be.closeToRelative(INCENTIVE_REWARD / 6n + INCENTIVE_REWARD / 3n);
    });
    it("Update incentive out of bounds of previous incentive", async function () {
      for (const account of [user, user2, user3, user4]) {
        await stakeFor(account, DEPOSIT);
      }

      let distributionStartedAt = await updateStakingIncentive(INCENTIVE_REWARD, INCENTIVE_DURATION);

      await timeShift(distributionStartedAt + INCENTIVE_DURATION / 2 - 1);
      expect(await claimReward(user)).to.be.closeToRelative(INCENTIVE_REWARD / 8n);

      await timeShift(distributionStartedAt + INCENTIVE_DURATION);
      expect(await claimReward(user2)).to.be.closeToRelative(INCENTIVE_REWARD / 4n);

      distributionStartedAt = await updateStakingIncentive(INCENTIVE_REWARD, INCENTIVE_DURATION);

      await timeShift(distributionStartedAt + INCENTIVE_DURATION / 2 - 1);
      expect(await claimReward(user3)).to.be.closeToRelative(INCENTIVE_REWARD / 4n + INCENTIVE_REWARD / 8n);

      await timeShift(distributionStartedAt + INCENTIVE_DURATION);
      expect(await claimReward(user4)).to.be.closeToRelative(INCENTIVE_REWARD / 2n);
    });
  });

  context("Not allowed", function () {
    it("The same staking and reward token", async function () {
      await expect(deployRewardPoolV3(azur.address, azur.address, 0)).to.revertedWithCustomError(
        pAzur,
        "SameStakingAndRewardToken",
      );
    });
    it("Transfer a stake token", async function () {
      const stakeId = await stakeFor(user, DEPOSIT);

      await expect(pAzur.transferFrom(user, owner, stakeId)).to.be.revertedWithCustomError(
        pAzur,
        "NonTransferableToken",
      );
      await expect(pAzur.safeTransferFrom(user, owner, stakeId)).to.be.revertedWithCustomError(
        pAzur,
        "NonTransferableToken",
      );
      await expect(
        pAzur["safeTransferFrom(address,address,uint256,bytes)"](user, owner, stakeId, "0x"),
      ).to.be.revertedWithCustomError(pAzur, "NonTransferableToken");
    });
    it("Unstake by a non-staker", async function () {
      const stakeId = await stakeFor(user, DEPOSIT);

      await timeShiftBy(ethers, UNSTAKE_PERIOD);
      await expect(unstake(owner, [stakeId])).to.be.revertedWithCustomError(pAzur, "OnlyStakeOwner");
    });
    it("Unstake a non-existent stake", async function () {
      await expect(unstake(user, [12345])).to.be.revertedWithCustomError(pAzur, "ERC721NonexistentToken");
    });
    it("Unstake an already unstaked stake", async function () {
      const stakeId = await stakeFor(user, DEPOSIT);
      await timeShiftBy(ethers, UNSTAKE_PERIOD);
      await unstake(user, [stakeId]);

      await expect(unstake(user, [stakeId])).to.be.revertedWithCustomError(pAzur, "ERC721NonexistentToken");
    });
    it("Unstake before the lock period has passed", async function () {
      await pAzur.connect(owner).changeUnstakePeriod(UNSTAKE_PERIOD);
      const stakeId = await stakeFor(user, DEPOSIT);

      await timeShiftBy(ethers, UNSTAKE_PERIOD - 10);
      await expect(unstake(user, [stakeId])).to.be.revertedWithCustomError(pAzur, "StakeLocked");
    });
    it("Stake zero amount", async function () {
      await expect(stakeFor(user, 0n)).to.be.revertedWithCustomError(pAzur, "ZeroAmount");
    });
    it("Stake for staking address", async function () {
      await expect(stakeFor(user, DEPOSIT, (to = pAzur))).to.be.revertedWithCustomError(pAzur, "InvalidReceiver");
    });
    it("Stake with insufficient funds", async function () {
      const incorrectStake = (await azur.balanceOf(user)) + 1n;
      await azur.connect(user).approve(pAzur, incorrectStake);
      await expect(stakeFor(user, incorrectStake)).to.be.revertedWithCustomError(azur, "ERC20InsufficientBalance");
    });
    it("Claim no reward", async function () {
      await expect(claimReward(user)).to.be.revertedWithCustomError(pAzur, "NoUnclaimedReward");
    });
    it("Incentive reward to be equal zero", async function () {
      await expect(pAzur.updateStakingIncentive(0, ONE_YEAR)).to.be.revertedWithCustomError(pAzur, "NoReward");
    });
    it("Incentive duration to be out of the allowed range", async function () {
      await expect(pAzur.updateStakingIncentive(1000, 0)).to.be.revertedWithCustomError(
        pAzur,
        "InvalidIncentiveDuration",
      );
      await expect(pAzur.updateStakingIncentive(1000, ONE_YEAR * 3 + 1)).to.be.revertedWithCustomError(
        pAzur,
        "InvalidIncentiveDuration",
      );
    });
    it("Change the unstake period for already existing stakes", async function () {
      await pAzur.connect(owner).changeUnstakePeriod(UNSTAKE_PERIOD);
      const stakeId = await stakeFor(user, DEPOSIT);
      await pAzur.connect(owner).changeUnstakePeriod(0);
      await expect(unstake(user, [stakeId])).to.be.revertedWithCustomError(pAzur, "StakeLocked");
    });
    it("Recover unavailable balance", async function () {
      await expect(recover(azur)).to.revertedWithCustomError(pAzur, "NoAvailableBalance");
    });
    it("Non-owner to call restricted functions", async function () {
      await expect(pAzur.connect(user).changeUnstakePeriod(ONE_DAY)).to.be.revertedWithCustomError(
        pAzur,
        "OwnableUnauthorizedAccount",
      );
      await expect(pAzur.connect(user).updateStakingIncentive(123, 456)).to.be.revertedWithCustomError(
        pAzur,
        "OwnableUnauthorizedAccount",
      );
      await expect(pAzur.connect(user).recover(azur, user)).to.be.revertedWithCustomError(
        pAzur,
        "OwnableUnauthorizedAccount",
      );
    });
  });

  context("Misc", function () {
    it("Should recover accidentally transferred staking token", async function () {
      await azur.connect(user).transfer(pAzur.address, ACCIDENTALLY_TRANSFERRED);
      await stakeFor(user, DEPOSIT);
      expect(await recover(azur)).to.equal(ACCIDENTALLY_TRANSFERRED);
    });
    it("Should recover accidentally transferred reward token", async function () {
      await usdt.connect(owner).transfer(pAzur.address, ACCIDENTALLY_TRANSFERRED);
      await updateStakingIncentive(INCENTIVE_REWARD, ONE_YEAR);
      await timeShiftBy(ethers, ONE_DAY);
      expect(await recover(usdt)).to.equal(ACCIDENTALLY_TRANSFERRED);
    });
    it("Should recover accidentally transferred other token", async function () {
      const Token = await ethers.getContractFactory("TestERC20");
      const usdc = await Token.deploy("USD Coin", "USDC", INIT_MINT);
      await usdc.waitForDeployment();
      usdc.address = await usdc.getAddress();

      await usdc.connect(owner).transfer(pAzur.address, ACCIDENTALLY_TRANSFERRED);
      expect(await recover(usdc)).to.equal(ACCIDENTALLY_TRANSFERRED);
    });
  });
});
