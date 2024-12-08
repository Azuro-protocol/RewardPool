// SPDX-License-Identifier: MIT

pragma solidity 0.8.28;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20WrapperUpgradeable.sol";

// https://github.com/Azuro-protocol/RewardPool/commit/f860fcfa046bc4c83b381afcc0412001620ea572
contract OldRewardPoolV2 is ERC20WrapperUpgradeable, OwnableUpgradeable {
    struct WithdrawalRequest {
        uint128 value;
        address requester;
        uint32 withdrawAfter;
    }

    mapping(uint256 => WithdrawalRequest) public withdrawalRequests;

    uint256 public nextWithdrawalRequestId;
    uint128 public totalRequestedAmount;
    uint32 public withdrawalDelay;

    event WithdrawalDelayChanged(uint256 newWithdrawalDelay);
    event WithdrawalRequested(
        address indexed requester,
        uint256 indexed requestId,
        uint128 value,
        uint32 withdrawAfter
    );
    event WithdrawalRequestProcessed(
        uint256 indexed requestId,
        address indexed to
    );

    error OnlyRequesterCanWithdrawToAnotherAddress(address requester);
    error RequestDoesNotExist(uint256 requestId);
    error WithdrawalLocked(uint32 withdrawAfter);
    error ZeroValue();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        IERC20 underlyingToken_,
        string calldata name_,
        string calldata symbol_,
        uint32 withdrawalDelay_
    ) external initializer {
        __Ownable_init_unchained(msg.sender);
        __ERC20_init_unchained(name_, symbol_);
        __ERC20Wrapper_init_unchained(underlyingToken_);
        withdrawalDelay = withdrawalDelay_;
    }

    /**
     * @dev Updates the withdrawal delay period.
     * @param newWithdrawalDelay The new delay in seconds.
     */
    function changeWithdrawalDelay(
        uint32 newWithdrawalDelay
    ) external onlyOwner {
        withdrawalDelay = newWithdrawalDelay;
        emit WithdrawalDelayChanged(newWithdrawalDelay);
    }

    /**
     * @dev Mint wrapped token to cover any underlyingTokens that would have been transferred by mistake.
     * @param account The address to receive the tokens.
     */
    function recover(address account) external onlyOwner returns (uint256) {
        uint256 value = underlying().balanceOf(address(this)) -
            (totalRequestedAmount + totalSupply());
        _mint(account, value);
        return value;
    }

    /**
     * @dev Initiates a withdrawal request by burning tokens.
     * @param value The amount of tokens to withdraw.
     */
    function requestWithdrawal(uint128 value) external returns (uint256) {
        if (value == 0) revert ZeroValue();

        totalRequestedAmount += value;
        _burn(_msgSender(), value);

        uint256 requestId = nextWithdrawalRequestId++;
        uint32 withdrawAfter = uint32(block.timestamp + withdrawalDelay);
        withdrawalRequests[requestId] = WithdrawalRequest({
            value: value,
            requester: msg.sender,
            withdrawAfter: withdrawAfter
        });

        emit WithdrawalRequested(msg.sender, requestId, value, withdrawAfter);

        return requestId;
    }

    /**
     * @dev Processes multiple withdrawal requests and transfers tokens.
     * @param account The address to receive the tokens.
     * @param requestIds The IDs of the withdrawal requests.
     */
    function batchWithdrawTo(
        address account,
        uint256[] calldata requestIds
    ) external {
        uint256 numRequests = requestIds.length;
        uint256 totalValue;
        for (uint256 i; i < numRequests; ++i) {
            totalValue += _processWithdrawalRequest(account, requestIds[i]);
        }

        SafeERC20.safeTransfer(underlying(), account, totalValue);
    }

    /**
     * @dev Processes a single withdrawal request and transfers tokens.
     * @param account The address to receive the tokens.
     * @param requestId The ID of the withdrawal request.
     */
    function withdrawTo(
        address account,
        uint256 requestId
    ) public override returns (bool) {
        uint256 value = _processWithdrawalRequest(account, requestId);
        SafeERC20.safeTransfer(underlying(), account, value);

        return true;
    }

    /**
     * @dev Handle a withdrawal request.
     * @param account The address to transfer tokens to.
     * @param requestId The ID of the withdrawal request.
     * @return value The amount of tokens to withdraw.
     */
    function _processWithdrawalRequest(
        address account,
        uint256 requestId
    ) internal returns (uint256) {
        WithdrawalRequest storage request = withdrawalRequests[requestId];
        uint128 value = request.value;
        uint32 withdrawAfter = request.withdrawAfter;
        address requester = request.requester;

        if (value == 0) revert RequestDoesNotExist(requestId);
        if (block.timestamp < withdrawAfter)
            revert WithdrawalLocked(withdrawAfter);
        if (account != requester && requester != msg.sender)
            revert OnlyRequesterCanWithdrawToAnotherAddress(requester);

        totalRequestedAmount -= uint128(value);
        delete withdrawalRequests[requestId];
        emit WithdrawalRequestProcessed(requestId, account);

        return value;
    }
}
