// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./utils/OwnableUpgradeable.sol";

contract Distributor is OwnableUpgradeable {
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize() external virtual initializer {
        __Ownable_init();
    }
}
