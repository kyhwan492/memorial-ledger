# Record Registry v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 인물 기록을 오프체인(SQLite)에 저장하고 keccak256 해시를 체인(RecordRegistry 컨트랙트)에 앵커링해, 누구나 브라우저에서 서버를 신뢰하지 않고 변조 여부를 검증할 수 있는 웹 서비스를 만든다.

**Architecture:** `contracts/`(Hardhat + Solidity 단일 컨트랙트)와 `server/`(Express + node:sqlite + EJS 서버 렌더링 + htmx)의 2패키지 모노레포. 브라우저 JS는 `wallet.js`(MetaMask 서명)와 `verify.js`(체인 검증) 2개의 섬만 존재. 정본 직렬화 로직(`canonical.js`)은 서버와 브라우저가 같은 파일을 공유한다.

**Tech Stack:** Solidity 0.8.24, Hardhat 2.x + @nomicfoundation/hardhat-toolbox(ethers v6), Node 24+(node:sqlite, node:test), Express, EJS, htmx 2(vendored), ethers v6(서버 + 브라우저 UMD vendored).

## Global Constraints

- Node **24 이상** 필수 (`node:sqlite`, `node:test` 사용 — 추가 DB/테스트 의존성 금지)
- `server/`는 ESM (`"type": "module"`), `contracts/`는 Hardhat 관례대로 CommonJS
- 프론트 빌드 파이프라인 금지 — 브라우저 라이브러리는 `server/public/vendor/`에 vendored 커밋
- 브라우저 JS는 `canonical.js`, `verify.js`, `wallet.js` + vendored 라이브러리만 허용
- UI 문구는 한국어
- 정본 직렬화 규칙: JSON 키 사전순 정렬(재귀), 문자열·키 UTF-8 NFC 정규화, 공백 없는 `JSON.stringify`. 해시는 `keccak256(utf8bytes(canonical))`
- 온체인 `personId` = `ethers.id(slug)` (slug의 UTF-8 keccak256)
- 커밋 메시지에 Co-Authored-By 트레일러 금지
- 시드는 5명 인라인 데이터로 시작 (공훈전자사료관 대량 임포트는 후속 작업 — spec에 반영됨)
- 버전 상태는 `draft → anchored` 2단계 (spec에 반영됨). 재시도 = 앵커 페이지 재방문

---

### Task 1: Hardhat 스캐폴드 + RecordRegistry 작성자 등록부

**Files:**
- Create: `.gitignore`, `contracts/package.json`, `contracts/hardhat.config.js`
- Create: `contracts/contracts/RecordRegistry.sol`
- Test: `contracts/test/RecordRegistry.test.js`

**Interfaces:**
- Produces: `RecordRegistry` 컨트랙트 — `owner() view returns (address)`, `authorProfiles(address) view returns (string)`, `registerAuthor(address author, string profileUri)` (onlyOwner), 이벤트 `AuthorRegistered(address indexed author, string profileUri)`

- [x] **Step 1: 스캐폴드**

```bash
cd /Users/yonghwan/Documents/Dev/memorial-ledger
cat > .gitignore <<'EOF'
node_modules/
contracts/artifacts/
contracts/cache/
server/data/
.env
EOF
mkdir -p contracts/contracts contracts/test contracts/scripts
cd contracts
npm init -y
npm install --save-dev hardhat @nomicfoundation/hardhat-toolbox
```

`contracts/hardhat.config.js`:

```js
require("@nomicfoundation/hardhat-toolbox");

module.exports = {
  solidity: "0.8.24",
  networks: {
    sepolia: {
      url: process.env.SEPOLIA_RPC_URL ?? "",
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
    },
  },
};
```

- [x] **Step 2: 실패하는 테스트 작성**

`contracts/test/RecordRegistry.test.js`:

```js
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
```

- [x] **Step 3: 실패 확인**

Run: `cd contracts && npx hardhat test`
Expected: 컴파일 에러 — `RecordRegistry.sol` 없음 (HH700 계열)

- [x] **Step 4: 최소 구현**

`contracts/contracts/RecordRegistry.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract RecordRegistry {
    address public owner;
    mapping(address => string) public authorProfiles;

    event AuthorRegistered(address indexed author, string profileUri);

    constructor() {
        owner = msg.sender;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    function registerAuthor(address author, string calldata profileUri) external onlyOwner {
        require(bytes(profileUri).length != 0, "empty profile");
        authorProfiles[author] = profileUri;
        emit AuthorRegistered(author, profileUri);
    }
}
```

- [x] **Step 5: 통과 확인**

Run: `npx hardhat test`
Expected: 4 passing

- [x] **Step 6: 커밋**

```bash
cd /Users/yonghwan/Documents/Dev/memorial-ledger
git add .gitignore contracts/package.json contracts/package-lock.json contracts/hardhat.config.js contracts/contracts contracts/test
git commit -m "feat: RecordRegistry 작성자 등록부 (owner 전용 allowlist)"
```

---

### Task 2: RecordRegistry 해시 앵커링 + 조회 뷰

**Files:**
- Modify: `contracts/contracts/RecordRegistry.sol`
- Test: `contracts/test/RecordRegistry.test.js` (append)

**Interfaces:**
- Consumes: Task 1의 `authorProfiles` allowlist
- Produces: `anchor(bytes32 personId, bytes32 contentHash)` (등록 작성자만), `versionCount(bytes32) view returns (uint256)`, `getVersion(bytes32, uint256) view returns (bytes32, address, uint64)`, `latest(bytes32) view returns (bytes32, address, uint64)` (비어 있으면 revert "no versions"), 이벤트 `RecordAnchored(bytes32 indexed personId, bytes32 contentHash, address indexed author, uint256 versionIndex)`

- [x] **Step 1: 실패하는 테스트 추가**

`contracts/test/RecordRegistry.test.js`에 append:

```js
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
```

- [x] **Step 2: 실패 확인**

Run: `npx hardhat test`
Expected: 기존 4 passing, 새 4개는 `registry.anchor is not a function`류 실패

- [x] **Step 3: 구현**

`RecordRegistry.sol`의 `registerAuthor` 아래에 추가:

