# memorial-ledger (기억 원장)

독립운동가·참전용사 등 인물 기록을 오프체인(SQLite)에 저장하고, 기록의
keccak256 해시를 체인(RecordRegistry)에 앵커링하는 학습 프로젝트.
누구나 브라우저에서 서버를 신뢰하지 않고 기록의 변조 여부를 검증할 수 있다.

문서: 내부 동작 상세 `docs/architecture.md` · 설계 배경 `docs/superpowers/specs/2026-08-01-record-registry-design.md` · 웹 소개 페이지 `/about`

## 요구 사항

- Node 24+ (node:sqlite, node:test)
- MetaMask (기록 작성 시)

## 로컬 실행

```bash
# 1. 체인
cd contracts && npm install
npx hardhat node                                  # 터미널 1
npx hardhat run scripts/deploy.js --network localhost  # 터미널 2 — 주소 출력

# 2. 서버
cd ../server && npm install
node scripts/seed.js
node scripts/import-gonghun.js --limit 100        # 공훈록 실데이터 임포트 (키 불필요, 선택)
CONTRACT_ADDRESS=<배포 주소> DONATIONS_ADDRESS=<후원 주소> node src/server.js   # http://localhost:3000
```

기록 작성 테스트: MetaMask에 hardhat 계정 #1
(`0x59c6...690d`, 공개된 로컬 전용 테스트 프라이빗 키 — 실제 자산 금지)을 임포트하고 네트워크를
`http://127.0.0.1:8545` (chainId 31337)로 추가.

## 테스트

```bash
cd contracts && npx hardhat test   # 컨트랙트
cd server && npm test              # 서버 단위 + E2E
```

## MCP 서버

AI 도구(Claude 등)가 원장을 조회·검증하고 수정 요청을 제출할 수 있는 stdio MCP 서버.

```bash
claude mcp add memorial-ledger \
  --env DB_PATH=<repo>/server/data/ledger.db \
  --env RPC_URL=http://127.0.0.1:8545 \
  --env CONTRACT_ADDRESS=<배포 주소> \
  -- node <repo>/server/mcp/server.js
```

env: `DB_PATH`(기본 `data/ledger.db`, 서버와 같은 DB) · `RPC_URL`(기본 `http://127.0.0.1:8545`) ·
`CONTRACT_ADDRESS`(RecordRegistry 주소 — `verify_record`에만 필요).

도구: `search_persons` · `get_person` · `verify_record` · `list_change_requests` ·
`submit_change_request` · `get_change_request`(리뷰 이력·정족수 포함 상세) ·
`submit_review`(심사 중인 요청에 평결 제출). `verify_record`는 **서버 측** 재해싱 결과이므로 서버를 신뢰하지 않는
독립 검증은 웹 브라우저의 검증 버튼을 쓴다.

## Sepolia 배포

```bash
cd contracts
SEPOLIA_RPC_URL=<rpc> PRIVATE_KEY=<key> npx hardhat run scripts/deploy.js --network sepolia
```
