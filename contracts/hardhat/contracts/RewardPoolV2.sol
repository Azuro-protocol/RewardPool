// SPDX-License-Identifier: MIT

pragma solidity 0.8.24;

import "./libraries/FixedMath.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20WrapperUpgradeable.sol";

contract RewardPoolV2 is ERC20WrapperUpgradeable, OwnableUpgradeable {
    using FixedMath for *;

    uint32 internal constant MIN_INCENTIVE_DURATION = 1;
    uint32 internal constant MAX_INCENTIVE_DURATION = 94608000; // 3 years

    struct WithdrawalRequest {
        uint128 value;
        address requester;
        uint32 withdrawAfter;
    }

    mapping(uint256 => WithdrawalRequest) public withdrawalRequests;

    uint256 public nextWithdrawalRequestId;
    uint128 public totalRequestedAmount;
    uint32 public withdrawalDelay;

    uint32 public incentiveEndsAt;

    uint32 internal _updatedAt;
    uint128 internal _exchangeRate;

    uint256 public rewardRate;

    event StakingIncentiveUpdated(uint128 reward, uint32 incentiveEndsAt);
    event WithdrawalDelayChanged(uint256 newWithdrawalDelay);
    event WithdrawalRequested(
        address indexed requester,
        uint256 indexed requestId,
        uint128 redeemAmount,
        uint128 withdrawalAmount,
        uint32 withdrawAfter
    );
    event WithdrawalRequestProcessed(
        uint256 indexed requestId,
        address indexed to
    );

    error InsufficientDeposit(uint256 value);
    error InvalidIncentiveDuration(uint32 minDuration, uint32 maxDuration);
    error NoReward();
    error OnlyRequesterCanWithdrawToAnotherAddress(address requester);
    error RequestDoesNotExist(uint256 requestId);
    error WithdrawalLocked(uint32 withdrawAfter);
    error ZeroAmount();

    /**
     * @notice Updates the exchange rate of the staking token to underlying token.
     */
    modifier updateExchangeRate() {
        _updateExchangeRate();
        _;
    }

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
     * @dev Owner: Updates the withdrawal delay period.
     * @param newWithdrawalDelay The new delay in seconds.
     */
    function changeWithdrawalDelay(
        uint32 newWithdrawalDelay
    ) external onlyOwner {
        withdrawalDelay = newWithdrawalDelay;
        emit WithdrawalDelayChanged(newWithdrawalDelay);
    }

    /**
     * @dev Owner: Mint wrapped token to cover any underlyingTokens that would have been transferred by mistake.
     * @param account The address to receive the tokens.
     */
    function recover(address account) external onlyOwner returns (uint256) {
        uint256 value = underlying().balanceOf(address(this)) -
            (calculateWithdrawalAmount(totalSupply()) +
                totalRequestedAmount +
                _remainingReward());
        _mint(account, value);

        return value;
    }

    /**
     * @dev Owner: Updates (starts) the staking incentive program.
     * @param extraReward The extra amount of underlying tokens to be distributed.
     * @param incentiveDuration The duration of the incentive in seconds.
     */
    function updateStakingIncentive(
        uint128 extraReward,
        uint32 incentiveDuration
    ) external onlyOwner updateExchangeRate {
        if (
            incentiveDuration < MIN_INCENTIVE_DURATION ||
            incentiveDuration > MAX_INCENTIVE_DURATION
        )
            revert InvalidIncentiveDuration(
                MIN_INCENTIVE_DURATION,
                MAX_INCENTIVE_DURATION
            );

        uint128 reward = _remainingReward() + extraReward;
        if (reward == 0) revert NoReward();

        rewardRate = uint128(reward.div(incentiveDuration));
        incentiveEndsAt = uint32(block.timestamp) + incentiveDuration;
        _updatedAt = uint32(block.timestamp);

        if (extraReward > 0)
            SafeERC20.safeTransferFrom(
                underlying(),
                msg.sender,
                address(this),
                extraReward
            );

        emit StakingIncentiveUpdated(reward, incentiveEndsAt);
    }

    /**
     * @dev Initiates a redemption request by burning a specified amount of staking tokens.
     * @param redeemAmount The number of staking tokens to burn for redemption.
     * @return The ID of the created redemption request.
     */
    function requestWithdrawal(
        uint128 redeemAmount
    ) external updateExchangeRate returns (uint256) {
        if (redeemAmount == 0) revert ZeroAmount();

        _burn(msg.sender, redeemAmount);

        uint256 requestId = nextWithdrawalRequestId++;
        uint128 withdrawalAmount = calculateWithdrawalAmount(redeemAmount);

        uint32 withdrawAfter = uint32(block.timestamp) + withdrawalDelay;

        withdrawalRequests[requestId] = WithdrawalRequest({
            value: withdrawalAmount,
            requester: msg.sender,
            withdrawAfter: withdrawAfter
        });
        totalRequestedAmount += withdrawalAmount;

        emit WithdrawalRequested(
            msg.sender,
            requestId,
            redeemAmount,
            withdrawalAmount,
            withdrawAfter
        );

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
     * @dev Allows a user to deposit underlying tokens and mint the corresponding number of wrapped tokens.
     */
    function depositFor(
        address account,
        uint256 value
    ) public override updateExchangeRate returns (bool) {
        address sender = msg.sender;
        if (sender == address(this)) {
            revert ERC20InvalidSender(address(this));
        }
        if (account == address(this)) {
            revert ERC20InvalidReceiver(account);
        }
        SafeERC20.safeTransferFrom(underlying(), sender, address(this), value);

        uint256 mintAmount = value.div(exchangeRate());
        if (mintAmount == 0) revert InsufficientDeposit(value);

        _mint(account, mintAmount);

        return true;
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
     * @dev Calculates the amount of underlying tokens that can be redeemed for a given staking token value.
     */
    function calculateWithdrawalAmount(
        uint256 redeemAmount
    ) public view returns (uint128) {
        return uint128(redeemAmount.mul(exchangeRate()));
    }

    /**
     * @dev Retrieves the actual exchange rate of the staking token to underlying token.
     */
    function exchangeRate() public view returns (uint128) {
        uint128 previousExchangeRate = _exchangeRate > 0
            ? _exchangeRate
            : uint128(FixedMath.ONE);

        uint256 totalSupply_ = totalSupply();
        if (totalSupply_ == 0) return previousExchangeRate;

        return
            uint128(
                previousExchangeRate +
                    (rewardRate * (_lastIncentiveTimestamp() - _updatedAt)) /
                    totalSupply_
            );
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

    /**
     * @dev Updates the exchange rate of the staking token to underlying token.
     */
    function _updateExchangeRate() internal {
        _exchangeRate = exchangeRate();
        _updatedAt = uint32(_lastIncentiveTimestamp());
    }

    /**
     * @dev Calculates the unallocated reward amount based on the remaining incentive time.
     */
    function _remainingReward() internal view returns (uint128) {
        return
            uint128(
                rewardRate.mul(incentiveEndsAt - _lastIncentiveTimestamp())
            );
    }

    /**
     * @dev Retrieves the most recent valid timestamp for the incentive program relative to the current moment.
     */
    function _lastIncentiveTimestamp() internal view returns (uint256) {
        return
            block.timestamp < incentiveEndsAt
                ? block.timestamp
                : incentiveEndsAt;
    }
}