```solidity
    struct Version {
        bytes32 contentHash;
        address author;
        uint64 timestamp;
    }

    mapping(bytes32 => Version[]) private history;

    event RecordAnchored(
        bytes32 indexed personId,
        bytes32 contentHash,
        address indexed author,
        uint256 versionIndex
    );

    modifier onlyAuthor() {
        require(bytes(authorProfiles[msg.sender]).length != 0, "not author");
        _;
    }

    function anchor(bytes32 personId, bytes32 contentHash) external onlyAuthor {
        history[personId].push(Version(contentHash, msg.sender, uint64(block.timestamp)));
        emit RecordAnchored(personId, contentHash, msg.sender, history[personId].length - 1);
    }

    function versionCount(bytes32 personId) external view returns (uint256) {
        return history[personId].length;
    }

    function getVersion(bytes32 personId, uint256 index)
        external view returns (bytes32, address, uint64)
    {
        Version storage v = history[personId][index];
        return (v.contentHash, v.author, v.timestamp);
    }

    function latest(bytes32 personId) external view returns (bytes32, address, uint64) {
        Version[] storage h = history[personId];
        require(h.length > 0, "no versions");
        Version storage v = h[h.length - 1];
        return (v.contentHash, v.author, v.timestamp);
    }
```

- [x] **Step 4: 통과 확인**

Run: `npx hardhat test`
Expected: 8 passing

- [x] **Step 5: 커밋**

```bash
git add contracts/contracts/RecordRegistry.sol contracts/test/RecordRegistry.test.js
git commit -m "feat: 해시 앵커링 - 추가 전용 버전 이력과 조회 뷰"
```

---

### Task 3: server 스캐폴드 + canonical.js (정본 직렬화)

**Files:**
- Create: `server/package.json`
- Create: `server/public/canonical.js`
- Create: `server/public/vendor/ethers.umd.min.js`, `server/public/vendor/htmx.min.js` (vendored)
- Test: `server/test/canonical.test.js`

**Interfaces:**
- Produces: `canonicalize(value) -> string` — 브라우저·서버 공용 ESM. 키 사전순 정렬(재귀), 문자열·키 NFC 정규화, 공백 없는 JSON 문자열 반환. 해시는 호출자가 `ethers.keccak256(ethers.toUtf8Bytes(canonicalize(x)))`로 계산

- [x] **Step 1: 스캐폴드 + vendoring**

```bash
cd /Users/yonghwan/Documents/Dev/memorial-ledger
mkdir -p server/src/views server/public/vendor server/test server/scripts server/data
cd server
npm init -y
npm pkg set type=module main=src/server.js scripts.test="node --test test/"
npm install express ejs ethers
cp node_modules/ethers/dist/ethers.umd.min.js public/vendor/ethers.umd.min.js
curl -fsSL -o public/vendor/htmx.min.js https://unpkg.com/htmx.org@2/dist/htmx.min.js
```

- [x] **Step 2: 실패하는 테스트 작성**

`server/test/canonical.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { canonicalize } from "../public/canonical.js";

test("키가 사전순으로 정렬된다 (재귀)", () => {
  assert.equal(
    canonicalize({ b: 1, a: { d: 2, c: 3 } }),
    '{"a":{"c":3,"d":2},"b":1}'
  );
});

test("같은 내용이면 키 순서와 무관하게 같은 문자열", () => {
  assert.equal(
    canonicalize({ name: "김구", birth: "1876" }),
    canonicalize({ birth: "1876", name: "김구" })
  );
});

test("문자열은 NFC로 정규화된다", () => {
  const nfd = "김구".normalize("NFD");
  assert.equal(canonicalize({ name: nfd }), canonicalize({ name: "김구" }));
});

test("배열 순서는 보존된다", () => {
  assert.equal(canonicalize({ a: [2, 1] }), '{"a":[2,1]}');
});

test("null과 숫자를 처리한다", () => {
  assert.equal(canonicalize({ a: null, b: 1.5 }), '{"a":null,"b":1.5}');
});
```

- [x] **Step 3: 실패 확인**

Run: `cd server && npm test`
Expected: FAIL — `Cannot find module .../public/canonical.js`

- [x] **Step 4: 구현**

`server/public/canonical.js`:

```js
// 정본 직렬화: 키 사전순(재귀) + 문자열/키 NFC 정규화 + 공백 없는 stringify.
// 서버와 브라우저가 이 파일 하나를 공유한다. 의존성 금지.
export function canonicalize(value) {
  return JSON.stringify(sort(value));
}

function sort(v) {
  if (Array.isArray(v)) return v.map(sort);
  if (v && typeof v === "object") {
    const pairs = Object.entries(v).map(([k, val]) => [k.normalize("NFC"), sort(val)]);
    pairs.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return Object.fromEntries(pairs);
  }
  if (typeof v === "string") return v.normalize("NFC");
  return v;
}
```

- [x] **Step 5: 통과 확인**

Run: `npm test`
Expected: 5 passing

- [x] **Step 6: 커밋**

```bash
cd /Users/yonghwan/Documents/Dev/memorial-ledger
git add server/package.json server/package-lock.json server/public server/test
git commit -m "feat: server 스캐폴드와 정본 직렬화 canonical.js"
```

---

### Task 4: db.js — node:sqlite 스키마와 쿼리

**Files:**
- Create: `server/src/db.js`
- Test: `server/test/db.test.js`

**Interfaces:**
- Consumes: 없음 (node:sqlite만)
- Produces (모두 `server/src/db.js`에서 export):
  - `openDb(path = ":memory:") -> DatabaseSync` — 스키마 생성 포함
  - `upsertPerson(db, {slug, name, category, birth, death, summary})`
  - `getPerson(db, slug) -> row | undefined`
  - `listPersons(db, {q, category} = {}) -> rows` (이름 부분 일치 + 분류 필터)
  - `addSource(db, {personSlug, label, url})` / `listSources(db, personSlug) -> rows`
  - `createDraft(db, {personSlug, contentJson, contentHash}) -> versionId`
  - `markAnchored(db, {versionId, txHash, wallet})`
  - `listVersions(db, personSlug) -> rows` (최신순)
  - `latestAnchored(db, personSlug) -> row | undefined`
  - `addAuthor(db, {name, credential, wallet}) -> authorId` / `getAuthor(db, id)` / `listAuthors(db)`

