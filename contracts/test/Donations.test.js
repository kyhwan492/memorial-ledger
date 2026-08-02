const { expect } = require("chai");
const { loadFixture } = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { ethers } = require("hardhat");

const personId = ethers.id("kim-gu");

async function deployFixture() {
  const [owner, beneficiary, donor] = await ethers.getSigners();
  const donations = await ethers.deployContract("Donations");
  return { donations, owner, beneficiary, donor };
}

async function registeredFixture() {
  const f = await deployFixture();
  await f.donations.registerBeneficiary(personId, f.beneficiary.address, "https://example.com/beneficiaries/1");
  return f;
}

describe("Donations", function () {
  it("owner가 수혜자를 등록하면 이벤트가 발행된다", async function () {
    const { donations, beneficiary } = await loadFixture(deployFixture);
    await expect(donations.registerBeneficiary(personId, beneficiary.address, "https://example.com/b/1"))
      .to.emit(donations, "BeneficiaryRegistered")
      .withArgs(personId, beneficiary.address, "https://example.com/b/1");
    expect(await donations.beneficiaries(personId)).to.equal(beneficiary.address);
  });

  it("owner가 아니면 수혜자 등록 불가, zero 주소/빈 프로필 거부", async function () {
    const { donations, beneficiary, donor } = await loadFixture(deployFixture);
    await expect(
      donations.connect(donor).registerBeneficiary(personId, beneficiary.address, "x")
    ).to.be.revertedWith("not owner");
    await expect(
      donations.registerBeneficiary(personId, ethers.ZeroAddress, "x")
    ).to.be.revertedWith("zero address");
    await expect(
      donations.registerBeneficiary(personId, beneficiary.address, "")
    ).to.be.revertedWith("empty profile");
  });

  it("후원금이 수혜자에게 즉시 전액 전달되고 이벤트·누적액이 기록된다", async function () {
    const { donations, beneficiary, donor } = await loadFixture(registeredFixture);
    const amount = ethers.parseEther("1");
    await expect(
      donations.connect(donor).donate(personId, { value: amount })
    ).to.changeEtherBalances([donor, beneficiary, donations], [-amount, amount, 0n]);
    await expect(donations.connect(donor).donate(personId, { value: amount }))
      .to.emit(donations, "Donated")
      .withArgs(personId, donor.address, amount);
    expect(await donations.totalDonated(personId)).to.equal(amount * 2n);
  });

  it("수혜자 미등록/0원 후원은 거부된다", async function () {
    const { donations, donor } = await loadFixture(deployFixture);
    await expect(
      donations.connect(donor).donate(personId, { value: 1n })
    ).to.be.revertedWith("no beneficiary");
    const { donations: d2, donor: donor2 } = await loadFixture(registeredFixture);
    await expect(d2.connect(donor2).donate(personId, { value: 0 })).to.be.revertedWith("zero amount");
  });
});
