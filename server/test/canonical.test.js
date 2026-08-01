import test from "node:test";
import assert from "node:assert/strict";
import { canonicalize } from "../public/canonical.js";

test("키가 사전순으로 정렬된다 (재귀)", () => {
  assert.equal(
    canonicalize({ b: 1, a: { d: 2, c: 3 } }),
    '{"a":{"c":3,"d":2},"b":1}'
  );
});

test("같은 내용이면 키 순서와 무관하게 같은 문자열", () => {
  assert.equal(
    canonicalize({ name: "김구", birth: "1876" }),
    canonicalize({ birth: "1876", name: "김구" })
  );
});

test("문자열은 NFC로 정규화된다", () => {
  const nfd = "김구".normalize("NFD");
  assert.equal(canonicalize({ name: nfd }), canonicalize({ name: "김구" }));
});

test("배열 순서는 보존된다", () => {
  assert.equal(canonicalize({ a: [2, 1] }), '{"a":[2,1]}');
});

test("null과 숫자를 처리한다", () => {
  assert.equal(canonicalize({ a: null, b: 1.5 }), '{"a":null,"b":1.5}');
});
