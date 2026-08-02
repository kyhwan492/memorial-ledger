# 공훈 데이터 전체 흡수 v6 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 공훈록 전체 필드 흡수 + 공적조서·이달의 독립운동가 연동 + 훈격·운동계열 찾기 UI.

**Architecture:** spec `docs/superpowers/specs/2026-08-02-gonghun-full-design.md`. db 기반(persons 확장 컬럼 + 마이그레이션 + `listPersons({q,category,hunkuk,workoutAffil})` + `listFilterValues(db)->{hunkuks,affils}` + `upsertPerson`의 `hunkuk/workoutAffil/judgeYear/alias/sex` 인자)은 **main에 merge됨**. 두 레인 병렬: I(임포트), W(웹).

## Global Constraints

- v1 Global Constraints 유지 (한국어 UI, Co-Authored-By 금지, EJS 이스케이프, 새 JS 섬 금지)
- 외부 API는 **문서·실응답으로 확인된 필드만** 구현 — 추측 금지, 확인 불가 항목은 리포트 Issues에 기록하고 생략
- 정본 content에는 값이 있는 새 필드만 포함(빈 문자열 생략)

---

### Task I: 임포트 확장 — 공훈록 전체 필드 + 공적조서 + 이달의 독립운동가

**Files:**
- Modify: `server/scripts/gonghun-map.js`, `server/scripts/import-gonghun.js`
- Create: `server/scripts/fetch-monthly.js` (+ 공적조서를 다루게 되면 `server/scripts/import-reward.js`)
- Test: `server/test/gonghun-map.test.js` (append)

**Interfaces:**
- Consumes: `upsertPerson`(확장 인자), `addSource`, `listSources`
- Produces:
  - `mapRow(apiRow)` 확장 → `{slug, name, category, birth, death, summary, hunkuk, workoutAffil, judgeYear, alias, sex}` (HUNKUK, WORKOUT_AFFIL, JUDGE_YEAR, DIFF_NAME, SEX 매핑 — 실응답으로 필드명·형식 확인)
  - `mapReferences(apiRow) -> [{label, url}]` — REFERENCES 배열을 sources 항목으로 (형식 실응답 확인, url 없으면 label만)
  - import-gonghun.js가 두 함수 다 사용, 출처 중복 방지 유지
  - `fetch-monthly.js` — 이달의 독립운동가 API(`/user/IndepCrusaderOpenAPI.do` 문서에서 엔드포인트 확인) → `server/data/monthly.json`에 `[{year, month, name, mngNo, summary}]` 형태 저장. 이 파일 스키마가 Task W와의 계약이다.
  - 공적조서(`/user/RewardOpenAPI.do` 문서 확인): 실API가 확인되면 인물별 공적조서를 `sources`에 `label: "공적조서(YYYY)"` + url(사료관 상세 링크) 로 추가하는 `import-reward.js` 작성. 확인 불가면 생략하고 리포트에 근거 기록.

- [x] **Step 1: API 명세 확인** — curl로 공훈록 실응답 1건(전체 필드), 이달의 독립운동가·공적조서 문서 페이지와 실응답 확인. 확인 내용을 리포트에 남긴다.
- [x] **Step 2: 실패하는 테스트 추가** — gonghun-map.test.js append (실응답 기반 픽스처로 아래를 구체화):

```js
test("mapRow가 훈격·운동계열·서훈년도·이명·성별을 매핑한다", () => {
  const row = mapRow(FIXTURE_FULL); // Step 1에서 확보한 실응답 픽스처
  assert.equal(row.hunkuk.length > 0, true);
  assert.equal(row.workoutAffil.length > 0, true);
  assert.equal(row.judgeYear.length > 0, true);
});

test("mapReferences가 참고문헌을 출처 항목으로 만든다", () => {
  const refs = mapReferences(FIXTURE_FULL);
  assert.equal(Array.isArray(refs), true);
  for (const r of refs) assert.equal(typeof r.label, "string");
});
```

