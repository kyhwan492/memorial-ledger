# 공훈 데이터 전체 흡수 + 독립유공자 찾기 (v6) 설계

날짜: 2026-08-02
상태: 승인됨

## 배경

공훈전자사료관 오픈API 4종 중 공훈록만, 그것도 일부 필드만 쓰고 있다. 훈격·
운동계열 같은 핵심 분류를 버리고 있어 사이트의 "독립유공자 찾기" 수준의 탐색이
불가능하다.

## 1. persons 스키마 확장 (기반 — 오케스트레이터)

새 컬럼: `hunkuk`(훈격), `workout_affil`(운동계열), `judge_year`(서훈년도),
`alias`(이명), `sex`. 모두 TEXT NOT NULL DEFAULT ''.
- 기존 DB 마이그레이션: openDb가 PRAGMA table_info로 누락 컬럼을 ALTER ADD.
- `listPersons` 필터 확장: `hunkuk`, `workoutAffil`.
- distinct 값 조회: `listFilterValues(db) -> {hunkuks, affils}` (빈 값 제외).
- 정본 content에는 **값이 있는 새 필드만** 포함(빈 문자열 필드는 생략 —
  기존 앵커 버전과의 diff 잡음 최소화). 기존 앵커 버전 검증은 재직렬화 없음
  원칙으로 영향 없음.

## 2. 임포트 확장 (워커 I)

- gonghun-map: HUNKUK, WORKOUT_AFFIL, JUDGE_YEAR, DIFF_NAME(이명), SEX 매핑 +
  REFERENCES 배열 → 개별 sources로 추가(중복 방지).
- **공적조서 API** (`/user/RewardOpenAPI.do` 문서에서 명세 확인): 확인된 필드만
  구현. 인물(mngNo)별 공적조서 텍스트를 sources에 "공적조서" 출처로 추가하거나
  별도 저장 — 문서에서 확인한 구조에 따라 워커가 결정하고 리포트에 근거 명시.
  API 접근 불가 시 구현하지 않고 리포트에 기록(추측 금지).
- **이달의 독립운동가 API** (`/user/IndepCrusaderOpenAPI.do` 문서 확인):
  `scripts/fetch-monthly.js` → `data/monthly.json` 저장(연·월·인물명·mngNo·요약).
  마찬가지로 확인된 필드만.

## 3. 독립유공자 찾기 웹 (워커 W)

- 목록 페이지: 기존 이름 검색·분류 필터에 **훈격·운동계열 셀렉트** 추가
  (DB distinct 값, htmx 부분 렌더 유지).
- 인물 상세: 훈격 · 운동계열 · 서훈년도 · 이명 · 성별 표시(값 있을 때만).
- 기록 폼/POST /persons: 새 필드 입력·정본 포함(값 있는 것만).
- 메인 페이지: `data/monthly.json` 있으면 "이달의 독립운동가" 섹션
  (이번 달 항목, 원장에 있으면 인물 링크).

## 범위 밖

해외 독립운동 사료 API(인물 단위 아님), 전문 검색(full-text), 기존 앵커 버전
재발행.
