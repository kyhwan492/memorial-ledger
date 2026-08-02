# Tracking + Change Requests + MCP v3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 변경 사유·diff·버전별 검증(트래킹), 실명 수정 요청 워크플로, MCP 서버를 추가한다.

**Architecture:** spec `docs/superpowers/specs/2026-08-02-tracking-requests-mcp-design.md`. db.js의 change_requests 쿼리와 `chainIndexOf`는 **이미 main에 merge됨** — 소비만 한다. 두 레인 병렬: T(웹 트래킹+요청), M(MCP).

## Global Constraints

- v1 Global Constraints 유지. UI 한국어, Co-Authored-By 금지, 브라우저 JS 섬 원칙(새 섬 추가 금지 — verify.js 확장만 허용)
- 기존 앵커 버전(note 없는 content)의 검증이 깨지면 안 된다 — content_json 재직렬화 금지
- MCP 도구 로직은 순수 핸들러(db, deps 인자)로 분리, MCP 래퍼는 얇게

---

### Task T: 트래킹(note·diff·버전별 검증) + 수정 요청 웹

**Files:**
- Modify: `server/src/app.js`, `server/src/views/edit.ejs`, `server/src/views/person.ejs`, `server/public/verify.js`
- Create: `server/src/views/diff.ejs`, `server/src/views/requests.ejs`, `server/src/views/request.ejs`, `server/src/views/request-new.ejs`
- Test: `server/test/app.test.js` (append)

**Interfaces:**
- Consumes (main에 있음): `addChangeRequest(db,{personSlug,requesterName,contact,field,proposed,evidence})->id`, `getChangeRequest(db,id)`, `listChangeRequests(db,{personSlug?,status?})`, `resolveChangeRequest(db,{id,status,resolverName,note,versionId})` (open일 때만 갱신), `chainIndexOf(db,versionId)->number|null`
- Produces 라우트:
  - `GET /versions/:id.json` → `{content, contentHash, txHash, chainIndex}` (404 if 없음/draft는 chainIndex null 허용? — draft는 404)
  - `GET /versions/:id/diff` → 직전 버전(같은 person, id 미만 최대 id)과 필드 단위 비교 렌더. 직전이 없으면 "최초 버전" 표시
  - `GET /requests?status=` 목록, `GET /requests/new?person=slug` 폼, `POST /requests` (필수: person, requesterName, contact, field, proposed, evidence → 400), `GET /requests/:id` 상세, `POST /requests/:id/resolve` (status accepted|rejected, resolverName 필수, rejected면 note 필수, accepted면 versionId 선택)
- content 스키마에 `note` 추가: POST /persons가 `req.body.note`를 content에 포함 (없으면 "최초 등록"). edit.ejs에 note 입력(기존 인물 수정 시 required)

- [x] **Step 1: 실패하는 테스트 추가** — app.test.js append (실제 코드):

