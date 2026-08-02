import { openDb } from "./db.js";
import { createApp } from "./app.js";

// TOKENS='[{"symbol":"TKRW","address":"0x…","decimals":18}]'
function parseTokens() {
  try {
    return JSON.parse(process.env.TOKENS ?? "[]");
  } catch (e) {
    console.error(`TOKENS 파싱 실패 — 토큰 후원 비활성화: ${e.message}`);
    return [];
  }
}

const db = openDb(process.env.DB_PATH ?? "data/ledger.db");
const app = createApp(db, {
  rpcUrl: process.env.RPC_URL ?? "http://127.0.0.1:8545",
  contract: process.env.CONTRACT_ADDRESS ?? "",
  donations: process.env.DONATIONS_ADDRESS ?? "",
  tokens: parseTokens(),
});
const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => console.log(`memorial-ledger: http://localhost:${port}`));
