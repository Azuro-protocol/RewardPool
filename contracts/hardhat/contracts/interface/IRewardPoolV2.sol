// SPDX-License-Identifier: MIT

pragma solidity 0.8.24;

interface IRewardPoolV2 {
    function changeWithdrawalDelay(uint256 newWithdrawalDelay) external;

    function depositFor(address account, uint256 value) external returns (bool);

    function recover(address account) external returns (uint256);

    function updateStakingIncentive(
        uint128 extraReward,
        uint32 incentiveDuration
    ) external;

    function requestWithdrawal(uint256 value) external returns (uint256);

    function withdrawTo(address account, uint256 requestId) external;

    function batchWithdrawTo(
        address account,
        uint256[] calldata requestIds
    ) external;

    function underlyingBalanceOf(address account) external view returns (uint256);

    function calculateWithdrawalAmount(
        uint256 redeemAmount
    ) external view returns (uint128);

    function exchangeRate() external view returns (uint128);
}
