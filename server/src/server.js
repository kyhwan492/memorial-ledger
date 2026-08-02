import { openDb } from "./db.js";
import { createApp } from "./app.js";

const db = openDb(process.env.DB_PATH ?? "data/ledger.db");
const app = createApp(db, {
  rpcUrl: process.env.RPC_URL ?? "http://127.0.0.1:8545",
  contract: process.env.CONTRACT_ADDRESS ?? "",
  donations: process.env.DONATIONS_ADDRESS ?? "",
});
const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => console.log(`memorial-ledger: http://localhost:${port}`));
