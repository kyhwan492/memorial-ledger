# Donations + Import v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 온체인 직접 후원(Donations 컨트랙트 + 웹 후원 섹션)과 공훈록 API 임포트 스크립트를 추가한다.

**Architecture:** 기존 구조 유지. `contracts/`에 Donations.sol 추가(무보관 즉시 전달), `server/public/donate.js` JS 섬 추가(후원 내역은 브라우저가 체인 이벤트를 직접 조회), `server/scripts/import-gonghun.js` 추가.

**Tech Stack:** v1과 동일. spec: `docs/superpowers/specs/2026-08-02-donations-and-import-design.md`

## Global Constraints

- v1 플랜의 Global Constraints 전부 유지 (Node 24+, 브라우저 JS 섬 원칙, 한국어 UI, Co-Authored-By 금지)
- 후원 내역·수혜자 정보는 서버 DB에 저장하지 않는다 — 체인이 유일한 소스
- ~~API 키는 `GONGHUN_API_KEY` env로만~~ → 구현 중 실호출로 확인: 공훈록 엔드포인트는 키 불필요 (리뷰 iteration 2에서 키 게이트 제거)

---

### Task D1: Donations 컨트랙트 (TDD)

**Files:**
- Create: `contracts/contracts/Donations.sol`
- Test: `contracts/test/Donations.test.js`

**Interfaces:**
- Produces: `Donations` — `owner()`, `beneficiaries(bytes32) view returns (address)`, `totalDonated(bytes32) view returns (uint256)`, `registerBeneficiary(bytes32 personId, address payable to, string profileUri)` (onlyOwner, zero주소 revert "zero address", 빈 profileUri revert "empty profile"), `donate(bytes32 personId) payable` (수혜자 없으면 revert "no beneficiary", 0원 revert "zero amount", 전액 즉시 전달, 실패 시 revert "transfer failed"), 이벤트 `BeneficiaryRegistered(bytes32 indexed personId, address beneficiary, string profileUri)`, `Donated(bytes32 indexed personId, address indexed donor, uint256 amount)`

- [x] **Step 1: 실패하는 테스트 작성**

`contracts/test/Donations.test.js`:

```js
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
```

- [x] **Step 2: 실패 확인** — Run: `cd contracts && npx hardhat test test/Donations.test.js` / Expected: HH700 (Donations.sol 없음)

- [x] **Step 3: 구현**

`contracts/contracts/Donations.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// 무보관 후원: 받은 즉시 수혜자에게 전액 전달한다. 컨트랙트에 잔고가 머물지 않는다.
contract Donations {
    address public owner;
    mapping(bytes32 => address payable) public beneficiaries;
    mapping(bytes32 => uint256) public totalDonated;

    event BeneficiaryRegistered(bytes32 indexed personId, address beneficiary, string profileUri);
    event Donated(bytes32 indexed personId, address indexed donor, uint256 amount);

    constructor() {
        owner = msg.sender;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    function registerBeneficiary(bytes32 personId, address payable to, string calldata profileUri)
        external onlyOwner
    {
        require(to != address(0), "zero address");
        require(bytes(profileUri).length != 0, "empty profile");
        beneficiaries[personId] = to;
        emit BeneficiaryRegistered(personId, to, profileUri);
    }

    function donate(bytes32 personId) external payable {
        address payable to = beneficiaries[personId];
        require(to != address(0), "no beneficiary");
        require(msg.value > 0, "zero amount");
        totalDonated[personId] += msg.value;
        emit Donated(personId, msg.sender, msg.value);
        (bool ok, ) = to.call{value: msg.value}("");
        require(ok, "transfer failed");
    }
}
```

- [x] **Step 4: 통과 확인** — Run: `npx hardhat test` / Expected: 12 passing (기존 8 + 신규 4)

- [x] **Step 5: 커밋** — `git add contracts && git commit -m "feat: Donations 컨트랙트 - 무보관 즉시 전달 후원"`

---

### Task D2: 웹 후원 섹션 + donate.js + 배포 스크립트 갱신

**Files:**
- Modify: `contracts/scripts/deploy.js` (Donations 배포 + 데모 수혜자 등록 추가)
- Modify: `server/src/app.js` (config.donations 주소 전달)
- Modify: `server/src/server.js` (`DONATIONS_ADDRESS` env)
- Modify: `server/src/views/person.ejs` (후원 섹션)
- Create: `server/public/donate.js`
- Test: `server/test/app.test.js` (append 1)

**Interfaces:**
- Consumes: Task D1의 Donations ABI, 기존 chain config 패턴 (app.js의 `chain` 객체)
- Produces: person.ejs에 `#donate-section`(data-donations, data-person-id, data-rpc-url, data-slug), donate.js가 누적액·내역 로드 + MetaMask 후원

- [x] **Step 1: 실패하는 테스트 추가** — app.test.js append:

```js
test("인물 페이지에 후원 섹션이 있다", async (t) => {
  const { base } = makeServer(t);
  const html = await (await fetch(base + "/persons/kim-gu")).text();
  assert.match(html, /donate-section/);
});
```

Run: `cd server && npm test` → 신규 1개 FAIL 확인.

- [x] **Step 2: app.js/server.js 수정**

`createApp`의 chain 객체를 `{ rpcUrl, contract, donations: config.donations ?? "" }`로 확장. `server.js`에서 `donations: process.env.DONATIONS_ADDRESS ?? ""` 전달.

- [x] **Step 3: person.ejs 후원 섹션** — "버전 이력" 위에 추가:

