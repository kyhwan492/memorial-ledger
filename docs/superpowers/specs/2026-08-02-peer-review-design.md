# 편집 거버넌스: 피어 리뷰 (v4) 설계

날짜: 2026-08-02
상태: 승인됨 (검토자=작성자 풀 겸임·당사자 제외 / 정족수=승인 2+반대 0 — 사용자 선택)

## 배경

지금은 수정 요청을 등록 작성자 1명이 단독 수용/반려한다. 역사적 사실처럼 다툼
여지가 있는 실질 변경은 논문 출판처럼 **복수 검토자의 공개 심사와 기존 사료
종합**을 거쳐야 체인에 오를 자격이 생긴다. 단순 의문·오타까지 심사에 넣으면
마비되므로 경로를 나눈다.

## 3단계 편집 경로

```
제보(open) ──작성자 판단──┬─ 단순 정정: 기존처럼 단독 수용/반려
                          └─ 실질 변경: 심사 전환(in_review)
in_review ── 검토자들이 공개 리뷰(승인/반려/보완) ── 정족수 충족 시에만 수용 가능
수용(accepted) ── 작성자가 새 버전으로 종합·앵커, note에 요청 ID 링크
```

- 상태 추가: `open → in_review → accepted|rejected` (기존 `open → accepted|rejected`
  단독 경로는 단순 정정용으로 유지)
- **정족수**: 서로 다른 검토자의 최신 평결 기준 `approve ≥ 2` AND `reject = 0`.
  검토자는 새 리뷰를 남겨 자신의 이전 평결을 갱신할 수 있다(최신 것만 유효 —
  반대가 보완으로 해소되는 경로).
- **검토자 자격**: 작성자 풀 겸임. 단, 해당 요청의 제안자 이름과 동일한 검토자
  이름은 정족수 계산에서 제외(자기 심사 방지 — 서버 로그인이 없으므로 실명
  일치 기준, v1 원칙과 동일하게 공개 기록이 책임 장치).
- 리뷰는 오프체인 공개 기록. 체인에는 여전히 확정본 해시만 앵커.

## 데이터 모델 추가

```
reviews(id, request_id FK→change_requests, reviewer_name NOT NULL,
        verdict 'approve'|'reject'|'needs_work', comment NOT NULL, created_at)
```

db.js 추가 함수: `addReview`, `listReviews(requestId)`,
`reviewStatus(db, requestId) -> {approvals, rejects, passed}` (제안자 제외·최신
평결 기준), `escalateRequest(id)` (open→in_review),
`resolveChangeRequest`는 in_review에서 accepted로 갈 때 정족수 미충족이면 거부.

## 웹

- 요청 상세: 심사 전환 버튼(open일 때), 리뷰 목록(실명·평결·의견 공개),
  리뷰 작성 폼(in_review일 때), 정족수 현황 표시, in_review에서 수용 버튼은
  정족수 충족 시에만 동작(서버에서도 강제).
- 요청 목록: in_review 필터 추가.
- `/about`과 `docs/architecture.md`에 편집 거버넌스 설명 추가.

## MCP

도구 추가: `get_change_request {id}` (상세+리뷰+정족수 현황),
`submit_review {requestId, reviewerName, verdict, comment}` (필수값 검증,
in_review 상태에서만).

## 범위 밖

검토자 배정·알림, 리뷰 기한, 서버 인증(기존 원칙 유지), 심사 요약의 체인 앵커.
