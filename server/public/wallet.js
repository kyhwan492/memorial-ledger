// MetaMask로 anchor 트랜잭션을 서명하는 JS 섬. ethers는 UMD 전역.
const ABI = ["function anchor(bytes32 personId, bytes32 contentHash)"];

const btn = document.getElementById("anchor-btn");
btn?.addEventListener("click", async () => {
  const d = btn.dataset;
  const status = document.getElementById("anchor-status");
  try {
    if (!window.ethereum) throw new Error("MetaMask가 설치되어 있지 않습니다");
    const provider = new ethers.BrowserProvider(window.ethereum);
    await provider.send("eth_requestAccounts", []);
    const signer = await provider.getSigner();
    const contract = new ethers.Contract(d.contract, ABI, signer);
    status.textContent = "지갑 서명 대기 중…";
    const tx = await contract.anchor(d.personId, d.contentHash);
    status.textContent = "트랜잭션 컨펌 대기 중…";
    await tx.wait();
    await fetch(`/versions/${d.versionId}/anchored`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ txHash: tx.hash, wallet: await signer.getAddress() }),
    });
    location.href = d.returnUrl;
  } catch (e) {
    status.textContent = `실패: ${e.shortMessage ?? e.message}`;
  }
});
