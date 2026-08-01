const { expect } = require("chai");
const { loadFixture } = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { ethers } = require("hardhat");

async function deployFixture() {
  const [owner, author, stranger] = await ethers.getSigners();
  const registry = await ethers.deployContract("RecordRegistry");
  return { registry, owner, author, stranger };
}

describe("RecordRegistry: 작성자 등록", function () {
  it("배포자가 owner다", async function () {
    const { registry, owner } = await loadFixture(deployFixture);
    expect(await registry.owner()).to.equal(owner.address);
  });

  it("owner가 작성자를 등록하면 프로필이 저장되고 이벤트가 발행된다", async function () {
    const { registry, author } = await loadFixture(deployFixture);
    await expect(registry.registerAuthor(author.address, "https://example.com/authors/1"))
      .to.emit(registry, "AuthorRegistered")
      .withArgs(author.address, "https://example.com/authors/1");
    expect(await registry.authorProfiles(author.address)).to.equal("https://example.com/authors/1");
  });

  it("owner가 아니면 등록할 수 없다", async function () {
    const { registry, author, stranger } = await loadFixture(deployFixture);
    await expect(
      registry.connect(stranger).registerAuthor(author.address, "https://example.com/x")
    ).to.be.revertedWith("not owner");
  });

  it("빈 프로필 URI는 거부된다", async function () {
    const { registry, author } = await loadFixture(deployFixture);
    await expect(registry.registerAuthor(author.address, "")).to.be.revertedWith("empty profile");
  });
});

describe("RecordRegistry: 해시 앵커링", function () {
  const personId = ethers.id("kim-gu");
  const hash1 = ethers.id("content-v1");
  const hash2 = ethers.id("content-v2");

  async function authorFixture() {
    const f = await deployFixture();
    await f.registry.registerAuthor(f.author.address, "https://example.com/authors/1");
    return f;
  }

  it("등록 작성자가 앵커하면 이력에 추가되고 이벤트가 발행된다", async function () {
    const { registry, author } = await loadFixture(authorFixture);
    await expect(registry.connect(author).anchor(personId, hash1))
      .to.emit(registry, "RecordAnchored")
      .withArgs(personId, hash1, author.address, 0);
    expect(await registry.versionCount(personId)).to.equal(1);
  });

  it("미등록 지갑은 앵커할 수 없다", async function () {
    const { registry, stranger } = await loadFixture(authorFixture);
    await expect(registry.connect(stranger).anchor(personId, hash1)).to.be.revertedWith("not author");
  });

  it("이력은 추가만 되며 순서가 보존된다", async function () {
    const { registry, author } = await loadFixture(authorFixture);
    await registry.connect(author).anchor(personId, hash1);
    await registry.connect(author).anchor(personId, hash2);
    expect(await registry.versionCount(personId)).to.equal(2);
    const [h0] = await registry.getVersion(personId, 0);
    const [h1] = await registry.getVersion(personId, 1);
    expect(h0).to.equal(hash1);
    expect(h1).to.equal(hash2);
  });

  it("latest는 마지막 버전을 반환하고, 비어 있으면 revert한다", async function () {
    const { registry, author } = await loadFixture(authorFixture);
    await expect(registry.latest(personId)).to.be.revertedWith("no versions");
    await registry.connect(author).anchor(personId, hash1);
    await registry.connect(author).anchor(personId, hash2);
    const [h, a] = await registry.latest(personId);
    expect(h).to.equal(hash2);
    expect(a).to.equal(author.address);
  });
});
