// stdio MCP 서버 — 로직은 handlers.js에 있고 여기는 얇은 래퍼다.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { ethers } from "ethers";
import { openDb } from "../src/db.js";
import * as h from "./handlers.js";

const ABI = [
  "function latest(bytes32) view returns (bytes32, address, uint64)",
  "function getVersion(bytes32, uint256) view returns (bytes32, address, uint64)",
];

const db = openDb(process.env.DB_PATH ?? "data/ledger.db");
const provider = new ethers.JsonRpcProvider(process.env.RPC_URL ?? "http://127.0.0.1:8545");
const contract = new ethers.Contract(process.env.CONTRACT_ADDRESS ?? ethers.ZeroAddress, ABI, provider);

const server = new McpServer({ name: "memorial-ledger", version: "1.0.0" });
const json = (value) => ({ content: [{ type: "text", text: JSON.stringify(value, null, 2) }] });

server.registerTool("search_persons", {
  description: "인물 기록을 이름(부분 일치)·분류로 검색한다.",
  inputSchema: { q: z.string().optional(), category: z.string().optional() },
}, async (args) => json(h.searchPersons(db, args)));

server.registerTool("get_person", {
  description: "인물 상세 — 기본 정보, 출처 목록, 버전 이력(해시·tx·상태).",
  inputSchema: { slug: z.string() },
}, async ({ slug }) => json(h.getPersonDetail(db, slug)));

server.registerTool("verify_record", {
  description: "기록을 서버에서 재해싱해 온체인 해시와 대조한다. versionId 생략 시 최신 앵커 버전.",
  inputSchema: { slug: z.string(), versionId: z.number().optional() },
}, async (args) => json(await h.verifyRecord(db, { contract }, args)));

server.registerTool("list_change_requests", {
  description: "수정 요청 목록. status로 open/accepted/rejected 필터.",
  inputSchema: { status: z.string().optional() },
}, async (args) => json(h.listRequests(db, args)));

server.registerTool("submit_change_request", {
  description: "수정 요청을 제출한다. 실명·연락처·근거 출처가 모두 필수이며 공개된다.",
  inputSchema: {
    personSlug: z.string(), requesterName: z.string(), contact: z.string(),
    field: z.string(), proposed: z.string(), evidence: z.string(),
  },
}, async (args) => json(h.submitChangeRequest(db, args)));

server.registerTool("get_change_request", {
  description: "수정 요청 상세 — 요청 내용, 리뷰 이력(실명·평결·의견), 정족수 현황.",
  inputSchema: { id: z.number() },
}, async ({ id }) => json(h.getRequestDetail(db, id)));

server.registerTool("submit_review", {
  description: "심사 중(in_review)인 수정 요청에 리뷰를 제출한다. 실명·평결·의견이 모두 필수이며 공개된다.",
  inputSchema: {
    requestId: z.number(), reviewerName: z.string(),
    verdict: z.enum(["approve", "reject", "needs_work"]), comment: z.string(),
  },
}, async (args) => json(h.submitReview(db, args)));

await server.connect(new StdioServerTransport());
