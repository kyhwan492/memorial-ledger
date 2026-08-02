# ERC-20 Donations v5 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Donations에 ERC-20 후원(donateToken, SafeERC20, 무보관 직접 전달)과 웹 토큰 선택 UI를 추가한다.

**Architecture:** spec `docs/superpowers/specs/2026-08-02-erc20-donations-design.md`. 두 레인 병렬: C(컨트랙트), W(웹). 인터페이스는 아래 Interfaces 블록이 계약이다.

## Global Constraints

- v1 Global Constraints 유지 (한국어 UI, Co-Authored-By 금지, 새 JS 섬 금지 — donate.js 확장만)
- 무보관 원칙: 토큰은 donor → beneficiary 직접 이동, 컨트랙트 잔고 잔류 금지
- CEI 순서 유지

---

### Task C: 컨트랙트 — donateToken + TestToken

**Files:**
- Modify: `contracts/contracts/Donations.sol`, `contracts/scripts/deploy.js`, `contracts/package.json` (`@openzeppelin/contracts` 추가)
- Create: `contracts/contracts/TestToken.sol`
- Test: `contracts/test/Donations.test.js` (append)

**Interfaces (웹 워커가 의존하는 계약):**
- `donateToken(bytes32 personId, address token, uint256 amount)` — 수혜자 미등록 revert "no beneficiary", 0 revert "zero amount", `SafeERC20.safeTransferFrom(donor→beneficiary)`
- `totalDonatedToken(bytes32, address) view returns (uint256)`
- `event DonatedToken(bytes32 indexed personId, address indexed donor, address indexed token, uint256 amount)`
- `TestToken` — OZ ERC20("Test KRW", "TKRW"), decimals 18, 생성자에서 배포자에게 1,000,000개 민트
- deploy.js — TestToken 배포, hardhat 계정 #3(`0x90F7...b906`)에 10,000 TKRW 전송(데모 후원자), 출력에 `TestToken(TKRW): <addr>`와 서버 실행 안내 `TOKENS='[{"symbol":"TKRW","address":"<addr>","decimals":18}]'` 포함. Sepolia에선 TestToken 배포 스킵.

- [ ] **Step 1: 실패하는 테스트 추가** — Donations.test.js append:

```js
describe("Donations: ERC-20", function () {
  async function tokenFixture() {
    const f = await registeredFixture();
    const token = await ethers.deployContract("TestToken");
    await token.transfer(f.donor.address, ethers.parseEther("1000"));
    return { ...f, token };
  }

  it("토큰 후원이 수혜자에게 직접 전달되고 이벤트·누적이 기록된다", async function () {
    const { donations, beneficiary, donor, token } = await loadFixture(tokenFixture);
    const amount = ethers.parseEther("100");
    await token.connect(donor).approve(await donations.getAddress(), amount * 2n);
    await expect(donations.connect(donor).donateToken(personId, await token.getAddress(), amount))
      .to.emit(donations, "DonatedToken")
      .withArgs(personId, donor.address, await token.getAddress(), amount);
    expect(await token.balanceOf(beneficiary.address)).to.equal(amount);
    expect(await token.balanceOf(await donations.getAddress())).to.equal(0n); // 무보관
    await donations.connect(donor).donateToken(personId, await token.getAddress(), amount);
    expect(await donations.totalDonatedToken(personId, await token.getAddress())).to.equal(amount * 2n);
  });

  it("수혜자 미등록/0수량/승인 없음은 거부된다", async function () {
    const { donations, donor, token } = await loadFixture(tokenFixture);
    const other = ethers.id("nobody");
    await expect(
      donations.connect(donor).donateToken(other, await token.getAddress(), 1n)
    ).to.be.revertedWith("no beneficiary");
    await expect(
      donations.connect(donor).donateToken(personId, await token.getAddress(), 0)
    ).to.be.revertedWith("zero amount");
    await expect(
      donations.connect(donor).donateToken(personId, await token.getAddress(), 1n)
    ).to.be.reverted; // approve 없음 — SafeERC20 revert
  });
});
```

