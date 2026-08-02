# 투명 후원 + 공훈록 임포트 (v2) 설계

날짜: 2026-08-02
상태: 승인됨 (후원 방식 A안 + 공훈록 API 임포트 — 사용자 선택)

## 목표

1. **온체인 직접 후원**: 인물별로 검증된 수혜자(후예/단체) 지갑에 누구나 후원할 수
   있고, 모든 후원이 체인 이벤트로 전액 공개된다.
2. **공훈록 임포트**: 국가보훈부 독립유공자 공훈록 오픈API(data.go.kr, 문서
   https://www.data.go.kr/data/15057718/openapi.do)로 인물을 대량 등록한다.

## 후원 — Donations 컨트랙트 (신규, RecordRegistry와 분리)

```solidity
mapping(bytes32 => address payable) beneficiaries;  // personId → 수혜자 (owner가 등록)
mapping(bytes32 => uint256) totalDonated;
registerBeneficiary(personId, to, profileUri)  // onlyOwner, zero주소 거부
donate(personId) payable                       // 수혜자 미등록/0원 거부, 즉시 전액 전달
event BeneficiaryRegistered(personId indexed, to, profileUri)
event Donated(personId indexed, donor indexed, amount)
```

핵심 결정:

- **무보관(no custody)**: donate가 받은 즉시 수혜자 주소로 전액 전달. 컨트랙트에
  돈이 머물지 않아 에스크로·인출 로직·운영 리스크가 없다. 상태 갱신 후 전송(CEI).
- **수혜자 검증은 운영자 수동** (작성자 등록부와 같은 패턴): profileUri에 수혜자
  실명·근거 공개. 기관 협력 검증은 후속 단계.
- **후원 내역은 서버 DB에 저장하지 않는다.** 웹의 후원 내역은 브라우저가
  `Donated` 이벤트를 RPC에서 직접 조회(queryFilter)해 렌더 — 검증과 같은
  무신뢰 원칙. 서버는 UI만 제공.

웹 통합: 인물 페이지에 후원 섹션(수혜자 등록 시에만 활성) — 누적액, 후원
내역(이벤트), 금액 입력 + MetaMask 후원 버튼. 새 JS 섬 `donate.js` 1개 추가
(총 4개: canonical, verify, wallet, donate).

## 임포트 — server/scripts/import-gonghun.js

- 공공데이터포털 공훈록 API 호출 → 응답 필드를 persons/sources로 매핑해 upsert.
- API 키는 `GONGHUN_API_KEY` env로만 받는다(커밋 금지). 키는 사용자가 data.go.kr에서
  발급.
- `--limit N`(기본 100), `--page` 지원. slug는 관리번호 기반(`gonghun-<관리번호>`),
  category는 `independence`, 출처는 공훈전자사료관 링크 자동 추가.
- 응답 → person 매핑 함수는 순수 함수로 분리해 픽스처 JSON으로 유닛 테스트.
  실제 API 호출은 키 없이는 실행 불가이므로 테스트 범위 밖(수동 검증).

## 범위 밖

기부금품법 대응(실서비스 전 필수), 원화 결제, 에스크로/조건부 집행, 6·25 개인
명부 임포트(구조화 API 미확인 — 수동 등록 유지), 수혜자 기관 협력 검증.
