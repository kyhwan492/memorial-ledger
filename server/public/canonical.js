// 정본 직렬화: 키 사전순(재귀) + 문자열/키 NFC 정규화 + 공백 없는 stringify.
// 서버와 브라우저가 이 파일 하나를 공유한다. 의존성 금지.
export function canonicalize(value) {
  return JSON.stringify(sort(value));
}

function sort(v) {
  if (Array.isArray(v)) return v.map(sort);
  if (v && typeof v === "object") {
    const pairs = Object.entries(v).map(([k, val]) => [k.normalize("NFC"), sort(val)]);
    pairs.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return Object.fromEntries(pairs);
  }
  if (typeof v === "string") return v.normalize("NFC");
  return v;
}
