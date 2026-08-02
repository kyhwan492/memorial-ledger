# Peer Review v4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 수정 요청에 논문식 피어 리뷰 층을 추가한다 — 실질 변경은 심사 전환 후 정족수(승인 2+반대 0) 충족 시에만 수용.

**Architecture:** spec `docs/superpowers/specs/2026-08-02-peer-review-design.md`. db 계층(reviews, reviewStatus, escalateRequest, resolveChangeRequest의 in_review 허용)은 **이미 main에 merge됨** — 소비만 한다. 두 레인 병렬: T(웹+문서), M(MCP).

## Global Constraints

- v1 Global Constraints 유지 (한국어 UI, Co-Authored-By 금지, EJS 이스케이프, 새 JS 섬 금지)
- 정족수 강제는 서버(라우트/핸들러)에서 — UI 비활성화만으로 충분하지 않다
- 자기 심사 방지는 db의 reviewStatus가 이미 처리(제안자 이름 제외) — 웹/MCP는 추가 차단 불요

---

### Task T: 심사 웹 UI + 문서

**Files:**
- Modify: `server/src/app.js`, `server/src/views/request.ejs`, `server/src/views/requests.ejs`, `server/src/views/about.ejs`, `docs/architecture.md`
- Test: `server/test/app.test.js` (append)

**Interfaces:**
- Consumes (main에 있음): `addReview(db,{requestId,reviewerName,verdict,comment})`, `listReviews(db,requestId)`, `reviewStatus(db,requestId)->{approvals,rejects,passed}`, `escalateRequest(db,id)` (open→in_review만), `resolveChangeRequest` (open|in_review에서 동작)
- Produces 라우트:
  - `POST /requests/:id/escalate` — open이 아니면 409, 성공 시 상세로 redirect
  - `POST /requests/:id/reviews` — body `{reviewerName, verdict(approve|reject|needs_work), comment}` 전부 필수(400), in_review 상태가 아니면 409, 성공 시 상세로 redirect
  - `POST /requests/:id/resolve` 수정 — **in_review에서 accepted로 갈 때 `reviewStatus(...).passed`가 아니면 403** ("정족수 미충족"). open에서의 단독 수용(단순 정정)과 rejected 처리는 기존대로.
- request.ejs: 상태별 UI — open: "심사 전환" 버튼 + 기존 단독 처리 폼(단순 정정용 명시), in_review: 리뷰 목록(실명·평결·의견·시각), 리뷰 폼, 정족수 현황(`승인 N/2 · 반대 N`), 수용 버튼은 passed일 때만 표시(서버도 403 강제). 처리 완료: 리뷰 이력 그대로 공개.
- requests.ejs: 상태 필터에 in_review 추가, 목록 행에 상태 뱃지.
- about.ejs + docs/architecture.md: "편집 거버넌스" 섹션 — 3단계 경로(제보→심사→확정), 정족수 규칙, 단순 정정 예외, 리뷰는 오프체인 공개·체인엔 확정본만.

- [ ] **Step 1: 실패하는 테스트 추가** — app.test.js append (실제 코드):

```js
test("심사 전환과 리뷰 제출, 정족수 강제", async (t) => {
  const { base, db } = makeServer(t);
  await fetch(base + "/requests", { method: "POST", redirect: "manual",
    body: new URLSearchParams({ person: "kim-gu", requesterName: "박제보", contact: "b@e.c",
      field: "summary", proposed: "x", evidence: "y" }) });
  const [r] = listChangeRequests(db, {});
  // open 상태에서 리뷰 제출은 409
  const early = await fetch(`${base}/requests/${r.id}/reviews`, { method: "POST",
    body: new URLSearchParams({ reviewerName: "홍역사", verdict: "approve", comment: "ok" }) });
  assert.equal(early.status, 409);
  // 심사 전환
  await fetch(`${base}/requests/${r.id}/escalate`, { method: "POST", redirect: "manual" });
  // 필수값 누락 400
  const bad = await fetch(`${base}/requests/${r.id}/reviews`, { method: "POST",
    body: new URLSearchParams({ reviewerName: "홍역사", verdict: "approve" }) });
  assert.equal(bad.status, 400);
  // 정족수 미충족 상태에서 수용 시도 → 403
  await fetch(`${base}/requests/${r.id}/reviews`, { method: "POST", redirect: "manual",
    body: new URLSearchParams({ reviewerName: "홍역사", verdict: "approve", comment: "사료 일치" }) });
  const deny = await fetch(`${base}/requests/${r.id}/resolve`, { method: "POST",
    body: new URLSearchParams({ status: "accepted", resolverName: "홍역사" }) });
  assert.equal(deny.status, 403);
  // 두 번째 승인 후 수용 성공
  await fetch(`${base}/requests/${r.id}/reviews`, { method: "POST", redirect: "manual",
    body: new URLSearchParams({ reviewerName: "김검토", verdict: "approve", comment: "근거 확인" }) });
  const ok = await fetch(`${base}/requests/${r.id}/resolve`, { method: "POST", redirect: "manual",
    body: new URLSearchParams({ status: "accepted", resolverName: "홍역사" }) });
  assert.equal(ok.status, 302);
  const html = await (await fetch(`${base}/requests/${r.id}`)).text();
  assert.match(html, /사료 일치/);
  assert.match(html, /김검토/);
});

test("심사 전환은 open에서만, 요청 목록에 in_review 필터", async (t) => {
  const { base, db } = makeServer(t);
  await fetch(base + "/requests", { method: "POST", redirect: "manual",
    body: new URLSearchParams({ person: "kim-gu", requesterName: "박제보", contact: "b@e.c",
      field: "birth", proposed: "z", evidence: "w" }) });
  const [r] = listChangeRequests(db, {});
  await fetch(`${base}/requests/${r.id}/escalate`, { method: "POST", redirect: "manual" });
  const again = await fetch(`${base}/requests/${r.id}/escalate`, { method: "POST" });
  assert.equal(again.status, 409);
  const list = await (await fetch(base + "/requests?status=in_review")).text();
  assert.match(list, /박제보/);
});
```

