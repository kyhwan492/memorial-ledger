// 체인 검증 JS 섬: 서버가 준 기록을 브라우저에서 재해싱해 온체인 해시와 비교.
// 서버를 신뢰하지 않아도 되는 것이 목적이므로 반드시 클라이언트에서 실행한다.
import { canonicalize } from "/canonical.js";

const ABI = ["function latest(bytes32) view returns (bytes32, address, uint64)"];

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
