// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "./interface/IRewardPoolV3.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC721/ERC721Upgradeable.sol";

contract RewardPoolV3 is OwnableUpgradeable, ERC721Upgradeable, IRewardPoolV3 {
    uint256 internal constant MIN_INCENTIVE_DURATION = 1;
    uint256 internal constant MAX_INCENTIVE_DURATION = 94608000; // 3 years

    IERC20 public stakingToken;
    uint96 public totalStaked;

    IERC20 public rewardToken;
    uint32 public updatedAt;
    uint32 public incentiveEndsAt;
    uint32 public unstakePeriod;

    uint256 public rewardRate;
    uint96 internal _allTimeReward;
    uint96 public rewardPerTokenStored;
    uint64 public nextStakeId;

    mapping(uint256 => Stake) public stakes;
    mapping(address => uint256) public stakedBy;
    mapping(address => uint256) public userRewardPerTokenPaid;

    mapping(address => uint256) internal _rewards;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        IERC20 stakingToken_,
        IERC20 rewardToken_,
        uint32 unstakePeriod_
    ) external initializer {
        if (stakingToken_ == rewardToken_) revert SameStakingAndRewardToken();
        __Ownable_init_unchained(msg.sender);
        __ERC721_init_unchained("Performance $AZUR", "pAZUR");

        stakingToken = stakingToken_;
        rewardToken = rewardToken_;
        unstakePeriod = unstakePeriod_;
    }

    /**
     * @dev Modifier that updates reward data for a specific account.
     * @param account The account whose rewards should be updated.
     */
    modifier updateReward(address account) {
        _updateReward(account);
        _;
    }

    /**
     * @notice Allows a user or contract to stake tokens on behalf of another address.
     * @param account The address to credit the stake to.
     * @param amount The amount of tokens to stake.
     */
    function stakeFor(
        address account,
        uint96 amount
    ) external updateReward(account) {
        if (amount == 0) revert ZeroAmount();
        if (account == address(this)) revert InvalidReceiver(account);

        stakingToken.transferFrom(msg.sender, address(this), amount);

        uint256 stakeId = nextStakeId++;
        uint32 withdrawAfter = uint32(block.timestamp) + unstakePeriod;

        stakes[stakeId] = Stake({amount: amount, withdrawAfter: withdrawAfter});
        stakedBy[account] += amount;
        totalStaked += amount;

        _mint(account, stakeId);

        emit Staked(stakeId, account, amount, withdrawAfter);
    }

    /**
     * @notice Claims accumulated reward tokens for a specific account.
     * @param account The address for which to claim rewards.
     */
    function claimReward(address account) external updateReward(account) {
        uint256 reward = _rewards[account];
        if (reward == 0) revert NoUnclaimedReward(account);

        _rewards[account] = 0;
        rewardToken.transfer(account, reward);

        emit RewardClaimed(account, reward);
    }

    /**
     * @notice Withdraws multiple stakes after the unstake period.
     * @param to The address to receive unstaked tokens.
     * @param stakeIds The IDs of the stakes to unstake.
     */
    function unstake(
        address to,
        uint256[] calldata stakeIds
    ) external updateReward(msg.sender) {
        uint256 totalAmount;
        for (uint256 i; i < stakeIds.length; ++i) {
            totalAmount += _processUnstake(stakeIds[i]);
        }
        stakingToken.transfer(to, totalAmount);
    }

    /**
     * @notice Owner: Updates the unstake period duration.
     * @param newUnstakePeriod The new unstake period duration in seconds.
     */
    function changeUnstakePeriod(uint32 newUnstakePeriod) external onlyOwner {
        unstakePeriod = newUnstakePeriod;
        emit UnstakePeriodChanged(newUnstakePeriod);
    }

    /**
     * @notice Owner: Starts or updates a staking incentive program.
     * @param extraReward Additional reward tokens to add to the program.
     * @param incentiveDuration Duration of the incentive in seconds.
     */
    function updateStakingIncentive(
        uint256 extraReward,
        uint256 incentiveDuration
    ) external onlyOwner updateReward(address(0)) {
        if (
            incentiveDuration < MIN_INCENTIVE_DURATION ||
            incentiveDuration > MAX_INCENTIVE_DURATION
        ) {
            revert InvalidIncentiveDuration(
                MIN_INCENTIVE_DURATION,
                MAX_INCENTIVE_DURATION
            );
        }

        uint256 reward = _remainingReward() + extraReward;
        if (reward == 0) revert NoReward();

        rewardRate = (reward * 1e18) / incentiveDuration;
        updatedAt = uint32(block.timestamp);
        incentiveEndsAt = uint32(block.timestamp + incentiveDuration);
        _allTimeReward += uint96(extraReward);

        rewardToken.transferFrom(msg.sender, address(this), extraReward);

        emit StakingIncentiveUpdated(reward, incentiveEndsAt);
    }

    /**
     * @notice Owner: Recovers excess tokens sent to the contract by mistake.
     * @param token The ERC20 token to recover.
     * @param to The recipient address.
     */
    function recover(IERC20 token, address to) external onlyOwner {
        uint256 amount = token.balanceOf(address(this));
        if (token == stakingToken) {
            amount -= totalStaked;
        } else if (token == rewardToken) {
            amount -= _allTimeReward;
        }

        if (amount == 0) revert NoAvailableBalance(address(token));

        SafeERC20.safeTransfer(token, to, amount);
    }

    /**
     * @notice Blank function. Token is non-transferable.
     */
    function transferFrom(
        address from,
        address to,
        uint256 tokenId
    ) public override {
        revert NonTransferableToken();
    }

    /**
     * @notice Returns the current reward per token value.
     * @return The accumulated reward per token.
     */
    function rewardPerToken() public view returns (uint256) {
        if (totalStaked == 0) return rewardPerTokenStored;
        return
            rewardPerTokenStored +
            ((uint256(rewardRate) * (_lastTimeRewardApplicable() - updatedAt)) /
                totalStaked);
    }

    /**
     * @notice Returns the total earned reward for a given account.
     * @param account The address for which to calculate rewards.
     * @return The total reward earned but not yet claimed.
     */
    function earnedReward(address account) public view returns (uint256) {
        return
            ((stakedBy[account] *
                (rewardPerToken() - userRewardPerTokenPaid[account])) / 1e18) +
            _rewards[account];
    }

    /**
     * @dev Processes unstake for a given stake ID.
     * @param stakeId The ID of the stake to withdraw.
     * @return The amount of tokens unstaked.
     */
    function _processUnstake(uint256 stakeId) internal returns (uint256) {
        address stakeOwner = ownerOf(stakeId);
        if (msg.sender != stakeOwner)
            revert OnlyStakeOwner(stakeId, stakeOwner);

        Stake storage stake = stakes[stakeId];
        if (block.timestamp < stake.withdrawAfter)
            revert StakeLocked(stakeId, stake.withdrawAfter - block.timestamp);

        uint96 amount = stake.amount;
        stakedBy[msg.sender] -= amount;
        totalStaked -= amount;

        delete stakes[stakeId];
        _burn(stakeId);

        emit Unstaked(stakeId, amount);

        return amount;
    }

    /**
     * @dev Updates the reward accounting for an account.
     * @param account The account to update rewards for.
     */
    function _updateReward(address account) internal {
        rewardPerTokenStored = uint96(rewardPerToken());
        updatedAt = uint32(_lastTimeRewardApplicable());
        if (account != address(0)) {
            _rewards[account] = earnedReward(account);
            userRewardPerTokenPaid[account] = rewardPerTokenStored;
        }
    }

    /**
     * @dev Calculates the remaining reward to be distributed.
     * @return The amount of reward remaining.
     */
    function _remainingReward() internal view returns (uint256) {
        return
            (rewardRate *
                (
                    incentiveEndsAt > block.timestamp
                        ? incentiveEndsAt - block.timestamp
                        : 0
                )) / 1e18;
    }

    /**
     * @dev Gets the latest timestamp eligible for reward calculation.
     * @return The applicable reward timestamp.
     */
    function _lastTimeRewardApplicable() internal view returns (uint256) {
        return
            block.timestamp < incentiveEndsAt
                ? block.timestamp
                : incentiveEndsAt;
    }
}
