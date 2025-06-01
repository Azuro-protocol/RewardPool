// SPDX-License-Identifier: MIT

pragma solidity 0.8.28;

import "./interface/IRewardPoolV3.sol";
import "./libraries/FixedMath.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20WrapperUpgradeable.sol";

contract RewardPoolV2 is ERC20WrapperUpgradeable, OwnableUpgradeable {
    using FixedMath for uint128;
    using FixedMath for uint256;

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
    uint32 public incentiveStartedAt;
    uint128 internal _exchangeRate;

    uint128 public reward;
    uint256 public rewardRate;

    IRewardPoolV3 rewardPoolV3;

    event Migrated(
        address account,
        IRewardPoolV3 rewardPoolV3,
        uint256 redeemAmount,
        uint256 stakeAmount
    );
    event RewardPoolV3Changed(IRewardPoolV3 newRewardPoolV3);
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

    error InsufficientDeposit(uint256 amount);
    error InvalidIncentiveDuration(uint32 minDuration, uint32 maxDuration);
    error NoReward();
    error OnlyRequesterCanWithdrawToAnotherAddress(address requester);
    error RequestDoesNotExist(uint256 requestId);
    error RewardPoolV3NotSet();
    error WithdrawalLocked(uint32 withdrawAfter);
    error ZeroAmount();

    /**
     * @notice Updates the exchange rate of the staking token to underlying token.
     */
    modifier updateExchangeRate() {
        _exchangeRate = exchangeRate();
        _updatedAt = uint32(_lastIncentiveTimestamp());
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
     * @notice Owner's function that is used to change the address of V3 staking contract to migrate.
     */
    function changeRewardPoolV3(
        IRewardPoolV3 newRewardPoolV3
    ) external onlyOwner {
        rewardPoolV3 = newRewardPoolV3;
        emit RewardPoolV3Changed(newRewardPoolV3);
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
     * @dev Owner: Recover underlying tokens that would have been transferred by mistake.
     * @param account The address to receive the tokens.
     * @return recoveredAmount The amount of recovered tokens
     */
    function recover(
        address account
    ) external onlyOwner returns (uint256 recoveredAmount) {
        recoveredAmount =
            underlying().balanceOf(address(this)) -
            (calculateWithdrawalAmount(totalSupply()) +
                totalRequestedAmount +
                _remainingReward());

        underlying().transfer(account, recoveredAmount);
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

        uint128 totalReward = _remainingReward() + extraReward;
        if (totalReward == 0) revert NoReward();

        reward = totalReward;
        rewardRate = uint128(totalReward.div(incentiveDuration));
        incentiveStartedAt = uint32(block.timestamp);
        incentiveEndsAt = uint32(block.timestamp) + incentiveDuration;

        _updatedAt = uint32(block.timestamp);

        if (extraReward > 0)
            underlying().transferFrom(msg.sender, address(this), extraReward);

        emit StakingIncentiveUpdated(totalReward, incentiveEndsAt);
    }

    /**
     * @dev Initiates a redemption request by burning a specified amount of staking tokens.
     * @param redeemAmount The number of staking tokens to burn for redemption.
     * @return requestId The ID of the created redemption request.
     */
    function requestWithdrawal(
        uint128 redeemAmount
    ) external updateExchangeRate returns (uint256 requestId) {
        if (redeemAmount == 0) revert ZeroAmount();

        _burn(msg.sender, redeemAmount);

        requestId = nextWithdrawalRequestId++;
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
        uint256 totalAmount;
        for (uint256 i; i < numRequests; ++i) {
            totalAmount += _processWithdrawalRequest(account, requestIds[i]);
        }

        underlying().transfer(account, totalAmount);
    }

    /**
     * @dev Calculates the amount of underlying tokens that can be redeemed for a given account.
     */
    function underlyingBalanceOf(
        address account
    ) external view returns (uint256) {
        return calculateWithdrawalAmount(balanceOf(account));
    }

    /**
     * @dev Allows a user to deposit underlying tokens and mint the corresponding number of wrapped tokens.
     */
    function depositFor(
        address account,
        uint256 amount
    ) public override updateExchangeRate returns (bool) {
        if (account == address(this)) revert ERC20InvalidReceiver(account);

        underlying().transferFrom(msg.sender, address(this), amount);

        uint256 mintAmount = amount.div(exchangeRate());
        if (mintAmount == 0) revert InsufficientDeposit(amount);

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
        uint256 amount = _processWithdrawalRequest(account, requestId);
        underlying().transfer(account, amount);

        return true;
    }

    /**
     * @dev Migrates a specified amount of tokens to the RewardPoolV3 contract.
     * @param redeemAmount The amount of tokens to convert into underlying tokens and migrate.
     */
    function migrateToV3(uint256 redeemAmount) external updateExchangeRate {
        IRewardPoolV3 rewardPoolV3_ = rewardPoolV3;
        if (address(rewardPoolV3_) == address(0)) revert RewardPoolV3NotSet();
        if (redeemAmount == 0) revert ZeroAmount();

        _burn(msg.sender, redeemAmount);
        uint256 stakeAmount = calculateWithdrawalAmount(redeemAmount);

        underlying().approve(address(rewardPoolV3_), stakeAmount);
        rewardPoolV3_.stakeFor(msg.sender, uint96(stakeAmount));

        emit Migrated(msg.sender, rewardPoolV3_, redeemAmount, stakeAmount);
    }

    /**
     * @dev Calculates the amount of underlying tokens that can be redeemed for a given staking token amount.
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
     * @return withdrawalAmount The amount of tokens to withdraw.
     */
    function _processWithdrawalRequest(
        address account,
        uint256 requestId
    ) internal returns (uint256 withdrawalAmount) {
        WithdrawalRequest storage request = withdrawalRequests[requestId];
        withdrawalAmount = request.value;
        uint32 withdrawAfter = request.withdrawAfter;
        address requester = request.requester;

        if (withdrawalAmount == 0) revert RequestDoesNotExist(requestId);
        if (block.timestamp < withdrawAfter)
            revert WithdrawalLocked(withdrawAfter);
        if (account != requester && requester != msg.sender)
            revert OnlyRequesterCanWithdrawToAnotherAddress(requester);

        totalRequestedAmount -= uint128(withdrawalAmount);
        delete withdrawalRequests[requestId];

        emit WithdrawalRequestProcessed(requestId, account);
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