```html
<h2>후원</h2>
<div id="donate-section"
     data-donations="<%= chain.donations %>"
     data-person-id="<%= personIdHex %>"
     data-rpc-url="<%= chain.rpcUrl %>">
  <p id="donate-status">후원 정보를 불러오는 중…</p>
  <p><input id="donate-amount" type="number" step="0.001" min="0" placeholder="ETH">
     <button id="donate-btn">MetaMask로 후원</button></p>
  <ul id="donate-history"></ul>
</div>
<script type="module" src="/donate.js"></script>
```

라우트에서 `personIdHex: ethers.id(person.slug)`를 person.ejs 렌더에 추가로 전달.

- [x] **Step 4: donate.js**

```js
// 후원 JS 섬: 수혜자·누적액·내역을 체인에서 직접 읽고(무신뢰), MetaMask로 후원한다.
const ABI = [
  "function beneficiaries(bytes32) view returns (address)",
  "function totalDonated(bytes32) view returns (uint256)",
  "function donate(bytes32) payable",
  "event Donated(bytes32 indexed personId, address indexed donor, uint256 amount)",
];

const section = document.getElementById("donate-section");
const status = document.getElementById("donate-status");
const history = document.getElementById("donate-history");

async function load() {
  const d = section.dataset;
  if (!d.donations) { status.textContent = "후원 컨트랙트가 설정되지 않았습니다"; return; }
  const provider = new ethers.JsonRpcProvider(d.rpcUrl);
  const c = new ethers.Contract(d.donations, ABI, provider);
  const to = await c.beneficiaries(d.personId);
  if (to === ethers.ZeroAddress) {
    status.textContent = "아직 검증된 수혜자가 등록되지 않았습니다";
    document.getElementById("donate-btn").disabled = true;
    return;
  }
  const total = await c.totalDonated(d.personId);
  status.innerHTML = `수혜자 <code>${to}</code> · 누적 ${ethers.formatEther(total)} ETH`;
  const events = await c.queryFilter(c.filters.Donated(d.personId), 0, "latest");
  history.innerHTML = events.slice(-20).reverse().map((e) =>
    `<li><code>${e.args.donor}</code> → ${ethers.formatEther(e.args.amount)} ETH</li>`
  ).join("");
}

document.getElementById("donate-btn")?.addEventListener("click", async () => {
  const d = section.dataset;
  const amount = document.getElementById("donate-amount").value;
  try {
    if (!window.ethereum) throw new Error("MetaMask가 설치되어 있지 않습니다");
    if (!amount || Number(amount) <= 0) throw new Error("금액을 입력하세요");
    const provider = new ethers.BrowserProvider(window.ethereum);
    await provider.send("eth_requestAccounts", []);
    const signer = await provider.getSigner();
    const c = new ethers.Contract(d.donations, ABI, signer);
    status.textContent = "서명 대기 중…";
    const tx = await c.donate(d.personId, { value: ethers.parseEther(amount) });
    status.textContent = "컨펌 대기 중…";
    await tx.wait();
    await load();
  } catch (e) {
    status.textContent = `실패: ${e.shortMessage ?? e.message}`;
  }
});

load().catch((e) => { status.textContent = `로드 실패: ${e.shortMessage ?? e.message}`; });
```

주의: person.ejs는 이미 ethers UMD를 로드한다(verify.js용) — donate.js도 그 전역을 쓴다.

- [x] **Step 5: deploy.js 갱신** — Donations 배포 + 로컬 데모용으로 hardhat 계정 #2를 kim-gu 수혜자로 등록(`ethers.id("kim-gu")`), 두 주소 모두 출력하고 서버 실행 안내에 `DONATIONS_ADDRESS=` 포함. Sepolia(계정 1개)에서는 수혜자 등록 스킵.

- [x] **Step 6: 통과 확인** — `npm test` → 21 passing. 수동: 로컬 스택 재기동 후 인물 페이지에서 후원 1건 실행, 내역 표시 확인.

- [x] **Step 7: 커밋**

---

### Task I1: 공훈록 임포트 스크립트

**Files:**
- Create: `server/scripts/import-gonghun.js`
- Create: `server/scripts/gonghun-map.js` (순수 매핑 함수)
- Test: `server/test/gonghun-map.test.js`

**Interfaces:**
- Consumes: db.js `openDb/upsertPerson/addSource`
- Produces: `mapRow(apiRow) -> {slug, name, category:"independence", birth, death, summary}` (gonghun-map.js), CLI `node scripts/import-gonghun.js [--limit 100] [--page 1]`

- [x] **Step 1: API 스펙 확인** — https://www.data.go.kr/data/15057718/openapi.do 문서(WebFetch/curl)에서 엔드포인트·요청 파라미터·응답 필드명을 확인해 매핑을 작성한다. 문서 접근이 안 되면 필드명을 추정하지 말고 리포트에 명시하고 매핑 함수를 TODO 없이 "문서 기반으로 확인된 필드만" 구현.

- [x] **Step 2: 매핑 함수 TDD** — 문서의 응답 예시를 픽스처로 `gonghun-map.test.js` 작성(실패 확인) → `gonghun-map.js` 구현(통과). slug는 `gonghun-<관리번호>`, 관리번호 없으면 이름+생년 조합. 출처는 공훈전자사료관(https://e-gonghun.mpva.go.kr/) 링크.

- [x] **Step 3: CLI 스크립트** — fetch로 API 호출(키 불필요 — 실호출 확인), 항상 고정 PAGE_SIZE로 페이지네이션(창 밀림 방지), `mapRow` 적용해 upsert, limit 도달 시 중단, `임포트 완료: N명` 출력. 네트워크 오류는 페이지 단위 재시도 1회.

- [x] **Step 4: 통과 확인** — `npm test` 그린(매핑 테스트 포함). 실제 API 호출은 키 발급 후 수동 검증(리포트에 명시).

- [x] **Step 5: 커밋**
