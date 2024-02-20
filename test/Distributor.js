const { time, loadFixture } = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");
const { expect } = require("chai");

describe("Distributor", function () {
  async function deployDistributorFixture() {
    // Contracts are deployed using the first signer/account by default
    const [owner, otherAccount] = await ethers.getSigners();

    const DISTRIBUTOR = await ethers.getContractFactory("Distributor", { signer: owner });
    const distributor = await upgrades.deployProxy(DISTRIBUTOR);
    await distributor.waitForDeployment();

    return { distributor, owner, otherAccount };
  }

  describe("Deployment", function () {
    it("Should set the right owner", async function () {
      const { distributor, owner } = await loadFixture(deployDistributorFixture);

      expect(await distributor.owner()).to.equal(owner.address);
    });
  });
});
