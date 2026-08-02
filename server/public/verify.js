// 체인 검증 JS 섬: 서버가 준 기록을 브라우저에서 재해싱해 온체인 해시와 비교.
// 서버를 신뢰하지 않아도 되는 것이 목적이므로 반드시 클라이언트에서 실행한다.
import { canonicalize } from "/canonical.js";

const ABI = [
  "function latest(bytes32) view returns (bytes32, address, uint64)",
  "function getVersion(bytes32, uint256) view returns (bytes32, address, uint64)",
];

const btn = document.getElementById("verify-btn");
btn?.addEventListener("click", async () => {
  const d = btn.dataset;
  const out = document.getElementById("verify-result");
  out.textContent = "검증 중…";
  try {
    const res = await fetch(`/persons/${d.slug}/latest.json`);
    if (!res.ok) throw new Error("앵커된 버전이 없습니다");
    const { content } = await res.json();
    const localHash = ethers.keccak256(ethers.toUtf8Bytes(canonicalize(content)));
    const provider = new ethers.JsonRpcProvider(d.rpcUrl);
    const contract = new ethers.Contract(d.contract, ABI, provider);
    const [chainHash, author, ts] = await contract.latest(ethers.id(d.slug));
    if (chainHash === localHash) {
      const when = new Date(Number(ts) * 1000).toLocaleString("ko-KR");
      out.innerHTML = `<span class="badge ok">✔ 변조 없음</span> ${when} 앵커 · 작성자 <code>${author}</code>`;
    } else {
      out.innerHTML = `<span class="badge warn">✖ 해시 불일치</span> 오프체인 기록이 체인과 다릅니다`;
    }
  } catch (e) {
    out.textContent = `검증 실패: ${e.shortMessage ?? e.message}`;
  }
});

// 버전별 검증: 버튼이 여러 개라 이벤트 위임으로 받는다.
document.addEventListener("click", async (ev) => {
  const btn = ev.target.closest(".verify-version-btn");
  if (!btn) return;
  const d = btn.dataset;
  const out = btn.parentElement.querySelector(".verify-version-result");
  out.textContent = "검증 중…";
  try {
    const res = await fetch(`/versions/${d.versionId}.json`);
    if (!res.ok) throw new Error("앵커된 버전이 아닙니다");
    const { content } = await res.json();
    const localHash = ethers.keccak256(ethers.toUtf8Bytes(canonicalize(content)));
    const provider = new ethers.JsonRpcProvider(d.rpcUrl);
    const contract = new ethers.Contract(d.contract, ABI, provider);
    const [chainHash, author] = await contract.getVersion(d.personId, Number(d.chainIndex));
    out.innerHTML = chainHash === localHash
      ? `<span class="badge ok">✔ 일치</span> <code>${author}</code>`
      : `<span class="badge warn">✖ 불일치</span>`;
  } catch (e) {
    out.textContent = `검증 실패: ${e.shortMessage ?? e.message}`;
  }
});