- [x] **Step 1: 실패하는 테스트 작성**

`server/test/db.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import {
  openDb, upsertPerson, getPerson, listPersons, addSource, listSources,
  createDraft, markAnchored, listVersions, latestAnchored,
  addAuthor, getAuthor, listAuthors,
} from "../src/db.js";

function seedPerson(db) {
  upsertPerson(db, {
    slug: "kim-gu", name: "김구", category: "independence",
    birth: "1876", death: "1949", summary: "대한민국 임시정부 주석",
  });
}

test("person upsert와 조회", () => {
  const db = openDb();
  seedPerson(db);
  assert.equal(getPerson(db, "kim-gu").name, "김구");
  upsertPerson(db, {
    slug: "kim-gu", name: "김구", category: "independence",
    birth: "1876", death: "1949", summary: "수정된 요약",
  });
  assert.equal(getPerson(db, "kim-gu").summary, "수정된 요약");
  assert.equal(listPersons(db).length, 1);
});

test("이름 검색과 분류 필터", () => {
  const db = openDb();
  seedPerson(db);
  upsertPerson(db, {
    slug: "test-vet", name: "홍길동", category: "korean_war",
    birth: "1930", death: "", summary: "6·25 참전",
  });
  assert.equal(listPersons(db, { q: "김" }).length, 1);
  assert.equal(listPersons(db, { category: "korean_war" })[0].slug, "test-vet");
});

test("draft 생성 → anchored 전이와 latestAnchored", () => {
  const db = openDb();
  seedPerson(db);
  const v1 = createDraft(db, { personSlug: "kim-gu", contentJson: "{}", contentHash: "0xaa" });
  assert.equal(latestAnchored(db, "kim-gu"), undefined);
  markAnchored(db, { versionId: v1, txHash: "0x".padEnd(66, "1"), wallet: "0xW" });
  assert.equal(latestAnchored(db, "kim-gu").content_hash, "0xaa");
  const v2 = createDraft(db, { personSlug: "kim-gu", contentJson: "{}", contentHash: "0xbb" });
  markAnchored(db, { versionId: v2, txHash: "0x".padEnd(66, "2"), wallet: "0xW" });
  assert.equal(latestAnchored(db, "kim-gu").content_hash, "0xbb");
  assert.equal(listVersions(db, "kim-gu").length, 2);
});

test("sources와 authors", () => {
  const db = openDb();
  seedPerson(db);
  addSource(db, { personSlug: "kim-gu", label: "공훈전자사료관", url: "https://e-gonghun.mpva.go.kr/" });
  assert.equal(listSources(db, "kim-gu").length, 1);
  const id = addAuthor(db, { name: "홍역사", credential: "사학과 교수", wallet: "0xABC" });
  assert.equal(getAuthor(db, id).name, "홍역사");
  assert.equal(listAuthors(db).length, 1);
});
```

- [x] **Step 2: 실패 확인**

Run: `npm test`
Expected: db.test.js FAIL — `Cannot find module .../src/db.js` (canonical 5개는 계속 passing)

- [x] **Step 3: 구현**

`server/src/db.js`:

```js
import { DatabaseSync } from "node:sqlite";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS persons (
  slug TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  birth TEXT NOT NULL DEFAULT '',
  death TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS sources (
  id INTEGER PRIMARY KEY,
  person_slug TEXT NOT NULL REFERENCES persons(slug),
  label TEXT NOT NULL,
  url TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS authors (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  credential TEXT NOT NULL,
  wallet TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS record_versions (
  id INTEGER PRIMARY KEY,
  person_slug TEXT NOT NULL REFERENCES persons(slug),
  content_json TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  tx_hash TEXT,
  wallet TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

export function openDb(path = ":memory:") {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(SCHEMA);
  return db;
}

export function upsertPerson(db, { slug, name, category, birth, death, summary }) {
  db.prepare(`
    INSERT INTO persons (slug, name, category, birth, death, summary)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(slug) DO UPDATE SET
      name = excluded.name, category = excluded.category,
      birth = excluded.birth, death = excluded.death, summary = excluded.summary
  `).run(slug, name, category, birth ?? "", death ?? "", summary ?? "");
}

export function getPerson(db, slug) {
  return db.prepare("SELECT * FROM persons WHERE slug = ?").get(slug);
}

export function listPersons(db, { q, category } = {}) {
  let sql = "SELECT * FROM persons WHERE 1=1";
  const params = [];
  if (q) { sql += " AND name LIKE ?"; params.push(`%${q}%`); }
  if (category) { sql += " AND category = ?"; params.push(category); }
  sql += " ORDER BY name";
  return db.prepare(sql).all(...params);
}

export function addSource(db, { personSlug, label, url }) {
  db.prepare("INSERT INTO sources (person_slug, label, url) VALUES (?, ?, ?)")
    .run(personSlug, label, url ?? "");
}

export function listSources(db, personSlug) {
  return db.prepare("SELECT * FROM sources WHERE person_slug = ? ORDER BY id").all(personSlug);
}

export function createDraft(db, { personSlug, contentJson, contentHash }) {
  const r = db.prepare(
    "INSERT INTO record_versions (person_slug, content_json, content_hash) VALUES (?, ?, ?)"
  ).run(personSlug, contentJson, contentHash);
  return Number(r.lastInsertRowid);
}

export function markAnchored(db, { versionId, txHash, wallet }) {
  db.prepare(
    "UPDATE record_versions SET status = 'anchored', tx_hash = ?, wallet = ? WHERE id = ?"
  ).run(txHash, wallet ?? null, versionId);
}

export function listVersions(db, personSlug) {
  return db.prepare(
    "SELECT * FROM record_versions WHERE person_slug = ? ORDER BY id DESC"
  ).all(personSlug);
}

export function latestAnchored(db, personSlug) {
  return db.prepare(
    "SELECT * FROM record_versions WHERE person_slug = ? AND status = 'anchored' ORDER BY id DESC LIMIT 1"
  ).get(personSlug);
}

export function addAuthor(db, { name, credential, wallet }) {
  const r = db.prepare(
    "INSERT INTO authors (name, credential, wallet) VALUES (?, ?, ?)"
  ).run(name, credential, wallet);
  return Number(r.lastInsertRowid);
}

export function getAuthor(db, id) {
  return db.prepare("SELECT * FROM authors WHERE id = ?").get(id);
}

export function listAuthors(db) {
  return db.prepare("SELECT * FROM authors ORDER BY id").all();
}
```

