// 후원 JS 섬: 수혜자·누적액·내역을 체인에서 직접 읽고(무신뢰), MetaMask로 후원한다.
const ABI = [
  "function beneficiaries(bytes32) view returns (address)",
  "function totalDonated(bytes32) view returns (uint256)",
  "function totalDonatedToken(bytes32, address) view returns (uint256)",
  "function donate(bytes32) payable",
  "function donateToken(bytes32 personId, address token, uint256 amount)",
  "event Donated(bytes32 indexed personId, address indexed donor, uint256 amount)",
  "event DonatedToken(bytes32 indexed personId, address indexed donor, address indexed token, uint256 amount)",
];
const ERC20_ABI = [
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
];

const section = document.getElementById("donate-section");
const status = document.getElementById("donate-status");
const history = document.getElementById("donate-history");
const btn = document.getElementById("donate-btn");
const select = document.getElementById("donate-token");
// 설정된 토큰만 표시한다 — 잡토큰 이벤트는 UI에서 걸러진다
const tokens = JSON.parse(section.dataset.tokens || "[]");
const tokenBy = (addr) =>
  tokens.find((t) => t.address.toLowerCase() === addr.toLowerCase());

async function load() {
  const d = section.dataset;
  if (!d.donations) { status.textContent = "후원 컨트랙트가 설정되지 않았습니다"; return; }
  const provider = new ethers.JsonRpcProvider(d.rpcUrl);
  const c = new ethers.Contract(d.donations, ABI, provider);
  const to = await c.beneficiaries(d.personId);
  if (to === ethers.ZeroAddress) {
    status.textContent = "아직 검증된 수혜자가 등록되지 않았습니다";
    btn.disabled = true;
    return;
  }
  const totals = [`${ethers.formatEther(await c.totalDonated(d.personId))} ETH`];
  for (const t of tokens) {
    const sum = await c.totalDonatedToken(d.personId, t.address);
    if (sum > 0n) totals.push(`${ethers.formatUnits(sum, t.decimals)} ${t.symbol}`);
  }
  status.innerHTML = `수혜자 <code>${to}</code> · 누적 ${totals.join(" · ")}`;

  const events = await c.queryFilter(c.filters.Donated(d.personId), 0, "latest");
  const tokenEvents = tokens.length
    ? (await c.queryFilter(c.filters.DonatedToken(d.personId), 0, "latest"))
        .filter((e) => tokenBy(e.args.token))
    : [];
  history.innerHTML = [...events, ...tokenEvents]
    .sort((a, b) => a.blockNumber - b.blockNumber || a.index - b.index)
    .slice(-20).reverse()
    .map((e) => {
      const t = e.args.token && tokenBy(e.args.token);
      const value = t
        ? `${ethers.formatUnits(e.args.amount, t.decimals)} ${t.symbol}`
        : `${ethers.formatEther(e.args.amount)} ETH`;
      return `<li><code>${e.args.donor}</code> → ${value}</li>`;
    }).join("");
}

async function donateToken(signer, d, token, amount) {
  const value = ethers.parseUnits(amount, token.decimals);
  const erc20 = new ethers.Contract(token.address, ERC20_ABI, signer);
  const owner = await signer.getAddress();
  if ((await erc20.allowance(owner, d.donations)) < value) {
    btn.textContent = "1/2 승인 중…";
    status.textContent = `${token.symbol} 사용 승인 서명 대기 중…`;
    await (await erc20.approve(d.donations, value)).wait();
  }
  btn.textContent = "2/2 후원 중…";
  status.textContent = "후원 서명 대기 중…";
  const c = new ethers.Contract(d.donations, ABI, signer);
  await (await c.donateToken(d.personId, token.address, value)).wait();
}

btn?.addEventListener("click", async () => {
  const d = section.dataset;
  const amount = document.getElementById("donate-amount").value;
  const label = btn.textContent;
  try {
    if (!window.ethereum) throw new Error("MetaMask가 설치되어 있지 않습니다");
    if (!amount || Number(amount) <= 0) throw new Error("금액을 입력하세요");
    const provider = new ethers.BrowserProvider(window.ethereum);
    await provider.send("eth_requestAccounts", []);
    const signer = await provider.getSigner();
    const token = select?.value && tokenBy(select.value);
    if (token) {
      await donateToken(signer, d, token, amount);
    } else {
      const c = new ethers.Contract(d.donations, ABI, signer);
      status.textContent = "서명 대기 중…";
      const tx = await c.donate(d.personId, { value: ethers.parseEther(amount) });
      status.textContent = "컨펌 대기 중…";
      await tx.wait();
    }
    await load();
  } catch (e) {
    status.textContent = `실패: ${e.shortMessage ?? e.message}`;
  } finally {
    btn.textContent = label;
  }
});

load().catch((e) => { status.textContent = `로드 실패: ${e.shortMessage ?? e.message}`; });
