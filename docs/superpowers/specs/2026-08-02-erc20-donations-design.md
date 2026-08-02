# ERC-20 후원 (v5) 설계

날짜: 2026-08-02
상태: 승인됨

## 목표

ETH 외에 ERC-20 토큰(스테이블코인 등)으로도 후원할 수 있게 한다. 무보관 원칙
유지 — 토큰은 후원자 지갑에서 수혜자 지갑으로 직접 이동하고, 컨트랙트는 회계
이벤트만 남긴다.

## 컨트랙트 (Donations.sol 확장)

```solidity
mapping(bytes32 => mapping(address => uint256)) public totalDonatedToken; // personId → token → 누적
function donateToken(bytes32 personId, address token, uint256 amount) external
event DonatedToken(bytes32 indexed personId, address indexed donor, address indexed token, uint256 amount)
```

- 검증: 수혜자 미등록 revert "no beneficiary", 0 수량 revert "zero amount".
- 전송: OpenZeppelin `SafeERC20.safeTransferFrom(donor → beneficiary)` —
  USDT처럼 반환값 없는 비표준 토큰 대응. **의존성 추가: `@openzeppelin/contracts`**
  (컨트랙트 업계 표준 라이브러리 — 직접 구현하지 않는다).
- CEI: 누적·이벤트 후 외부 전송.
- 토큰 allowlist는 온체인에 두지 않는다 — 아무 토큰이나 이벤트를 남길 수 있으나
  웹이 설정된 토큰만 표시한다(잡토큰은 UI에서 걸러짐). ponytail: 온체인 allowlist는
  운영 부담 대비 이득 없음, 실서비스 시 재검토.
- 데모·테스트용 `TestToken.sol` (OZ ERC20, 생성자에서 배포자에게 민트).

## 웹

- 서버 config에 `tokens: [{symbol, address, decimals}]` — env `TOKENS`(JSON 문자열,
  기본 `[]`). person.ejs donate-section data 속성으로 전달.
- donate.js: 통화 선택(ETH + 설정 토큰). ERC-20이면 approve → donateToken 2단계
  (버튼 상태로 안내). 누적액·내역에 토큰 후원 포함(`DonatedToken` 이벤트,
  `formatUnits(decimals)` 표시).
- deploy.js: 로컬 데모용 TestToken 배포 + 데모 계정들에 분배, 서버 실행 안내에
  `TOKENS` env 라인 출력.

## 범위 밖

온체인 토큰 allowlist, DEX 스왑, 멀티체인 배포, ERC-4337.
