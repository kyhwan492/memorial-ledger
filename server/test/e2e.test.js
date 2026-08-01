import test from "node:test";
import assert from "node:assert/strict";
import { spawn, execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";
import { openDb, listVersions } from "../src/db.js";
import { createApp } from "../src/app.js";
import { canonicalize } from "../public/canonical.js";

const CONTRACTS_DIR = fileURLToPath(new URL("../../contracts", import.meta.url));
const RPC = "http://127.0.0.1:8590";
// hardhat 공개 테스트 키 (실제 자산 없음)
const OWNER_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const AUTHOR_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";

async function waitForRpc(url, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}',
      });
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("hardhat node가 뜨지 않음");
}

test("E2E: 등록 → 앵커 → 브라우저 검증 로직", { timeout: 180_000 }, async (t) => {
  execSync("npx hardhat compile", { cwd: CONTRACTS_DIR, stdio: "inherit" });
  const node = spawn("npx", ["hardhat", "node", "--port", "8590"], { cwd: CONTRACTS_DIR });
  t.after(() => node.kill());
  await waitForRpc(RPC);

  // 배포 + 작성자 등록 (owner=계정0, author=계정1)
  // cacheTimeout: -1 — 기본 250ms 캐시 때문에 연속 트랜잭션이 같은 nonce를 쓴다
  const provider = new ethers.JsonRpcProvider(RPC, undefined, { cacheTimeout: -1 });
  const owner = new ethers.Wallet(OWNER_KEY, provider);
  const author = new ethers.Wallet(AUTHOR_KEY, provider);
  const artifact = JSON.parse(readFileSync(
    `${CONTRACTS_DIR}/artifacts/contracts/RecordRegistry.sol/RecordRegistry.json`, "utf8"
  ));
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, owner);
  const registry = await factory.deploy();
  await registry.waitForDeployment();
  await (await registry.registerAuthor(author.address, "http://localhost/authors")).wait();

  // 서버 기동 + 기록 작성 (draft)
  const db = openDb();
  const app = createApp(db, { rpcUrl: RPC, contract: await registry.getAddress() });
  const server = app.listen(0);
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;

  await fetch(base + "/persons", {
    method: "POST",
    body: new URLSearchParams({
      slug: "kim-gu", name: "김구", category: "independence",
      birth: "1876", death: "1949", summary: "대한민국 임시정부 주석",
    }),
    redirect: "manual",
  });
  const [draft] = listVersions(db, "kim-gu");

  // 앵커 (wallet.js가 하는 일을 ethers로 직접)
  const tx = await registry.connect(author).anchor(ethers.id("kim-gu"), draft.content_hash);
  await tx.wait();
  await fetch(`${base}/versions/${draft.id}/anchored`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ txHash: tx.hash, wallet: author.address }),
  });

  // 검증 (verify.js가 하는 일을 node에서 재현)
  const { content } = await (await fetch(base + "/persons/kim-gu/latest.json")).json();
  const localHash = ethers.keccak256(ethers.toUtf8Bytes(canonicalize(content)));
  const [chainHash, chainAuthor] = await registry.latest(ethers.id("kim-gu"));
  assert.equal(chainHash, localHash);
  assert.equal(chainAuthor, author.address);
});