- [x] **Step 4: 통과 확인**

Run: `npm test`
Expected: 9 passing (canonical 5 + db 4)

- [x] **Step 5: 커밋**

```bash
git add server/src/db.js server/test/db.test.js
git commit -m "feat: node:sqlite 스키마와 쿼리 레이어"
```

---

### Task 5: Express 조회 페이지 (목록·상세·작성자)

**Files:**
- Create: `server/src/app.js`, `server/src/server.js`
- Create: `server/src/views/index.ejs`, `server/src/views/person.ejs`, `server/src/views/authors.ejs`, `server/src/views/partials/head.ejs`, `server/src/views/partials/person-rows.ejs`
- Test: `server/test/app.test.js`

**Interfaces:**
- Consumes: Task 4의 db.js 전체, Task 3의 canonical.js
- Produces: `createApp(db, config) -> express app` — `config = { rpcUrl, contract }`. 라우트: `GET /`(목록+검색, htmx 부분 렌더), `GET /persons/:slug`(상세), `GET /authors`(작성자 목록). `server.js`는 env(`DB_PATH`, `PORT`, `RPC_URL`, `CONTRACT_ADDRESS`)로 실행하는 진입점

- [x] **Step 1: 실패하는 테스트 작성**

`server/test/app.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.js";
import { openDb, upsertPerson, addAuthor } from "../src/db.js";

function makeServer(t) {
  const db = openDb();
  upsertPerson(db, {
    slug: "kim-gu", name: "김구", category: "independence",
    birth: "1876", death: "1949", summary: "대한민국 임시정부 주석",
  });
  addAuthor(db, { name: "홍역사", credential: "사학과 교수", wallet: "0xABC" });
  const app = createApp(db, { rpcUrl: "http://127.0.0.1:8545", contract: "0x0" });
  const server = app.listen(0);
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, db };
}

test("목록 페이지가 인물을 보여준다", async (t) => {
  const { base } = makeServer(t);
  const res = await fetch(base + "/");
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /김구/);
});

test("검색 쿼리가 필터링한다 (htmx 부분 렌더 포함)", async (t) => {
  const { base } = makeServer(t);
  const full = await (await fetch(base + "/?q=없는사람")).text();
  assert.doesNotMatch(full, /김구/);
  const partial = await (
    await fetch(base + "/?q=김", { headers: { "HX-Request": "true" } })
  ).text();
  assert.match(partial, /김구/);
  assert.doesNotMatch(partial, /<html/);
});

test("상세 페이지가 요약과 검증 버튼을 보여준다", async (t) => {
  const { base } = makeServer(t);
  const html = await (await fetch(base + "/persons/kim-gu")).text();
  assert.match(html, /임시정부 주석/);
  assert.match(html, /verify-btn/);
});

test("없는 인물은 404", async (t) => {
  const { base } = makeServer(t);
  assert.equal((await fetch(base + "/persons/nope")).status, 404);
});

test("작성자 목록이 실명과 자격을 공개한다", async (t) => {
  const { base } = makeServer(t);
  const html = await (await fetch(base + "/authors")).text();
  assert.match(html, /홍역사/);
  assert.match(html, /사학과 교수/);
});
```

- [x] **Step 2: 실패 확인**

Run: `npm test`
Expected: app.test.js FAIL — `Cannot find module .../src/app.js`

- [x] **Step 3: 구현**

`server/src/app.js`:

```js
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as q from "./db.js";

const DIR = path.dirname(fileURLToPath(import.meta.url));

export const CATEGORIES = {
  independence: "독립운동가",
  korean_war: "6·25 참전용사",
  cheonan: "천안함",
  yeonpyeong: "연평도",
};

export function createApp(db, config = {}) {
  const app = express();
  app.set("view engine", "ejs");
  app.set("views", path.join(DIR, "views"));
  app.use(express.static(path.join(DIR, "..", "public")));
  app.use(express.urlencoded({ extended: false }));
  app.use(express.json());

  const chain = {
    rpcUrl: config.rpcUrl ?? "http://127.0.0.1:8545",
    contract: config.contract ?? "",
  };

  app.get("/", (req, res) => {
    const persons = q.listPersons(db, { q: req.query.q, category: req.query.category });
    if (req.get("HX-Request")) {
      return res.render("partials/person-rows", { persons, CATEGORIES });
    }
    res.render("index", {
      persons, CATEGORIES,
      query: req.query.q ?? "", category: req.query.category ?? "",
    });
  });

  app.get("/persons/:slug", (req, res) => {
    const person = q.getPerson(db, req.params.slug);
    if (!person) return res.status(404).send("인물을 찾을 수 없습니다");
    res.render("person", {
      person, CATEGORIES, chain,
      sources: q.listSources(db, person.slug),
      versions: q.listVersions(db, person.slug),
    });
  });

  app.get("/authors", (req, res) => {
    res.render("authors", { authors: q.listAuthors(db) });
  });

  return app;
}
```

`server/src/server.js`:

