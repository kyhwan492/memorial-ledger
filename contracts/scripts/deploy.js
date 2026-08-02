const { ethers } = require("hardhat");

async function main() {
  const [owner, author, beneficiary, tokenDonor] = await ethers.getSigners();
  const registry = await ethers.deployContract("RecordRegistry");
  await registry.waitForDeployment();
  const address = await registry.getAddress();
  console.log("RecordRegistry:", address);
  // 로컬 개발 편의: hardhat 계정 #1을 작성자로 등록 (Sepolia에선 author가 없어 스킵)
  if (author) {
    await (await registry.registerAuthor(author.address, "http://localhost:3000/authors")).wait();
    console.log("작성자 등록:", author.address);
  }

  const donations = await ethers.deployContract("Donations");
  await donations.waitForDeployment();
  const donationsAddress = await donations.getAddress();
  console.log("Donations:", donationsAddress);
  // 로컬 개발 편의: hardhat 계정 #2를 kim-gu 수혜자로 등록 (Sepolia에선 스킵)
  if (beneficiary) {
    await (await donations.registerBeneficiary(
      ethers.id("kim-gu"), beneficiary.address, "http://localhost:3000/persons/kim-gu"
    )).wait();
    console.log("수혜자 등록:", beneficiary.address);
  }

  // 로컬 데모용 ERC-20 (Sepolia에선 tokenDonor가 없어 스킵)
  let tokensEnv = "";
  if (tokenDonor) {
    const token = await ethers.deployContract("TestToken");
    await token.waitForDeployment();
    const tokenAddress = await token.getAddress();
    console.log("TestToken(TKRW):", tokenAddress);
    await (await token.transfer(tokenDonor.address, ethers.parseEther("10000"))).wait();
    console.log("데모 후원자 TKRW 지급:", tokenDonor.address);
    tokensEnv = ` TOKENS='[{"symbol":"TKRW","address":"${tokenAddress}","decimals":18}]'`;
  }

  console.log(
    `\n서버 실행:\n  CONTRACT_ADDRESS=${address} DONATIONS_ADDRESS=${donationsAddress}${tokensEnv} node src/server.js`
  );
}

main().catch((e) => { console.error(e); process.exit(1); });