```js
test("note가 content에 포함되어 해시에 반영된다", async (t) => {
  const { base, db } = makeServer(t);
  const body = new URLSearchParams({
    slug: "kim-gu", name: "김구", category: "independence",
    birth: "1876", death: "1949", summary: "수정된 요약", note: "출생 연도 출처 보강",
  });
  await fetch(base + "/persons", { method: "POST", body, redirect: "manual" });
  const [draft] = listVersions(db, "kim-gu");
  assert.equal(JSON.parse(draft.content_json).note, "출생 연도 출처 보강");
});

test("버전 diff가 바뀐 필드를 보여준다", async (t) => {
  const { base, db } = makeServer(t);
  const mk = (summary, note) => fetch(base + "/persons", {
    method: "POST",
    body: new URLSearchParams({ slug: "kim-gu", name: "김구", category: "independence",
      birth: "1876", death: "1949", summary, note }),
    redirect: "manual",
  });
  await mk("요약 v1", "최초 등록");
  await mk("요약 v2", "오탈자 수정");
  const [v2] = listVersions(db, "kim-gu");
  const html = await (await fetch(`${base}/versions/${v2.id}/diff`)).text();
  assert.match(html, /요약 v1/);
  assert.match(html, /요약 v2/);
  assert.match(html, /오탈자 수정/);
});

test("versions/:id.json이 chainIndex를 준다", async (t) => {
  const { base, db } = makeServer(t);
  const id = createDraft(db, { personSlug: "kim-gu", contentJson: '{"a":1}', contentHash: "0x" + "11".repeat(32) });
  assert.equal((await fetch(`${base}/versions/${id}.json`)).status, 404); // draft는 404
  dbMarkAnchored(db, { versionId: id, txHash: "0x" + "22".repeat(32), wallet: "0xW" });
  const body = await (await fetch(`${base}/versions/${id}.json`)).json();
  assert.equal(body.chainIndex, 0);
  assert.equal(body.content.a, 1);
});

test("수정 요청 제출·공개 목록·처리", async (t) => {
  const { base, db } = makeServer(t);
  const bad = await fetch(base + "/requests", { method: "POST",
    body: new URLSearchParams({ person: "kim-gu", requesterName: "박제보" }) });
  assert.equal(bad.status, 400);
  const ok = await fetch(base + "/requests", { method: "POST", redirect: "manual",
    body: new URLSearchParams({ person: "kim-gu", requesterName: "박제보", contact: "bo@ex.com",
      field: "summary", proposed: "더 정확한 요약", evidence: "https://e-gonghun.mpva.go.kr/" }) });
  assert.equal(ok.status, 302);
  const list = await (await fetch(base + "/requests?status=open")).text();
  assert.match(list, /박제보/);
  const [req0] = listChangeRequests(db, {});
  const noNote = await fetch(`${base}/requests/${req0.id}/resolve`, { method: "POST",
    body: new URLSearchParams({ status: "rejected", resolverName: "홍역사" }) });
  assert.equal(noNote.status, 400); // 반려엔 사유 필수
  await fetch(`${base}/requests/${req0.id}/resolve`, { method: "POST", redirect: "manual",
    body: new URLSearchParams({ status: "rejected", resolverName: "홍역사", note: "근거 불충분" }) });
  const detail = await (await fetch(`${base}/requests/${req0.id}`)).text();
  assert.match(detail, /근거 불충분/);
});
```

필요 import 추가: `createDraft`, `listChangeRequests` (이미 있는 import 문에 병합).

- [x] **Step 2: 실패 확인** — `cd server && npm test` → 신규 4개 FAIL
- [x] **Step 3: 라우트 구현** — app.js. diff 계산은 라우트 안 15줄 이내: 두 content를 JSON.parse해 키 합집합 순회, `{key, before, after, changed}` 배열 생성(sources는 JSON.stringify 비교). `/versions/:id.json`은 `/versions/:id/...` 라우트들보다 위에 배치.
- [x] **Step 4: 뷰** — 기존 EJS 컨벤션(head partial, nav, 이스케이프 `<%= %>`) 그대로. person.ejs: 버전 이력 테이블에 각 anchored 행 diff 링크 + "검증" 버튼(`data-chain-index`, `data-version-id`), 상단에 "수정 요청하기" 링크와 open 요청 수. edit.ejs: note 입력. requests 3종 뷰. nav에 `/requests` 추가(전체 뷰 nav 일괄).
- [x] **Step 5: verify.js 확장** — 기존 최신 검증 유지 + 버전별: 클릭된 버튼의 `data-version-id`로 `/versions/:id.json` fetch → 재해싱 → `getVersion(personId, chainIndex)`와 비교. ABI에 `getVersion` 추가. 이벤트 위임(버전 버튼 여러 개).
- [x] **Step 6: 통과 확인** — `npm test` → 32 passing
- [x] **Step 7: 커밋**

---

### Task M: MCP 서버

**Files:**
- Create: `server/mcp/handlers.js`, `server/mcp/server.js`
- Modify: `server/package.json` (dep `@modelcontextprotocol/sdk`, script `"mcp": "node mcp/server.js"`)
- Modify: `README.md` (MCP 섹션 추가)
- Test: `server/test/mcp-handlers.test.js`

**Interfaces:**
- Consumes: db.js 전부(특히 `addChangeRequest`, `listChangeRequests`, `latestAnchored`, `chainIndexOf`), `canonicalize`, ethers(`JsonRpcProvider`, RecordRegistry ABI `latest`/`getVersion`)
- Produces `handlers.js` (순수 함수, 전부 export):
  - `searchPersons(db, {q, category})` → persons rows
  - `getPersonDetail(db, slug)` → `{person, sources, versions}` | null
  - `verifyRecord(db, chainDeps, {slug, versionId?})` → `{verified: boolean, localHash, chainHash, author?, note: "서버 측 검증 — 독립 검증은 웹 브라우저 검증 사용"}`; chainDeps = `{provider, contractAddress}` 주입(테스트에서 fake 가능)
  - `submitChangeRequest(db, params)` → `{id}` — 웹과 동일한 필수값 검증, 누락 시 throw
  - `listRequests(db, {status})` → rows