- [ ] **Step 2: 실패 확인** — `cd contracts && npx hardhat test` → TestToken/donateToken 없음 에러
- [ ] **Step 3: 구현** — `npm i @openzeppelin/contracts`. TestToken.sol:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// 로컬 데모·테스트 전용 토큰
contract TestToken is ERC20 {
    constructor() ERC20("Test KRW", "TKRW") {
        _mint(msg.sender, 1_000_000 ether);
    }
}
```

Donations.sol에 추가 (import `SafeERC20`/`IERC20`):

```solidity
    using SafeERC20 for IERC20;

    mapping(bytes32 => mapping(address => uint256)) public totalDonatedToken;

    event DonatedToken(bytes32 indexed personId, address indexed donor, address indexed token, uint256 amount);

    function donateToken(bytes32 personId, address token, uint256 amount) external {
        address to = beneficiaries[personId];
        require(to != address(0), "no beneficiary");
        require(amount > 0, "zero amount");
        totalDonatedToken[personId][token] += amount;
        emit DonatedToken(personId, msg.sender, token, amount);
        IERC20(token).safeTransferFrom(msg.sender, to, amount);
    }
```

- [ ] **Step 4: deploy.js 갱신** (TestToken 로컬 배포·분배·TOKENS 안내, Sepolia 스킵 가드)
- [ ] **Step 5: 통과 확인** — `npx hardhat test` → 14 passing (기존 12 + 2)
- [ ] **Step 6: 커밋**

---

### Task W: 웹 — 토큰 선택 후원 UI

**Files:**
- Modify: `server/src/server.js`, `server/src/app.js`, `server/src/views/person.ejs`, `server/public/donate.js`
- Test: `server/test/app.test.js` (append 1)

**Interfaces:**
- Consumes: Task C의 `donateToken`/`totalDonatedToken`/`DonatedToken`(위 Interfaces 블록 — 코드가 아직 없어도 이 시그니처로 작성), ERC-20 표준 `approve`/`allowance`/`event Approval`
- Produces: `config.tokens` (env `TOKENS` JSON 파싱, 기본 `[]`, 파싱 실패 시 빈 배열 + console.error), person.ejs `#donate-section`에 `data-tokens='<%= JSON.stringify(chain.tokens) %>'`, donate.js 통화 선택 UI

- [ ] **Step 1: 실패하는 테스트 추가** — app.test.js append:

```js
test("donate-section이 설정된 토큰 목록을 노출한다", async (t) => {
  const db = openDb();
  upsertPerson(db, { slug: "kim-gu", name: "김구", category: "independence",
    birth: "1876", death: "1949", summary: "x" });
  const app = createApp(db, { rpcUrl: "http://127.0.0.1:8545", contract: "0x0",
    tokens: [{ symbol: "TKRW", address: "0x" + "aa".repeat(20), decimals: 18 }] });
  const server = app.listen(0);
  t.after(() => server.close());
  const html = await (await fetch(`http://127.0.0.1:${server.address().port}/persons/kim-gu`)).text();
  assert.match(html, /TKRW/);
});
```

- [ ] **Step 2: 실패 확인** — `npm test` → 신규 1개 FAIL
- [ ] **Step 3: 서버 구현** — server.js: `tokens: JSON.parse(process.env.TOKENS ?? "[]")` (try/catch → [] + console.error). app.js: chain 객체에 `tokens: config.tokens ?? []`. person.ejs: donate-section에 `data-tokens` 속성 + 통화 `<select id="donate-token">`(ETH 고정 옵션 + 토큰들 — 서버 렌더).
- [ ] **Step 4: donate.js 확장**
  - load(): ETH 누적/내역 기존 유지 + 각 설정 토큰의 `totalDonatedToken`·`DonatedToken` 이벤트 조회, `ethers.formatUnits(amount, decimals)`로 표시 (`누적 0.5 ETH · 1,000 TKRW` 식)
  - 후원 클릭: 선택 통화가 ETH면 기존 경로. 토큰이면 `parseUnits(amount, decimals)` → `allowance` 확인 → 부족하면 `approve` tx (버튼 문구 "1/2 승인 중…") → `donateToken` tx ("2/2 후원 중…") → load() 갱신
  - ERC-20 ABI 상수는 donate.js 안에 최소로(`approve`,`allowance`,`event Approval` 불필요 — allowance/approve만)
- [ ] **Step 5: 통과 확인** — `npm test` → 41 passing
- [ ] **Step 6: 커밋**
