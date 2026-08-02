// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// 로컬 데모·테스트 전용 토큰
contract TestToken is ERC20 {
    constructor() ERC20("Test KRW", "TKRW") {
        _mint(msg.sender, 1_000_000 ether);
    }
}
