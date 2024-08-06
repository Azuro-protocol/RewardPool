const { loadFixture } = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { expect } = require("chai");

const { tokens, deployRewardPoolV2, timeShiftBy } = require("../utils/utils");

const INIT_MINT = tokens(1000000);
const INIT_BALANCE = tokens(1000);
const DEPOSIT = tokens(100);
const WITHDRAWAL = DEPOSIT / 2n;

const ONE_DAY = 60 * 60 * 24;
const ONE_WEEK = ONE_DAY * 7;
const WITHDRAWAL_DELAY = ONE_WEEK;

const requestWithdrawal = async (rewardPoolV2, account, value) => {
  const tx = await rewardPoolV2.connect(account).requestWithdrawal(value);
  const result = await tx.wait();
  return result.logs[1].args.requestId;
};

describe("RewardPool", function () {
  async function deployFixture() {
    const [owner, user] = await ethers.getSigners();

    const AZUR = await ethers.getContractFactory("TestERC20", { signer: owner });
    const azur = await AZUR.deploy("AZUR", "AZUR", INIT_MINT);
    await azur.waitForDeployment();
    azur.address = await azur.getAddress();

    const stAzur = await deployRewardPoolV2(azur.address, owner, "Staked $AZUR", "stAZUR", WITHDRAWAL_DELAY);
    stAzur.address = await stAzur.getAddress();

    await azur.connect(owner).transfer(user.address, INIT_BALANCE);
    await azur.connect(user).approve(stAzur.address, INIT_BALANCE);

    const ownerBalanceBefore = await azur.balanceOf(owner.address);
    const userBalanceBefore = await azur.balanceOf(user.address);

    return { azur, stAzur, owner, user, ownerBalanceBefore, userBalanceBefore };
  }

  context("Wrapper mechanics", function () {
    it("Should deposit via method call to the same account", async function () {
      const { azur, stAzur, user, userBalanceBefore } = await loadFixture(deployFixture);

      await stAzur.connect(user).depositFor(user.address, DEPOSIT);
      expect(await azur.balanceOf(user.address)).to.be.equal(userBalanceBefore - DEPOSIT);
      expect(await stAzur.balanceOf(user.address)).to.be.equal(DEPOSIT);
    });
    it("Should deposit via method call to another account", async function () {
      const { azur, stAzur, owner, user, ownerBalanceBefore, userBalanceBefore } = await loadFixture(deployFixture);

      await stAzur.connect(user).depositFor(owner.address, DEPOSIT);
      expect(await azur.balanceOf(owner.address)).to.be.equal(ownerBalanceBefore);
      expect(await stAzur.balanceOf(owner.address)).to.be.equal(DEPOSIT);
      expect(await azur.balanceOf(user.address)).to.be.equal(userBalanceBefore - DEPOSIT);
      expect(await stAzur.balanceOf(user.address)).to.be.equal(0);
    });
    it("Should perform a transfer", async function () {
      const { stAzur, owner, user } = await loadFixture(deployFixture);

      await stAzur.connect(user).depositFor(user.address, DEPOSIT);
      await stAzur.connect(user).transfer(owner.address, DEPOSIT);
      expect(await stAzur.balanceOf(owner.address)).to.be.equal(DEPOSIT);
      expect(await stAzur.balanceOf(user.address)).to.be.equal(0);
    });
    it("Should withdraw to the same account", async function () {
      const { azur, stAzur, user, userBalanceBefore } = await loadFixture(deployFixture);

      await stAzur.connect(user).depositFor(user.address, DEPOSIT);
      const requestId = await requestWithdrawal(stAzur, user, WITHDRAWAL);
      expect(await stAzur.balanceOf(user.address)).to.be.equal(DEPOSIT - WITHDRAWAL);
      expect(await azur.balanceOf(user.address)).to.be.equal(userBalanceBefore - DEPOSIT);

      await timeShiftBy(ethers, WITHDRAWAL_DELAY);
      await stAzur.connect(user).withdrawTo(user.address, requestId);
      expect(await stAzur.balanceOf(user.address)).to.be.equal(DEPOSIT - WITHDRAWAL);
      expect(await azur.balanceOf(user.address)).to.be.equal(userBalanceBefore - DEPOSIT + WITHDRAWAL);
    });
    it("Should withdraw to the same account by non-depositor", async function () {
      const { azur, stAzur, owner, user, userBalanceBefore } = await loadFixture(deployFixture);

      await stAzur.connect(user).depositFor(user.address, DEPOSIT);
      const requestId = await requestWithdrawal(stAzur, user, WITHDRAWAL);

      await timeShiftBy(ethers, WITHDRAWAL_DELAY);
      await stAzur.connect(owner).withdrawTo(user.address, requestId);
      expect(await stAzur.balanceOf(user.address)).to.be.equal(DEPOSIT - WITHDRAWAL);
      expect(await azur.balanceOf(user.address)).to.be.equal(userBalanceBefore - DEPOSIT + WITHDRAWAL);
    });
    it("Should withdraw to a different account", async function () {
      const { azur, stAzur, owner, user, ownerBalanceBefore } = await loadFixture(deployFixture);

      await stAzur.connect(user).depositFor(user.address, DEPOSIT);
      const requestId = await requestWithdrawal(stAzur, user, WITHDRAWAL);

      await timeShiftBy(ethers, WITHDRAWAL_DELAY);
      await stAzur.connect(user).withdrawTo(owner.address, requestId);
      expect(await stAzur.balanceOf(user.address)).to.be.equal(DEPOSIT - WITHDRAWAL);
      expect(await azur.balanceOf(owner.address)).to.be.equal(ownerBalanceBefore + WITHDRAWAL);
    });
    it("Should withdraw after transfer", async function () {
      const { azur, stAzur, owner, user, ownerBalanceBefore } = await loadFixture(deployFixture);

      await stAzur.connect(user).depositFor(user.address, DEPOSIT);
      await stAzur.connect(user).transfer(owner.address, WITHDRAWAL);
      const requestId = await requestWithdrawal(stAzur, owner, WITHDRAWAL);

      await timeShiftBy(ethers, WITHDRAWAL_DELAY);
      await stAzur.connect(owner).withdrawTo(owner.address, requestId);
      expect(await stAzur.balanceOf(user.address)).to.be.equal(DEPOSIT - WITHDRAWAL);
      expect(await azur.balanceOf(owner.address)).to.be.equal(ownerBalanceBefore + WITHDRAWAL);
    });
    it("Should perform batch withdrawal to the same account", async function () {
      const { azur, stAzur, user, userBalanceBefore } = await loadFixture(deployFixture);

      await stAzur.connect(user).depositFor(user.address, DEPOSIT);
      const requestId1 = await requestWithdrawal(stAzur, user, WITHDRAWAL);
      const requestId2 = await requestWithdrawal(stAzur, user, DEPOSIT - WITHDRAWAL);

      await timeShiftBy(ethers, WITHDRAWAL_DELAY);
      await stAzur.connect(user).batchWithdrawTo(user.address, [requestId1, requestId2]);
      expect(await stAzur.balanceOf(user.address)).to.be.equal(0);
      expect(await azur.balanceOf(user.address)).to.be.equal(userBalanceBefore);
    });
    it("Should perform batch withdrawal to a different account", async function () {
      const { azur, stAzur, owner, user, ownerBalanceBefore } = await loadFixture(deployFixture);

      await stAzur.connect(user).depositFor(user.address, DEPOSIT);
      const requestId1 = await requestWithdrawal(stAzur, user, WITHDRAWAL);
      const requestId2 = await requestWithdrawal(stAzur, user, DEPOSIT - WITHDRAWAL);

      await timeShiftBy(ethers, WITHDRAWAL_DELAY);
      await stAzur.connect(user).batchWithdrawTo(owner.address, [requestId1, requestId2]);
      expect(await stAzur.balanceOf(owner.address)).to.be.equal(0);
      expect(await azur.balanceOf(owner.address)).to.be.equal(ownerBalanceBefore + DEPOSIT);
    });
    it("Should change withdrawal delay", async function () {
      const { azur, stAzur, owner, user, userBalanceBefore } = await loadFixture(deployFixture);

      await stAzur.connect(user).depositFor(user.address, DEPOSIT);
      await stAzur.connect(owner).changeWithdrawalDelay(ONE_DAY);
      const requestId = await requestWithdrawal(stAzur, user, WITHDRAWAL);

      await timeShiftBy(ethers, ONE_DAY);
      await stAzur.connect(user).withdrawTo(user.address, requestId);
      expect(await stAzur.balanceOf(user.address)).to.be.equal(DEPOSIT - WITHDRAWAL);
      expect(await azur.balanceOf(user.address)).to.be.equal(userBalanceBefore - DEPOSIT + WITHDRAWAL);
    });
    it("Should recover accidentally transferred funds", async function () {
      const { azur, stAzur, owner, user, ownerBalanceBefore, userBalanceBefore } = await loadFixture(deployFixture);

      await azur.connect(user).transfer(stAzur.address, DEPOSIT);
      expect(await azur.balanceOf(user.address)).to.be.equal(userBalanceBefore - DEPOSIT);

      await stAzur.connect(owner).recover(owner.address);
      expect(await azur.balanceOf(owner.address)).to.be.equal(ownerBalanceBefore);
      expect(await stAzur.balanceOf(owner.address)).to.be.equal(DEPOSIT);
    });
  });

  context("Check restrictions", function () {
    it("Should not allow withdrawal to another account by non-depositor", async function () {
      const { stAzur, owner, user } = await loadFixture(deployFixture);

      await stAzur.connect(user).depositFor(user.address, DEPOSIT);
      const requestId = await requestWithdrawal(stAzur, user, WITHDRAWAL);

      await timeShiftBy(ethers, WITHDRAWAL_DELAY);
      await expect(stAzur.connect(owner).withdrawTo(owner.address, requestId)).to.be.revertedWithCustomError(
        stAzur,
        "OnlyRequesterCanWithdrawToAnotherAddress",
      );
    });
    it("Should not allow batch to another account by non-depositor", async function () {
      const { stAzur, owner, user } = await loadFixture(deployFixture);

      await stAzur.connect(user).depositFor(user.address, DEPOSIT);
      await stAzur.connect(user).depositFor(owner.address, DEPOSIT);
      const requestId1 = await requestWithdrawal(stAzur, user, WITHDRAWAL);
      const requestId2 = await requestWithdrawal(stAzur, owner, WITHDRAWAL);

      await timeShiftBy(ethers, WITHDRAWAL_DELAY);
      await expect(
        stAzur.connect(owner).batchWithdrawTo(owner.address, [requestId1, requestId2]),
      ).to.be.revertedWithCustomError(stAzur, "OnlyRequesterCanWithdrawToAnotherAddress");
      await expect(
        stAzur.connect(user).batchWithdrawTo(user.address, [requestId1, requestId2]),
      ).to.be.revertedWithCustomError(stAzur, "OnlyRequesterCanWithdrawToAnotherAddress");
    });
    it("Should not allow withdrawal with a non-existent request", async function () {
      const { stAzur, owner, user } = await loadFixture(deployFixture);
      await expect(stAzur.connect(user).withdrawTo(owner.address, 1234)).to.be.revertedWithCustomError(
        stAzur,
        "RequestDoesNotExist",
      );
    });
    it("Should not allow withdrawal with an already executed request", async function () {
      const { stAzur, user } = await loadFixture(deployFixture);

      await stAzur.connect(user).depositFor(user.address, DEPOSIT);
      const requestId = await requestWithdrawal(stAzur, user, WITHDRAWAL);

      await timeShiftBy(ethers, WITHDRAWAL_DELAY);
      await stAzur.connect(user).withdrawTo(user.address, requestId);
      await expect(stAzur.connect(user).withdrawTo(user.address, requestId)).to.be.revertedWithCustomError(
        stAzur,
        "RequestDoesNotExist",
      );
    });
    it("Should not allow withdrawal before timeout has passed", async function () {
      const { stAzur, user } = await loadFixture(deployFixture);

      await stAzur.connect(user).depositFor(user.address, DEPOSIT);
      const requestId = await requestWithdrawal(stAzur, user, WITHDRAWAL);

      await timeShiftBy(ethers, WITHDRAWAL_DELAY - 10);
      await expect(stAzur.connect(user).withdrawTo(user.address, requestId)).to.be.revertedWithCustomError(
        stAzur,
        "WithdrawalLocked",
      );
    });
    it("Should not allow deposit with insufficient funds", async function () {
      const { azur, stAzur, user, userBalanceBefore } = await loadFixture(deployFixture);

      const incorrectDeposit = userBalanceBefore + 1n;
      await azur.connect(user).approve(stAzur.address, incorrectDeposit);
      await expect(stAzur.connect(user).depositFor(user.address, incorrectDeposit)).to.be.revertedWithCustomError(
        stAzur,
        "ERC20InsufficientBalance",
      );
    });
    it("Should not allow request zero value", async function () {
      const { stAzur, user } = await loadFixture(deployFixture);

      await stAzur.connect(user).depositFor(user.address, DEPOSIT);
      await expect(requestWithdrawal(stAzur, user, 0)).to.be.revertedWithCustomError(stAzur, "ZeroValue");
    });
    it("Should not allow request a fund amount exceeding the balance", async function () {
      const { stAzur, user } = await loadFixture(deployFixture);

      await stAzur.connect(user).depositFor(user.address, DEPOSIT + 1n);
      await expect(requestWithdrawal(stAzur, user, 0)).to.be.revertedWithCustomError(stAzur, "ZeroValue");
    });
    it("Should not change withdrawal delay for already requested withdrawals", async function () {
      const { stAzur, owner, user } = await loadFixture(deployFixture);

      await stAzur.connect(user).depositFor(user.address, DEPOSIT);
      const requestId = await requestWithdrawal(stAzur, user, WITHDRAWAL);
      await stAzur.connect(owner).changeWithdrawalDelay(0);

      await expect(stAzur.connect(user).withdrawTo(user.address, requestId)).to.be.revertedWithCustomError(
        stAzur,
        "WithdrawalLocked",
      );
    });
    it("Only the owner can change the withdrawal delay", async function () {
      const { stAzur, user } = await loadFixture(deployFixture);

      await expect(stAzur.connect(user).changeWithdrawalDelay(ONE_DAY)).to.be.revertedWithCustomError(
        stAzur,
        "OwnableUnauthorizedAccount",
      );
    });
    it("Only the owner can recover funds", async function () {
      const { stAzur, user } = await loadFixture(deployFixture);

      await expect(stAzur.connect(user).recover(user.address)).to.be.revertedWithCustomError(
        stAzur,
        "OwnableUnauthorizedAccount",
      );
    });
  });
});
