// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.28;

/// @title Fixed-point math tools
library FixedMath {
    uint256 constant ONE = 1e18;

    function mul(uint256 self, uint256 other) internal pure returns (uint256) {
        return (self * other) / ONE;
    }

    function div(uint256 self, uint256 other) internal pure returns (uint256) {
        return (self * ONE) / other;
    }
}
