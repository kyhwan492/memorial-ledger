const { ethers } = require("hardhat");

async function main() {
  const [owner, author] = await ethers.getSigners();
  const registry = await ethers.deployContract("RecordRegistry");
  await registry.waitForDeployment();
  const address = await registry.getAddress();
  console.log("RecordRegistry:", address);
  // 로컬 개발 편의: hardhat 계정 #1을 작성자로 등록 (Sepolia에선 author가 없어 스킵)
  if (author) {
    await (await registry.registerAuthor(author.address, "http://localhost:3000/authors")).wait();
    console.log("작성자 등록:", author.address);
  }
  console.log(`\n서버 실행:\n  CONTRACT_ADDRESS=${address} node src/server.js`);
}

main().catch((e) => { console.error(e); process.exit(1); });
