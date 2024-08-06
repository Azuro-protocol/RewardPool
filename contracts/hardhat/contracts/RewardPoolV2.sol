// SPDX-License-Identifier: MIT

pragma solidity 0.8.24;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20WrapperUpgradeable.sol";

contract RewardPoolV2 is ERC20WrapperUpgradeable, OwnableUpgradeable {
    struct WithdrawalRequest {
        uint256 value;
        address requester;
        uint64 withdrawAfter;
    }

    // keccak256(abi.encode(uint256(keccak256("openzeppelin.storage.ERC20Wrapper")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 internal constant ERC20WrapperStorageLocation =
        0x3b5a617e0d4c238430871a64fe18212794b0c8d05a4eac064a8c9039fb5e0700;

    mapping(uint256 => WithdrawalRequest) public withdrawalRequests;

    uint256 public nextWithdrawalRequestId;
    uint256 public withdrawalDelay;

    event WithdrawalDelayChanged(uint256 newWithdrawalDelay);
    event WithdrawalRequested(
        address indexed requester,
        uint256 indexed requestId,
        uint256 value,
        uint64 withdrawAfter
    );
    event WithdrawalRequestProcessed(uint256 indexed requestId, address indexed to);

    error OnlyRequesterCanWithdrawToAnotherAddress(address requester);
    error RequestDoesNotExist(uint256 requestId);
    error WithdrawalLocked(uint256 withdrawAfter);
    error ZeroValue();

    function initialize(
        IERC20 underlyingToken_,
        string calldata name_,
        string calldata symbol_,
        uint256 unwrapDelay_
    ) external initializer {
        __Ownable_init_unchained(msg.sender);
        __ERC20_init_unchained(name_, symbol_);
        __ERC20Wrapper_init_unchained(underlyingToken_);
        withdrawalDelay = unwrapDelay_;
    }

    /**
     * @dev Updates the withdrawal delay period.
     * @param newWithdrawalDelay The new delay in seconds.
     */
    function changeWithdrawalDelay(
        uint256 newWithdrawalDelay
    ) external onlyOwner {
        withdrawalDelay = newWithdrawalDelay;
        emit WithdrawalDelayChanged(newWithdrawalDelay);
    }

    /**
     * @dev Mint wrapped token to cover any underlyingTokens that would have been transferred by mistake.
     * @param account The address to receive the tokens.
     */
    function recover(address account) external onlyOwner returns (uint256) {
        return _recover(account);
    }

    /**
     * @dev Initiates a withdrawal request by burning tokens.
     * @param value The amount of tokens to withdraw.
     */
    function requestWithdrawal(uint256 value) external returns (uint256) {
        if (value == 0) revert ZeroValue();

        _burn(_msgSender(), value);

        uint256 requestId = nextWithdrawalRequestId++;
        uint64 withdrawAfter = uint64(block.timestamp + withdrawalDelay);
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

        SafeERC20.safeTransfer(
            __getERC20WrapperStorage()._underlying,
            account,
            totalValue
        );
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
        SafeERC20.safeTransfer(
            __getERC20WrapperStorage()._underlying,
            account,
            value
        );

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
        uint256 value = request.value;
        uint256 withdrawAfter = request.withdrawAfter;
        address requester = request.requester;

        if (value == 0) revert RequestDoesNotExist(requestId);
        if (block.timestamp < withdrawAfter)
            revert WithdrawalLocked(withdrawAfter);
        if (account != requester && requester != msg.sender)
            revert OnlyRequesterCanWithdrawToAnotherAddress(requester);

        delete withdrawalRequests[requestId];
        emit WithdrawalRequestProcessed(requestId, account);

        return value;
    }

    /**
     * @dev Returns the storage reference for the ERC20 wrapped token.
     */
    function __getERC20WrapperStorage()
        internal
        pure
        returns (ERC20WrapperStorage storage $)
    {
        assembly {
            $.slot := ERC20WrapperStorageLocation
        }
    }
}
