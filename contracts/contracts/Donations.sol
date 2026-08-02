// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// 무보관 후원: 받은 즉시 수혜자에게 전액 전달한다. 컨트랙트에 잔고가 머물지 않는다.
contract Donations {
    address public owner;
    mapping(bytes32 => address payable) public beneficiaries;
    mapping(bytes32 => uint256) public totalDonated;

    event BeneficiaryRegistered(bytes32 indexed personId, address beneficiary, string profileUri);
    event Donated(bytes32 indexed personId, address indexed donor, uint256 amount);

    constructor() {
        owner = msg.sender;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    function registerBeneficiary(bytes32 personId, address payable to, string calldata profileUri)
        external onlyOwner
    {
        require(to != address(0), "zero address");
        require(bytes(profileUri).length != 0, "empty profile");
        beneficiaries[personId] = to;
        emit BeneficiaryRegistered(personId, to, profileUri);
    }

    function donate(bytes32 personId) external payable {
        address payable to = beneficiaries[personId];
        require(to != address(0), "no beneficiary");
        require(msg.value > 0, "zero amount");
        totalDonated[personId] += msg.value;
        emit Donated(personId, msg.sender, msg.value);
        (bool ok, ) = to.call{value: msg.value}("");
        require(ok, "transfer failed");
    }
}
