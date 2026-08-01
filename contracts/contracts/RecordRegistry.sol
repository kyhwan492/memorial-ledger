// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract RecordRegistry {
    address public owner;
    mapping(address => string) public authorProfiles;

    event AuthorRegistered(address indexed author, string profileUri);

    constructor() {
        owner = msg.sender;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    function registerAuthor(address author, string calldata profileUri) external onlyOwner {
        require(bytes(profileUri).length != 0, "empty profile");
        authorProfiles[author] = profileUri;
        emit AuthorRegistered(author, profileUri);
    }

    struct Version {
        bytes32 contentHash;
        address author;
        uint64 timestamp;
    }

    mapping(bytes32 => Version[]) private history;

    event RecordAnchored(
        bytes32 indexed personId,
        bytes32 contentHash,
        address indexed author,
        uint256 versionIndex
    );

    modifier onlyAuthor() {
        require(bytes(authorProfiles[msg.sender]).length != 0, "not author");
        _;
    }

    function anchor(bytes32 personId, bytes32 contentHash) external onlyAuthor {
        history[personId].push(Version(contentHash, msg.sender, uint64(block.timestamp)));
        emit RecordAnchored(personId, contentHash, msg.sender, history[personId].length - 1);
    }

    function versionCount(bytes32 personId) external view returns (uint256) {
        return history[personId].length;
    }

    function getVersion(bytes32 personId, uint256 index)
        external view returns (bytes32, address, uint64)
    {
        Version storage v = history[personId][index];
        return (v.contentHash, v.author, v.timestamp);
    }

    function latest(bytes32 personId) external view returns (bytes32, address, uint64) {
        Version[] storage h = history[personId];
        require(h.length > 0, "no versions");
        Version storage v = h[h.length - 1];
        return (v.contentHash, v.author, v.timestamp);
    }
}