- `server.js`: stdio MCP 서버, 도구 5개 등록, env `DB_PATH`/`RPC_URL`/`CONTRACT_ADDRESS`. SDK 사용법은 `@modelcontextprotocol/sdk` README(설치 후 node_modules 내) 참조 — McpServer + StdioServerTransport + zod 스키마

- [x] **Step 1: 실패하는 테스트 작성** — mcp-handlers.test.js (실제 코드):

```js
import test from "node:test";
import assert from "node:assert/strict";
import { ethers } from "ethers";
import { openDb, upsertPerson, createDraft, markAnchored } from "../src/db.js";
import { canonicalize } from "../public/canonical.js";
import { searchPersons, getPersonDetail, verifyRecord, submitChangeRequest, listRequests } from "../mcp/handlers.js";

function seeded() {
  const db = openDb();
  upsertPerson(db, { slug: "kim-gu", name: "김구", category: "independence",
    birth: "1876", death: "1949", summary: "임시정부 주석" });
  return db;
}

test("searchPersons/getPersonDetail", () => {
  const db = seeded();
  assert.equal(searchPersons(db, { q: "김" }).length, 1);
  assert.equal(getPersonDetail(db, "kim-gu").person.name, "김구");
  assert.equal(getPersonDetail(db, "nope"), null);
});

test("submitChangeRequest는 필수값을 검증한다", () => {
  const db = seeded();
  assert.throws(() => submitChangeRequest(db, { personSlug: "kim-gu", requesterName: "박제보" }));
  const { id } = submitChangeRequest(db, {
    personSlug: "kim-gu", requesterName: "박제보", contact: "bo@ex.com",
    field: "summary", proposed: "수정안", evidence: "https://e-gonghun.mpva.go.kr/",
  });
  assert.equal(listRequests(db, { status: "open" })[0].id, id);
});

test("verifyRecord가 가짜 체인과 대조한다", async () => {
  const db = seeded();
  const content = { slug: "kim-gu", name: "김구" };
  const canonical = canonicalize(content);
  const hash = ethers.keccak256(ethers.toUtf8Bytes(canonical));
  const vid = createDraft(db, { personSlug: "kim-gu", contentJson: canonical, contentHash: hash });
  markAnchored(db, { versionId: vid, txHash: "0x" + "ab".repeat(32), wallet: "0xW" });
  const fakeChain = { latest: async () => [hash, "0xAUTHOR", 0n], getVersion: async () => [hash, "0xAUTHOR", 0n] };
  const r = await verifyRecord(db, { contract: fakeChain }, { slug: "kim-gu" });
  assert.equal(r.verified, true);
  const bad = { latest: async () => ["0x" + "00".repeat(32), "0xAUTHOR", 0n] };
  const r2 = await verifyRecord(db, { contract: bad }, { slug: "kim-gu" });
  assert.equal(r2.verified, false);
});
```

주: verifyRecord의 chainDeps는 `{contract}`(latest/getVersion 메서드를 가진 객체)로 주입 — server.js에서만 실제 ethers.Contract 생성.

- [x] **Step 2: 실패 확인** — `npm test` → 신규 3개 FAIL (모듈 없음)
- [x] **Step 3: handlers.js 구현** — 순수 함수 5개. verifyRecord: versionId 주면 `chainIndexOf`+`getVersion`, 없으면 `latestAnchored`+`latest`. 앵커 버전 없으면 `{verified:false, error:"앵커된 버전 없음"}`.
- [x] **Step 4: SDK 설치 + server.js** — `npm i @modelcontextprotocol/sdk zod`. McpServer에 도구 5개(zod 입력 스키마, description 한국어), StdioServerTransport 연결. 실행 확인: `echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"t","version":"0"}}}' | node mcp/server.js` 가 JSON 응답을 내면 OK.
- [x] **Step 5: README에 MCP 섹션** — 등록 예시 포함: `claude mcp add memorial-ledger -- node <repo>/server/mcp/server.js` + env 설명.
- [x] **Step 6: 통과 확인** — `npm test` 그린 (31 이상)
- [x] **Step 7: 커밋**