- [x] **Step 3: 구현 + 통과** — `npm test` 그린 (기존 44 + 신규)
- [x] **Step 4: 실동작 검증** — `DB_PATH=/tmp/v6-check.db node scripts/import-gonghun.js --limit 5` 실행, 훈격 등 채워지는지 sqlite로 확인. `node scripts/fetch-monthly.js` 실행해 monthly.json 생성 확인. 결과를 리포트에.
- [x] **Step 5: 커밋** (스킵 — 오케스트레이터)

---

### Task W: 독립유공자 찾기 웹

**Files:**
- Modify: `server/src/app.js`, `server/src/views/index.ejs`, `server/src/views/person.ejs`, `server/src/views/edit.ejs`, `server/src/views/partials/person-rows.ejs`
- Test: `server/test/app.test.js` (append)

**Interfaces:**
- Consumes: `listPersons({q,category,hunkuk,workoutAffil})`, `listFilterValues(db)`, Task I의 `server/data/monthly.json` 스키마(`[{year, month, name, mngNo, summary}]` — 파일이 없거나 파싱 실패 시 섹션 미표시)
- Produces:
  - `GET /` — 훈격·운동계열 셀렉트 필터(값은 listFilterValues, htmx 부분 렌더 유지), 이달의 독립운동가 섹션(이번 달 항목이 있고 monthly.json이 읽히면; 원장에 `gonghun-<mngNo>` 인물이 있으면 링크)
  - person.ejs — 훈격·운동계열·서훈년도·이명·성별 표시(값 있을 때만)
  - edit.ejs + POST /persons — 새 필드 입력·정본 포함(**값 있는 것만** content에 넣는다: `if (hunkuk) content.hunkuk = hunkuk` 식)

- [x] **Step 1: 실패하는 테스트 추가** — app.test.js append:

```js
test("훈격·운동계열 필터가 동작한다", async (t) => {
  const { base, db } = makeServer(t);
  upsertPerson(db, { slug: "an-junggeun", name: "안중근", category: "independence",
    birth: "1879", death: "1910", summary: "z", hunkuk: "대한민국장", workoutAffil: "의열투쟁" });
  const html = await (await fetch(base + "/?hunkuk=" + encodeURIComponent("대한민국장"))).text();
  assert.match(html, /안중근/);
  assert.doesNotMatch(html, /김구<\/a>/);
  const partial = await (await fetch(base + "/?workoutAffil=" + encodeURIComponent("의열투쟁"),
    { headers: { "HX-Request": "true" } })).text();
  assert.match(partial, /안중근/);
});

test("상세 페이지가 확장 필드를 값이 있을 때만 보여준다", async (t) => {
  const { base, db } = makeServer(t);
  upsertPerson(db, { slug: "kim-gu", name: "김구", category: "independence",
    birth: "1876", death: "1949", summary: "임시정부 주석",
    hunkuk: "대한민국장", workoutAffil: "임시정부", judgeYear: "1962", alias: "백범" });
  const html = await (await fetch(base + "/persons/kim-gu")).text();
  assert.match(html, /대한민국장/);
  assert.match(html, /백범/);
  const other = await (await fetch(base + "/persons/kim-gu")).text(); // 값 없는 sex는 미표시
  assert.doesNotMatch(other, /성별/);
});

test("확장 필드가 정본 content에 값이 있을 때만 포함된다", async (t) => {
  const { base, db } = makeServer(t);
  await fetch(base + "/persons", { method: "POST", redirect: "manual",
    body: new URLSearchParams({ slug: "kim-gu", name: "김구", category: "independence",
      birth: "1876", death: "1949", summary: "x", note: "필드 보강", hunkuk: "대한민국장" }) });
  const [draft] = listVersions(db, "kim-gu");
  const content = JSON.parse(draft.content_json);
  assert.equal(content.hunkuk, "대한민국장");
  assert.equal("alias" in content, false); // 빈 필드는 생략
});
```

- [x] **Step 2: 실패 확인** — `npm test` → 신규 3개 FAIL
- [x] **Step 3: 구현** — app.js 필터 파라미터·listFilterValues 전달·monthly.json 읽기(try/catch, 요청 시 lazy read), 뷰 4개. 이달의 섹션은 index.ejs 상단에 값 있을 때만.
- [x] **Step 4: 통과 확인** — `npm test` → 47 passing
- [x] **Step 5: 커밋** (스킵 — 오케스트레이터)
