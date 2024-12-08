// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.28;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract TestERC20 is Ownable, ERC20 {
    constructor(
        string memory name_,
        string memory symbol_,
        uint256 initMint
    ) ERC20(name_, symbol_) Ownable(msg.sender) {
        _mint(msg.sender, initMint);
    }

    function mint(address account, uint256 amount) external onlyOwner {
        _mint(account, amount);
    }
}