- [ ] **Step 2: 실패 확인** — `cd server && npm test` → 신규 2개 FAIL
- [ ] **Step 3: 라우트 구현** (escalate/reviews/resolve 정족수 403)
- [ ] **Step 4: 뷰 + about + architecture.md** (기존 컨벤션·이스케이프 준수)
- [ ] **Step 5: 통과 확인** — `npm test` → 39 passing
- [ ] **Step 6: 커밋**

---

### Task M: MCP 심사 도구

**Files:**
- Create: 없음 (기존 파일 수정)
- Modify: `server/mcp/handlers.js`, `server/mcp/server.js`, `README.md` (도구 목록 갱신)
- Test: `server/test/mcp-handlers.test.js` (append)

**Interfaces:**
- Consumes: db.js `getChangeRequest`, `listReviews`, `reviewStatus`, `addReview`
- Produces handlers:
  - `getRequestDetail(db, id)` → `{request, reviews, quorum: reviewStatus결과}` | null
  - `submitReview(db, {requestId, reviewerName, verdict, comment})` → `{id}` — 전부 필수·verdict 화이트리스트 검증(throw), 요청이 in_review 아니면 throw
- server.js: 도구 2개 추가 (`get_change_request`, `submit_review`), zod 스키마, 한국어 description

- [ ] **Step 1: 실패하는 테스트 추가** — mcp-handlers.test.js append (실제 코드):

```js
import { addChangeRequest, escalateRequest } from "../src/db.js";
import { getRequestDetail, submitReview } from "../mcp/handlers.js";

test("getRequestDetail과 submitReview", () => {
  const db = seeded();
  const rid = addChangeRequest(db, { personSlug: "kim-gu", requesterName: "박제보",
    contact: "b@e.c", field: "summary", proposed: "x", evidence: "y" });
  assert.throws(() => submitReview(db, { requestId: rid, reviewerName: "홍역사",
    verdict: "approve", comment: "ok" })); // open 상태 — 거부
  escalateRequest(db, rid);
  assert.throws(() => submitReview(db, { requestId: rid, reviewerName: "홍역사", verdict: "approve" })); // comment 누락
  assert.throws(() => submitReview(db, { requestId: rid, reviewerName: "홍역사",
    verdict: "maybe", comment: "?" })); // verdict 화이트리스트
  submitReview(db, { requestId: rid, reviewerName: "홍역사", verdict: "approve", comment: "사료 일치" });
  submitReview(db, { requestId: rid, reviewerName: "김검토", verdict: "approve", comment: "확인" });
  const d = getRequestDetail(db, rid);
  assert.equal(d.reviews.length, 2);
  assert.equal(d.quorum.passed, true);
  assert.equal(getRequestDetail(db, 9999), null);
});
```

(import 문은 기존 import에 병합)

- [ ] **Step 2: 실패 확인** — `npm test` → 신규 1개 FAIL
- [ ] **Step 3: handlers + server.js 도구 등록 + README 도구 목록에 2개 추가**
- [ ] **Step 4: 통과 확인** — `npm test` 그린 + initialize 핸드셰이크 확인(플랜 v3 Task M Step 4와 같은 방법)
- [ ] **Step 5: 커밋**
