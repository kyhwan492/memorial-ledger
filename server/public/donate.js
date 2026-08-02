// 후원 JS 섬: 수혜자·누적액·내역을 체인에서 직접 읽고(무신뢰), MetaMask로 후원한다.
const ABI = [
  "function beneficiaries(bytes32) view returns (address)",
  "function totalDonated(bytes32) view returns (uint256)",
  "function donate(bytes32) payable",
  "event Donated(bytes32 indexed personId, address indexed donor, uint256 amount)",
];

const section = document.getElementById("donate-section");
const status = document.getElementById("donate-status");
const history = document.getElementById("donate-history");

async function load() {
  const d = section.dataset;
  if (!d.donations) { status.textContent = "후원 컨트랙트가 설정되지 않았습니다"; return; }
  const provider = new ethers.JsonRpcProvider(d.rpcUrl);
  const c = new ethers.Contract(d.donations, ABI, provider);
  const to = await c.beneficiaries(d.personId);
  if (to === ethers.ZeroAddress) {
    status.textContent = "아직 검증된 수혜자가 등록되지 않았습니다";
    document.getElementById("donate-btn").disabled = true;
    return;
  }
  const total = await c.totalDonated(d.personId);
  status.innerHTML = `수혜자 <code>${to}</code> · 누적 ${ethers.formatEther(total)} ETH`;
  const events = await c.queryFilter(c.filters.Donated(d.personId), 0, "latest");
  history.innerHTML = events.slice(-20).reverse().map((e) =>
    `<li><code>${e.args.donor}</code> → ${ethers.formatEther(e.args.amount)} ETH</li>`
  ).join("");
}

document.getElementById("donate-btn")?.addEventListener("click", async () => {
  const d = section.dataset;
  const amount = document.getElementById("donate-amount").value;
  try {
    if (!window.ethereum) throw new Error("MetaMask가 설치되어 있지 않습니다");
    if (!amount || Number(amount) <= 0) throw new Error("금액을 입력하세요");
    const provider = new ethers.BrowserProvider(window.ethereum);
    await provider.send("eth_requestAccounts", []);
    const signer = await provider.getSigner();
    const c = new ethers.Contract(d.donations, ABI, signer);
    status.textContent = "서명 대기 중…";
    const tx = await c.donate(d.personId, { value: ethers.parseEther(amount) });
    status.textContent = "컨펌 대기 중…";
    await tx.wait();
    await load();
  } catch (e) {
    status.textContent = `실패: ${e.shortMessage ?? e.message}`;
  }
});

load().catch((e) => { status.textContent = `로드 실패: ${e.shortMessage ?? e.message}`; });
