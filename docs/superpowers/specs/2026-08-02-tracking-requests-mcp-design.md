# 변경 트래킹 + 수정 요청 + MCP (v3) 설계

날짜: 2026-08-02
상태: 승인됨 (요청 자격: 실명 공개면 누구나 / MCP: 읽기 + 요청 제출 — 사용자 선택)

## 배경

원장이 이 프로젝트의 핵심이다. 현재 버전 이력은 보존·앵커되지만 ① 무엇이
바뀌었는지(diff), ② 왜 바뀌었는지(사유), ③ 과거 버전의 개별 검증, ④ 외부인의
오류 제보 통로가 없다. 또한 AI 도구가 원장을 조회·검증할 MCP 인터페이스를 만든다.

## 1. 변경 트래킹

- 정본 content에 `note`(변경 사유) 필드 추가 — **해시에 포함되므로 사유도 변조
  불가**. 수정 폼에서 필수, 신규 등록은 기본값 "최초 등록".
- 하위 호환: 기존 앵커 버전은 content_json 문자열이 그대로 보존되므로 note가
  없어도 검증에 영향 없다 (재직렬화하지 않는 설계 덕).
- **버전 diff**: `GET /versions/:id/diff` — 직전 버전과 필드 단위 비교(추가/삭제/
  변경), 서버 렌더링. sources 배열은 통째 비교.
- **버전별 검증**: 앵커된 버전의 체인 인덱스 = "해당 person에서 자기보다 id가
  작은 anchored 버전 수". 버전 이력의 각 anchored 행에 검증 버튼 —
  `GET /versions/:id.json` + verify.js가 `getVersion(personId, index)`과 비교.

## 2. 수정 요청 (change requests)

- 자격: **실명 공개면 누구나**. 필수: 요청자 이름, 연락처, 대상 필드, 제안 내용,
  근거 출처. 익명 불가 원칙 유지 — 이름·근거는 공개 페이지에 노출.
- 워크플로: 제출(open) → 공개 목록 노출 → **등록 작성자가** 수용/반려.
  - 수용: 작성자가 기록을 수정(새 앵커 버전)한 뒤 요청을 accepted로 마감하며
    반영 버전 id를 링크.
  - 반려: rejected + 반려 사유 필수, 공개.
- 요청 자체는 오프체인(DB) — 사실이 아니라 제안이므로 앵커하지 않는다. 수용된
  결과물(새 버전)이 앵커된다.
- 웹: 인물 페이지에 "수정 요청" 링크 + 미처리 요청 수 표시, `/requests` 공개
  목록(상태 필터), 요청 상세, 처리 폼(작성자용 — v1과 같은 원칙으로 서버 로그인
  없음, 처리 기록에 처리자 이름 남김).

## 3. MCP 서버

- `server/mcp/` — stdio MCP 서버 (`@modelcontextprotocol/sdk` 의존성 추가).
  같은 SQLite + RPC를 사용. env: `DB_PATH`, `RPC_URL`, `CONTRACT_ADDRESS`.
- 도구:
  - `search_persons {q?, category?}` → 목록
  - `get_person {slug}` → 인물 + 출처 + 버전 이력(해시·tx·상태)
  - `verify_record {slug, versionId?}` → 서버 측 재해싱 vs 온체인 비교 결과
    (기본: 최신 앵커 버전). ※ 브라우저 검증과 달리 서버를 신뢰하는 검증임을
    응답에 명시.
  - `list_change_requests {status?}` / `submit_change_request {personSlug,
    requesterName, contact, field, proposed, evidence}` — 웹과 동일한 필수값 검증.
- 도구 로직은 순수 핸들러 함수(db 인자)로 분리해 유닛 테스트. MCP 래퍼는 얇게.

## 데이터 모델 추가 (db.js)

```
change_requests(id, person_slug FK, requester_name, requester_contact,
  field, proposed, evidence, status 'open'|'accepted'|'rejected',
  resolver_name, resolution_note, resolved_version_id, created_at, resolved_at)
```

## 범위 밖

요청 스팸 방지(rate limit/captcha), 이메일 알림, 요청의 체인 앵커링, 작성자
서버 인증(기존 원칙 유지), Sepolia 배포.