```js
import { openDb } from "./db.js";
import { createApp } from "./app.js";

const db = openDb(process.env.DB_PATH ?? "data/ledger.db");
const app = createApp(db, {
  rpcUrl: process.env.RPC_URL ?? "http://127.0.0.1:8545",
  contract: process.env.CONTRACT_ADDRESS ?? "",
});
const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => console.log(`memorial-ledger: http://localhost:${port}`));
```

`server/src/views/partials/head.ejs`:

```html
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>기억 원장</title>
<script src="/vendor/htmx.min.js"></script>
<style>
  body { font-family: sans-serif; max-width: 52rem; margin: 2rem auto; padding: 0 1rem; }
  table { border-collapse: collapse; width: 100%; }
  td, th { border-bottom: 1px solid #ddd; padding: .5rem; text-align: left; }
  .badge { padding: .15rem .5rem; border-radius: .5rem; font-size: .85rem; }
  .ok { background: #e6f4ea; } .warn { background: #fdecea; }
  nav a { margin-right: 1rem; }
</style>
```

`server/src/views/partials/person-rows.ejs`:

```html
<% for (const p of persons) { %>
<tr>
  <td><a href="/persons/<%= p.slug %>"><%= p.name %></a></td>
  <td><%= CATEGORIES[p.category] ?? p.category %></td>
  <td><%= p.birth %>–<%= p.death %></td>
</tr>
<% } %>
<% if (persons.length === 0) { %>
<tr><td colspan="3">결과가 없습니다</td></tr>
<% } %>
```

`server/src/views/index.ejs`:

```html
<!doctype html>
<html lang="ko">
<head><%- include("partials/head") %></head>
<body>
<nav><a href="/">인물 목록</a><a href="/authors">작성자</a><a href="/persons/new/edit">기록 등록</a></nav>
<h1>기억 원장</h1>
<form>
  <input type="search" name="q" value="<%= query %>" placeholder="이름 검색"
         hx-get="/" hx-trigger="input changed delay:300ms" hx-target="#rows">
  <select name="category" hx-get="/" hx-target="#rows">
    <option value="">전체 분류</option>
    <% for (const [k, label] of Object.entries(CATEGORIES)) { %>
    <option value="<%= k %>" <%= k === category ? "selected" : "" %>><%= label %></option>
    <% } %>
  </select>
</form>
<table>
  <thead><tr><th>이름</th><th>분류</th><th>생몰</th></tr></thead>
  <tbody id="rows"><%- include("partials/person-rows", { persons, CATEGORIES }) %></tbody>
</table>
</body>
</html>
```

`server/src/views/person.ejs`:

```html
<!doctype html>
<html lang="ko">
<head><%- include("partials/head") %></head>
<body>
<nav><a href="/">인물 목록</a><a href="/authors">작성자</a></nav>
<h1><%= person.name %></h1>
<p><%= CATEGORIES[person.category] ?? person.category %> · <%= person.birth %>–<%= person.death %></p>
<p><%= person.summary %></p>

<h2>출처</h2>
<ul>
  <% for (const s of sources) { %>
  <li><% if (s.url) { %><a href="<%= s.url %>" rel="noopener"><%= s.label %></a><% } else { %><%= s.label %><% } %></li>
  <% } %>
</ul>

<h2>체인 검증</h2>
<button id="verify-btn"
        data-slug="<%= person.slug %>"
        data-rpc-url="<%= chain.rpcUrl %>"
        data-contract="<%= chain.contract %>">최신 기록 검증</button>
<p id="verify-result"></p>

<h2>버전 이력</h2>
<table>
  <thead><tr><th>버전</th><th>해시</th><th>상태</th><th>tx</th><th>등록 시각</th></tr></thead>
  <tbody>
  <% for (const v of versions) { %>
  <tr>
    <td>#<%= v.id %></td>
    <td><code><%= v.content_hash.slice(0, 18) %>…</code></td>
    <td><span class="badge <%= v.status === "anchored" ? "ok" : "warn" %>"><%= v.status %></span></td>
    <td><% if (v.tx_hash) { %><code><%= v.tx_hash.slice(0, 14) %>…</code><% } %></td>
    <td><%= v.created_at %></td>
  </tr>
  <% } %>
  </tbody>
</table>
<p><a href="/persons/<%= person.slug %>/edit">이 기록 수정하기 (작성자 전용)</a></p>

<script src="/vendor/ethers.umd.min.js"></script>
<script type="module" src="/verify.js"></script>
</body>
</html>
```

`server/src/views/authors.ejs`:

```html
<!doctype html>
<html lang="ko">
<head><%- include("partials/head") %></head>
<body>
<nav><a href="/">인물 목록</a><a href="/authors">작성자</a></nav>
<h1>작성자 (실명 공개)</h1>
<p>이 원장의 기록은 아래 검증된 실명 작성자만 등록할 수 있습니다.</p>
<table>
  <thead><tr><th>이름</th><th>자격</th><th>지갑 주소</th></tr></thead>
  <tbody>
  <% for (const a of authors) { %>
  <tr><td><%= a.name %></td><td><%= a.credential %></td><td><code><%= a.wallet %></code></td></tr>
  <% } %>
  </tbody>
</table>
</body>
</html>
```

참고: `person.ejs`가 참조하는 `/verify.js`는 Task 7에서 만든다. 파일이 없어도 페이지는 렌더되므로 이 태스크의 테스트는 통과한다. `/persons/new/edit` 링크 대상은 Task 6.

- [x] **Step 4: 통과 확인**

Run: `npm test`
Expected: 14 passing

- [x] **Step 5: 수동 확인**

```bash
cd server && node src/server.js
```

브라우저에서 `http://localhost:3000` — 빈 목록, 검색창, 작성자 페이지가 뜨는지 확인 후 Ctrl-C.

- [x] **Step 6: 커밋**

```bash
git add server/src server/test/app.test.js
git commit -m "feat: 조회 웹 - 목록/검색(htmx)/상세/작성자 페이지"
```

---

### Task 6: 작성 플로우 — draft 생성, 앵커 페이지, wallet.js

**Files:**
- Modify: `server/src/app.js` (라우트 추가)
- Create: `server/src/views/edit.ejs`, `server/src/views/anchor.ejs`
- Create: `server/public/wallet.js`
- Test: `server/test/app.test.js` (append)

**Interfaces:**
- Consumes: Task 4 `createDraft`/`markAnchored`/`upsertPerson`/`listSources`, Task 3 `canonicalize`, Task 2 컨트랙트 `anchor(bytes32,bytes32)`
- Produces:
  - `GET /persons/:slug/edit` — 기록 폼 (`:slug`가 `new`면 신규 등록 폼)
  - `POST /persons` — 폼 제출 → person upsert + 정본 JSON/해시 계산 + draft 생성 → `/versions/:id/anchor`로 redirect
  - `GET /versions/:id/anchor` — 해시와 MetaMask 앵커 버튼 페이지
  - `POST /versions/:id/anchored` — body `{txHash, wallet}` → status를 anchored로 전이. txHash는 `/^0x[0-9a-fA-F]{64}$/` 검증
  - 정본 content 스키마: `{slug, name, category, birth, death, summary, sources:[{label, url}]}` (draft 시점 DB 스냅샷)

- [x] **Step 1: 실패하는 테스트 추가**

`server/test/app.test.js`에 append:

```js
import { canonicalize } from "../public/canonical.js";
import { ethers } from "ethers";
import { listVersions, latestAnchored } from "../src/db.js";

test("폼 제출이 person을 저장하고 올바른 해시의 draft를 만든다", async (t) => {
  const { base, db } = makeServer(t);
  const body = new URLSearchParams({
    slug: "an-junggeun", name: "안중근", category: "independence",
    birth: "1879", death: "1910", summary: "하얼빈 의거",
  });
  const res = await fetch(base + "/persons", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body, redirect: "manual",
  });
  assert.equal(res.status, 302);
  const versions = listVersions(db, "an-junggeun");
  assert.equal(versions.length, 1);
  assert.equal(versions[0].status, "draft");
  const content = JSON.parse(versions[0].content_json);
  assert.equal(content.name, "안중근");
  const expected = ethers.keccak256(ethers.toUtf8Bytes(canonicalize(content)));
  assert.equal(versions[0].content_hash, expected);
  assert.match(res.headers.get("location"), /\/versions\/\d+\/anchor$/);
});

test("anchored 콜백이 상태를 전이시키고, 잘못된 txHash는 거부한다", async (t) => {
  const { base, db } = makeServer(t);
  const body = new URLSearchParams({
    slug: "kim-gu", name: "김구", category: "independence",
    birth: "1876", death: "1949", summary: "대한민국 임시정부 주석",
  });
  await fetch(base + "/persons", { method: "POST", body, redirect: "manual" });
  const [draft] = listVersions(db, "kim-gu");

  const bad = await fetch(`${base}/versions/${draft.id}/anchored`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ txHash: "nope", wallet: "0xABC" }),
  });
  assert.equal(bad.status, 400);

  const ok = await fetch(`${base}/versions/${draft.id}/anchored`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ txHash: "0x" + "ab".repeat(32), wallet: "0xABC" }),
  });
  assert.equal(ok.status, 200);
  assert.equal(latestAnchored(db, "kim-gu").content_hash, draft.content_hash);
});

test("필수 필드가 빠지면 400", async (t) => {
  const { base } = makeServer(t);
  const res = await fetch(base + "/persons", {
    method: "POST",
    body: new URLSearchParams({ slug: "", name: "", category: "independence" }),
  });
  assert.equal(res.status, 400);
});
```

- [x] **Step 2: 실패 확인**

Run: `npm test`
Expected: 새 3개 FAIL (POST /persons가 404)

- [x] **Step 3: 라우트 구현**

`server/src/app.js` 상단 import에 추가:

```js
import { ethers } from "ethers";
import { canonicalize } from "../public/canonical.js";
```

`createApp` 안, `app.get("/authors", ...)` 아래에 추가:

```js
  // ponytail: draft 작성에 서버 로그인 없음 — 진짜 게이트는 온체인 allowlist
  // (미등록 지갑은 anchor 트랜잭션이 revert). 서버 세션 인증은 후속 작업.
  app.get("/persons/:slug/edit", (req, res) => {
    const isNew = req.params.slug === "new";
    const person = isNew ? null : q.getPerson(db, req.params.slug);
    if (!isNew && !person) return res.status(404).send("인물을 찾을 수 없습니다");
    res.render("edit", { person, CATEGORIES });
  });

  app.post("/persons", (req, res) => {
    const { slug, name, category, birth, death, summary } = req.body;
    if (!slug || !name || !CATEGORIES[category]) {
      return res.status(400).send("slug, 이름, 분류는 필수입니다");
    }
    q.upsertPerson(db, { slug, name, category, birth, death, summary });
    const content = {
      slug, name, category,
      birth: birth ?? "", death: death ?? "", summary: summary ?? "",
      sources: q.listSources(db, slug).map((s) => ({ label: s.label, url: s.url })),
    };
    const canonical = canonicalize(content);
    const contentHash = ethers.keccak256(ethers.toUtf8Bytes(canonical));
    const versionId = q.createDraft(db, { personSlug: slug, contentJson: canonical, contentHash });
    res.redirect(`/versions/${versionId}/anchor`);
  });

  app.get("/versions/:id/anchor", (req, res) => {
    const v = db.prepare("SELECT * FROM record_versions WHERE id = ?").get(req.params.id);
    if (!v) return res.status(404).send("버전을 찾을 수 없습니다");
    res.render("anchor", { v, chain, personIdHex: ethers.id(v.person_slug) });
  });

  app.post("/versions/:id/anchored", (req, res) => {
    const { txHash, wallet } = req.body ?? {};
    if (!/^0x[0-9a-fA-F]{64}$/.test(txHash ?? "")) {
      return res.status(400).json({ error: "잘못된 txHash" });
    }
    const v = db.prepare("SELECT * FROM record_versions WHERE id = ?").get(req.params.id);
    if (!v) return res.status(404).json({ error: "버전 없음" });
    q.markAnchored(db, { versionId: Number(req.params.id), txHash, wallet });
    res.json({ ok: true });
  });
```

- [x] **Step 4: 뷰 작성**

`server/src/views/edit.ejs`:

```html
<!doctype html>
<html lang="ko">
<head><%- include("partials/head") %></head>
<body>
<nav><a href="/">인물 목록</a></nav>
<h1><%= person ? `${person.name} 기록 수정` : "새 인물 기록 등록" %></h1>
<form method="post" action="/persons">
  <p><label>슬러그(영문 id) <input name="slug" required
     value="<%= person?.slug ?? "" %>" <%= person ? "readonly" : "" %>></label></p>
  <p><label>이름 <input name="name" required value="<%= person?.name ?? "" %>"></label></p>
  <p><label>분류
    <select name="category">
      <% for (const [k, label] of Object.entries(CATEGORIES)) { %>
      <option value="<%= k %>" <%= person?.category === k ? "selected" : "" %>><%= label %></option>
      <% } %>
    </select></label></p>
  <p><label>출생 <input name="birth" value="<%= person?.birth ?? "" %>"></label>
     <label>사망 <input name="death" value="<%= person?.death ?? "" %>"></label></p>
  <p><label>공적 요약<br>
     <textarea name="summary" rows="8" cols="60"><%= person?.summary ?? "" %></textarea></label></p>
  <button type="submit">정본 생성 → 앵커 단계로</button>
</form>
</body>
</html>
```

`server/src/views/anchor.ejs`:

```html
<!doctype html>
<html lang="ko">
<head><%- include("partials/head") %></head>
<body>
<nav><a href="/">인물 목록</a></nav>
<h1>체인 앵커링</h1>
<p>아래 해시를 등록된 작성자 지갑으로 서명해 체인에 기록합니다.</p>
<dl>
  <dt>인물</dt><dd><%= v.person_slug %></dd>
  <dt>contentHash</dt><dd><code><%= v.content_hash %></code></dd>
  <dt>상태</dt><dd><%= v.status %></dd>
</dl>
<button id="anchor-btn"
        data-contract="<%= chain.contract %>"
        data-person-id="<%= personIdHex %>"
        data-content-hash="<%= v.content_hash %>"
        data-version-id="<%= v.id %>"
        data-return-url="/persons/<%= v.person_slug %>">MetaMask로 앵커</button>
<p id="anchor-status"></p>
<script src="/vendor/ethers.umd.min.js"></script>
<script src="/wallet.js"></script>
</body>
</html>
```

`server/public/wallet.js`:

```js
// MetaMask로 anchor 트랜잭션을 서명하는 JS 섬. ethers는 UMD 전역.
const ABI = ["function anchor(bytes32 personId, bytes32 contentHash)"];

const btn = document.getElementById("anchor-btn");
btn?.addEventListener("click", async () => {
  const d = btn.dataset;
  const status = document.getElementById("anchor-status");
  try {
    if (!window.ethereum) throw new Error("MetaMask가 설치되어 있지 않습니다");
    const provider = new ethers.BrowserProvider(window.ethereum);
    await provider.send("eth_requestAccounts", []);
    const signer = await provider.getSigner();
    const contract = new ethers.Contract(d.contract, ABI, signer);
    status.textContent = "지갑 서명 대기 중…";
    const tx = await contract.anchor(d.personId, d.contentHash);
    status.textContent = "트랜잭션 컨펌 대기 중…";
    await tx.wait();
    await fetch(`/versions/${d.versionId}/anchored`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ txHash: tx.hash, wallet: await signer.getAddress() }),
    });
    location.href = d.returnUrl;
  } catch (e) {
    status.textContent = `실패: ${e.shortMessage ?? e.message}`;
  }
});
```

- [x] **Step 5: 통과 확인**

Run: `npm test`
Expected: 17 passing

- [x] **Step 6: 커밋**

```bash
git add server/src server/public/wallet.js server/test/app.test.js
git commit -m "feat: 작성 플로우 - draft 생성, 앵커 페이지, MetaMask wallet.js"
```

---

### Task 7: 검증 — latest.json 엔드포인트 + verify.js

**Files:**
- Modify: `server/src/app.js` (엔드포인트 1개 추가)
- Create: `server/public/verify.js`
- Test: `server/test/app.test.js` (append)

**Interfaces:**
- Consumes: Task 4 `latestAnchored`, Task 2 `latest(bytes32)`, Task 3 `canonicalize`
- Produces: `GET /persons/:slug/latest.json` → `{content, contentHash, txHash}` (앵커된 버전 없으면 404). `verify.js`는 이 JSON을 브라우저에서 재해싱해 온체인 `latest()`와 비교

- [x] **Step 1: 실패하는 테스트 추가**

`server/test/app.test.js`에 append:

```js
import { createDraft, markAnchored as dbMarkAnchored } from "../src/db.js";

test("latest.json은 앵커된 최신 버전만 준다", async (t) => {
  const { base, db } = makeServer(t);
  assert.equal((await fetch(base + "/persons/kim-gu/latest.json")).status, 404);
  const id = createDraft(db, {
    personSlug: "kim-gu",
    contentJson: '{"name":"김구"}',
    contentHash: "0x" + "cd".repeat(32),
  });
  dbMarkAnchored(db, { versionId: id, txHash: "0x" + "ef".repeat(32), wallet: "0xABC" });
  const res = await fetch(base + "/persons/kim-gu/latest.json");
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.content.name, "김구");
  assert.equal(body.contentHash, "0x" + "cd".repeat(32));
  assert.equal(body.txHash, "0x" + "ef".repeat(32));
});
```

- [x] **Step 2: 실패 확인**

Run: `npm test`
Expected: 새 1개 FAIL (404 대신 200을 기대하는 분기에서 실패 — 라우트 자체가 없어 모두 404)

- [x] **Step 3: 구현**

`server/src/app.js`의 `app.get("/persons/:slug", ...)` **위에** 추가 (라우트 매칭 순서 주의):

```js
  app.get("/persons/:slug/latest.json", (req, res) => {
    const v = q.latestAnchored(db, req.params.slug);
    if (!v) return res.status(404).json({ error: "앵커된 버전이 없습니다" });
    res.json({
      content: JSON.parse(v.content_json),
      contentHash: v.content_hash,
      txHash: v.tx_hash,
    });
  });
```

`server/public/verify.js`:

```js
// 체인 검증 JS 섬: 서버가 준 기록을 브라우저에서 재해싱해 온체인 해시와 비교.
// 서버를 신뢰하지 않아도 되는 것이 목적이므로 반드시 클라이언트에서 실행한다.
import { canonicalize } from "/canonical.js";

const ABI = ["function latest(bytes32) view returns (bytes32, address, uint64)"];

const btn = document.getElementById("verify-btn");
btn?.addEventListener("click", async () => {
  const d = btn.dataset;
  const out = document.getElementById("verify-result");
  out.textContent = "검증 중…";
  try {
    const res = await fetch(`/persons/${d.slug}/latest.json`);
    if (!res.ok) throw new Error("앵커된 버전이 없습니다");
    const { content } = await res.json();
    const localHash = ethers.keccak256(ethers.toUtf8Bytes(canonicalize(content)));
    const provider = new ethers.JsonRpcProvider(d.rpcUrl);
    const contract = new ethers.Contract(d.contract, ABI, provider);
    const [chainHash, author, ts] = await contract.latest(ethers.id(d.slug));
    if (chainHash === localHash) {
      const when = new Date(Number(ts) * 1000).toLocaleString("ko-KR");
      out.innerHTML = `<span class="badge ok">✔ 변조 없음</span> ${when} 앵커 · 작성자 <code>${author}</code>`;
    } else {
      out.innerHTML = `<span class="badge warn">✖ 해시 불일치</span> 오프체인 기록이 체인과 다릅니다`;
    }
  } catch (e) {
    out.textContent = `검증 실패: ${e.shortMessage ?? e.message}`;
  }
});
```

- [x] **Step 4: 통과 확인**

Run: `npm test`
Expected: 18 passing

- [x] **Step 5: 커밋**

```bash
git add server/src/app.js server/public/verify.js server/test/app.test.js
git commit -m "feat: 체인 검증 - latest.json 엔드포인트와 브라우저 verify.js"
```

---

### Task 8: 배포·시드 스크립트 + E2E + README

**Files:**
- Create: `contracts/scripts/deploy.js`, `server/scripts/seed.js`, `README.md`
- Test: `server/test/e2e.test.js`

**Interfaces:**
- Consumes: 지금까지의 전부
- Produces: 로컬 실행 절차 일체. E2E는 hardhat node를 띄워 "등록 → 앵커 → latest.json → 재해싱 → 온체인 비교"의 전체 루프를 MetaMask 없이 검증

- [x] **Step 1: 배포 스크립트**

`contracts/scripts/deploy.js`:

```js
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
```

- [x] **Step 2: 시드 스크립트**

`server/scripts/seed.js`:

```js
import { openDb, upsertPerson, addSource, addAuthor } from "../src/db.js";

const db = openDb(process.env.DB_PATH ?? "data/ledger.db");

const PERSONS = [
  { slug: "kim-gu", name: "김구", category: "independence", birth: "1876", death: "1949",
    summary: "대한민국 임시정부 주석. 한인애국단을 조직해 항일 의거를 이끌었다." },
  { slug: "an-junggeun", name: "안중근", category: "independence", birth: "1879", death: "1910",
    summary: "1909년 하얼빈에서 이토 히로부미를 저격한 독립운동가. 동양평화론을 저술했다." },
  { slug: "yu-gwansun", name: "유관순", category: "independence", birth: "1902", death: "1920",
    summary: "3·1 운동의 상징적 인물. 아우내 장터 만세운동을 주도하고 옥중에서 순국했다." },
  { slug: "yun-bonggil", name: "윤봉길", category: "independence", birth: "1908", death: "1932",
    summary: "1932년 상하이 훙커우 공원 의거를 결행한 한인애국단 단원." },
  { slug: "an-changho", name: "안창호", category: "independence", birth: "1878", death: "1938",
    summary: "흥사단을 창립한 독립운동가이자 교육자. 임시정부 내무총장을 지냈다." },
];

for (const p of PERSONS) {
  upsertPerson(db, p);
  addSource(db, {
    personSlug: p.slug,
    label: "국가보훈부 공훈전자사료관",
    url: "https://e-gonghun.mpva.go.kr/",
  });
}

// hardhat 로컬 계정 #1 — contracts/scripts/deploy.js가 온체인에도 등록하는 지갑
addAuthor(db, {
  name: "로컬 테스트 작성자",
  credential: "개발용 (hardhat account #1)",
  wallet: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
});

console.log(`시드 완료: 인물 ${PERSONS.length}명, 작성자 1명`);
```

Run: `cd server && node scripts/seed.js`
Expected: `시드 완료: 인물 5명, 작성자 1명` (재실행해도 upsert라 안전. authors는 UNIQUE 제약으로 재실행 시 에러 — 무시하고 넘어가도 됨)

- [ ] **Step 3: E2E 테스트 작성**

`server/test/e2e.test.js`:

```js
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
  const provider = new ethers.JsonRpcProvider(RPC);
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
```

- [ ] **Step 4: E2E 실행**

Run: `cd server && node --test test/e2e.test.js`
Expected: 1 passing (2~3분 소요 가능)

- [x] **Step 5: README 작성**

`README.md`:

```markdown
# memorial-ledger (기억 원장)

독립운동가·참전용사 등 인물 기록을 오프체인(SQLite)에 저장하고, 기록의
keccak256 해시를 체인(RecordRegistry)에 앵커링하는 학습 프로젝트.
누구나 브라우저에서 서버를 신뢰하지 않고 기록의 변조 여부를 검증할 수 있다.

설계 문서: `docs/superpowers/specs/2026-08-01-record-registry-design.md`

## 요구 사항

- Node 24+ (node:sqlite, node:test)
- MetaMask (기록 작성 시)

## 로컬 실행

```bash
# 1. 체인
cd contracts && npm install
npx hardhat node                                  # 터미널 1
npx hardhat run scripts/deploy.js --network localhost  # 터미널 2 — 주소 출력

# 2. 서버
cd ../server && npm install
node scripts/seed.js
CONTRACT_ADDRESS=<배포 주소> node src/server.js   # http://localhost:3000
```

기록 작성 테스트: MetaMask에 hardhat 계정 #1
(`0x59c6...690d`, 로컬 전용 공개 키)을 임포트하고 네트워크를
`http://127.0.0.1:8545` (chainId 31337)로 추가.

## 테스트

```bash
cd contracts && npx hardhat test   # 컨트랙트
cd server && npm test              # 서버 단위 + E2E
```

## Sepolia 배포

```bash
cd contracts
SEPOLIA_RPC_URL=<rpc> PRIVATE_KEY=<key> npx hardhat run scripts/deploy.js --network sepolia
```
```

- [ ] **Step 6: 전체 테스트 + 커밋**

Run: `cd contracts && npx hardhat test && cd ../server && npm test`
Expected: 컨트랙트 8 passing, 서버 19 passing (E2E 포함)

```bash
git add contracts/scripts server/scripts server/test/e2e.test.js README.md
git commit -m "feat: 배포/시드 스크립트, E2E 테스트, README"
```
