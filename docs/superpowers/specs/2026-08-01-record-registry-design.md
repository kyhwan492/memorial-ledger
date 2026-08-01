# 인물 기록 원장 (Record Registry) — v1 설계

날짜: 2026-08-01
상태: 승인됨

## 배경과 목표

블록체인 기반으로 대한민국 독립운동가, 6·25 참전용사, 천안함·연평도 등 사건 관련
인물의 기록을 등록·조회·검증하는 플랫폼의 첫 조각. 장기 구상(투명 후원, 친일파 DB,
실명 인증 자동화)은 이후 단계이며, v1은 **인물 기록 원장** 하나만 완성한다.

- 성격: 학습/포트폴리오 프로젝트. 실서비스 법적 요건(명예훼손, 기부금품법,
  본인확인기관 연동)은 범위 밖.
- 핵심 가치: 기록이 **언제, 누구에 의해** 등록됐고 이후 **변조되지 않았음**을
  누구나 서버를 신뢰하지 않고 검증할 수 있다.
- 원칙: 조회는 익명 누구나, 작성은 실명 프로필이 공개된 등록 작성자만.

블록체인이 보장하는 것은 불변성이지 진실성이 아니다. 내용의 사실성은 출처
(공훈전자사료관 등 공공데이터)와 작성자 실명 책임으로 담보한다.

## 접근 방식 결정

세 가지 대안 중 **A. 하이브리드 해시 앵커링** 채택:

- A (채택): 기록 원본은 오프체인(SQLite + 파일), 체인에는 해시·작성자·타임스탬프만.
- B (기각): 풀 온체인 — 한글 장문·문서 스캔 저장이 비용·검색 면에서 비현실적.
- C (보류): IPFS + 체인 — v1 완성 후 저장소 교체 확장으로 남김.

체인: 로컬 Hardhat 노드로 개발 → Ethereum Sepolia 테스트넷 배포.
툴체인: Hardhat (JS 기반 — 웹·서버·컨트랙트를 모두 JS/TS로 통일).

## 아키텍처

```
memorial-ledger/
├── contracts/   # Solidity + Hardhat (RecordRegistry 단일 컨트랙트)
├── web/         # Next.js — 공개 조회 + 작성자 전용 작성 + API
└── (SQLite)     # 기록 원본, 작성자, 출처
```

## 컨트랙트: RecordRegistry

```solidity
struct Version { bytes32 contentHash; address author; uint64 timestamp; }
mapping(bytes32 personId => Version[]) history;   // 추가만 가능한 버전 이력
mapping(address => string) authors;               // 지갑 → 공개 프로필 URI
```

- `anchor(bytes32 personId, bytes32 contentHash)` — 등록 작성자만 호출.
  이력 배열에 추가만 되며 삭제·수정 불가.
- `registerAuthor(address addr, string profileUri)` — owner만 호출.
  익명성 배제: 작성자 지갑마다 실명·자격 근거가 담긴 공개 프로필이 묶인다.
  v1에서 자격 검증은 운영자 수동 확인.
- 이벤트: `RecordAnchored(personId, contentHash, author, versionIndex)`,
  `AuthorRegistered(addr, profileUri)`.

## 오프체인 데이터 모델 (SQLite)

- `persons` — 이름, 분류(독립운동가 / 6·25 참전 / 천안함·연평도 등 확장 가능),
  생몰, 공적 요약
- `record_versions` — person별 정본 JSON, content_hash, tx_hash,
  상태(`draft → pending → anchored`)
- `authors` — 실명, 자격 증빙, 지갑 주소
- `sources` — 출처 (공훈전자사료관 링크, 문서 스캔 파일 경로)

**정본 직렬화 규칙(해시 재현성의 핵심)**: JSON 키 사전순 정렬, UTF-8 NFC 정규화,
공백 없는 직렬화. 이 규칙으로 만든 바이트열의 keccak256이 contentHash.

초기 데이터: 공훈전자사료관 공공데이터에서 독립유공자 ~100명 시드.

## 데이터 플로우

1. **작성자 등록**: 운영자가 실명·자격을 수동 확인 후 `registerAuthor` 호출.
   프로필은 웹에서 공개 열람 가능.
2. **기록 작성**: 웹 폼 → 서버가 정본 JSON + keccak256 생성 → 작성자가
   MetaMask로 `anchor()` 서명 → 컨펌 후 DB에 tx_hash 저장, 상태 `anchored`.
3. **조회**: 지갑 없이 누구나 검색·열람.
4. **검증**: 인물 페이지 "체인 검증" 버튼 → **브라우저가 직접** 공개 RPC로
   온체인 해시를 읽어, 서버가 준 JSON을 클라이언트에서 재해싱한 값과 비교.
   서버를 신뢰하지 않아도 검증되는 것이 이 구조의 존재 이유.
5. **수정**: 새 버전 JSON → 새 해시 anchor → 이전 버전 이력도 영구 공개.

## 에러 처리

- 트랜잭션 실패·미컨펌: `pending` 상태 유지 + 재시도 UI.
- 해시 불일치(오프체인 데이터가 체인과 다름): 인물 페이지에 경고 배지로 명시.
- 정본 직렬화는 단일 모듈에 격리해 웹·서버·검증이 같은 코드를 쓴다.

## 테스트

- 컨트랙트 유닛 테스트 (Hardhat): allowlist 강제, 이력 추가-전용, 이벤트 발행.
- 해시 재현성 테스트: 같은 기록 → 항상 같은 해시 (직렬화 모듈).
- E2E 1개: 기록 등록 → 앵커 → 조회 → 체인 검증 통과.

## 범위 밖 (다음 단계)

후원 시스템, 친일파/뉴라이트 DB(법적 검토 선행 필수), IPFS 저장, DAO 거버넌스,
본인확인기관 연동 실명 인증 자동화.
