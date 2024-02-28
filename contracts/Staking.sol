// SPDX-License-Identifier: MIT

pragma solidity 0.8.24;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "./interface/IStaking.sol";

/*
This contract is used for distributing staking rewards for staking to various nodes.
At each rewards distribution for given node, they are distributed proportionate to "stake powers".

Stake power for a given stake is a value calculated following way:
1. At first distribution (after staking) it is share of stake amount equal to share of time passed between stake 
and this distribution to time passed between previous distribution and this distribution. This is named partial power.
2. At subsequent distributions stake power is equal to staked amount. This is named full power.

Therefore, reward calculations are split into 2 parts: for full stakes and for partial stakes.

Calculations for full stakes is node through increasing node's "rewardPerPower" value 
(that equals to total accrued reward per 1 unit of power, then magnified by MAGNITUDE to calculate small values correct)
Therefore for a stake reward for periods where it was full is it's amount multiplied by difference of
node's current rewardPerPower and value of rewardPerPower at distribution where stake happened (first distribution)

To calculate partial stake reward (happenes only 1 for each stake) other mechanism is used.
At first distribution share of reward for given stake among all rewards for partial stakes in that distribution
is equal to share of product of stake amount and time passed between stake and distribution to sum of such products
for all partial stakes. These products are named "powerXTime" in the codebase;
For correct calculation of sum of powerXTimes we calculate it as difference of maxTotalPowerXTime 
(sum of powerXTimes if all partial stakes were immediately after previous distribution) and sum of powerXTime deltas
(differences between maximal possible powerXTime and real powerXTime for each stake).
Such way allows to calculate all values using O(1) of operations in one transaction
*/

contract Staking is OwnableUpgradeable, IStaking {
    using SafeERC20 for IERC20;
    using SafeCast for uint256;

    /**
     * @notice Magnitude by which values are multiplied in reward calculations
     */
    uint256 private constant MAGNITUDE = type(uint128).max;

    /**
     * @notice Token user in staking
     */
    IERC20 public token;

    /**
     * @notice Mapping of distribution ID's to their information
     */
    mapping(uint32 => Distribution) public distributions;

    /**
     * @notice Mapping of stake ID's to their information
     */
    mapping(uint256 => Stake) public stakes;

    /**
     * @notice Mapping of stake ID's to their information requested to be unstaked
     */
    mapping(uint256 => Unstake) public unstakes;

    uint256 public lastStakeId;
    uint32 public lastDistributionId;
    uint96 public totalStaked;
    uint256 public rewardPerPower;
    uint256 public unstakePeriod;

    /**
     * @notice Contract's initializer
     * @param token_ Contract of token used in staking
     */
    function initialize(
        IERC20 token_,
        uint256 unstakePeriod_
    ) external initializer {
        __Ownable_init(msg.sender);
        token = token_;
        unstakePeriod = unstakePeriod_;
        distributions[0].time = block.timestamp.toUint64();
    }

    /**
     * @notice Owner's function that is used to change unstake period
     * @param newUnstakePeriod new unstake period, will be actual for new unstake requests
     */
    function changeUnstakePeriod(uint256 newUnstakePeriod) external onlyOwner {
        unstakePeriod = newUnstakePeriod;
        emit UnstakePeriodChanged(newUnstakePeriod);
    }

    /**
     * @notice Owner's function that is used to distribute rewards for stakes
     * @dev Function transfers distributed reward to contract, approval is required in prior
     * @param reward rewards to distribution
     */
    function distributeReward(uint256 reward) external onlyOwner {
        token.safeTransferFrom(msg.sender, address(this), reward);
        _distributeReward(reward);

        emit RewardDistributed(reward);
    }

    /**
     *  @notice Request to unstake list of given stakes (and collects reward in process)
     *  @param stakeIds List of IDs of the stakes to request withdraw
     */
    function batchRequestUnstake(uint256[] calldata stakeIds) external {
        for (uint256 i = 0; i < stakeIds.length; i++)
            _requestUnstake(stakeIds[i]);
    }

    /**
     *  @notice Unstakes list of given stakes (and collects reward in process)
     *  @param stakeIds List of IDs of the stakes to withdraw
     */
    function batchUnstake(uint256[] calldata stakeIds) external {
        for (uint256 i = 0; i < stakeIds.length; i++) _unstake(stakeIds[i]);
    }

    /**
     *  @notice Withdraws accumulated reward for list of given stakes
     *  @param stakeIds List of IDs of the stakes to collect reward for
     */
    function batchWithdrawReward(uint256[] calldata stakeIds) public {
        for (uint256 i = 0; i < stakeIds.length; i++) {
            _withdrawReward(stakeIds[i]);
        }
    }

    /**
     *  @notice Request to unstake given stake (and collects reward in process)
     *  @param stakeId ID of the stake to request withdraw
     */
    function requestUnstake(uint256 stakeId) external {
        _requestUnstake(stakeId);
    }

    /**
     * @notice Creates new stake
     * @dev Transfers `amount` of `token` to the contract, approval is required in prior
     * @param amount Amount to stake
     * @return stakeId ID of the created stake
     */
    function stakeFor(uint96 amount) external returns (uint256 stakeId) {
        // This stake's first distribution will be next distribution
        uint32 distributionId = lastDistributionId + 1;

        stakeId = ++lastStakeId;
        stakes[stakeId] = Stake({
            owner: msg.sender,
            amount: amount,
            time: block.timestamp.toUint64(),
            firstDistributionId: distributionId,
            withdrawnReward: 0
        });

        totalStaked += amount;

        // Amount staked in current distribution is stored to calculate total reward for partial power in future
        distributions[distributionId].stakedIn += amount;

        // Sum of powerXTimeDeltas is increased
        uint256 timeDelta = block.timestamp -
            distributions[distributionId - 1].time;
        distributions[distributionId].powerXTimeDelta += (timeDelta * amount)
            .toUint160();

        token.safeTransferFrom(msg.sender, address(this), amount);

        emit Staked(stakeId, msg.sender, amount);
    }

    /**
     *  @notice Unstakes given stake (and collects reward in process)
     *  @param stakeId ID of the stake to withdraw
     */
    function unstake(uint256 stakeId) external {
        _unstake(stakeId);
    }

    /**
     *  @notice Withdraws accumulated reward for given stake
     *  @param stakeId ID of the stake to collect reward for
     */
    function withdrawReward(uint256 stakeId) public {
        _withdrawReward(stakeId);
    }

    /**
     *  @notice Returns current reward of given stake
     *  @param stakeId ID of the stake to get reward for
     *  @return Current reward
     */
    function rewardOf(uint256 stakeId) public view returns (uint96) {
        return _accumulatedRewardOf(stakeId) - stakes[stakeId].withdrawnReward;
    }

    /**
     *  @notice Internal function that processes reward distribution for one node
     *  @param reward Distributed reward
     */
    function _distributeReward(uint256 reward) private {
        uint32 distributionId = ++lastDistributionId;
        Distribution storage distribution = distributions[distributionId];
        uint256 stakedIn = distribution.stakedIn;

        // Total full power is simply sum of all stakes before this distribution
        uint256 fullPower = totalStaked - stakedIn;

        uint256 partialPower;
        if (stakedIn > 0) {
            // Maximal possible (not actual) sum of powerXTimes in this distribution
            uint256 maxTotalPowerXTime = stakedIn *
                (block.timestamp - distributions[distributionId - 1].time);

            // Total partial power is share of staked amount equal to share of real totalPowerXTime to maximal
            partialPower =
                (stakedIn *
                    (maxTotalPowerXTime - distribution.powerXTimeDelta)) /
                maxTotalPowerXTime;
        }

        uint256 power = fullPower + partialPower;
        // Reward for full powers is calculated proporionate to total full and partial powers
        if (power == 0) revert NoStakes();
        uint256 rewardForFullPower = (reward * fullPower) / power;

        // If full powers actually exist in this distribution we calculate (magnified) rewardPerPower delta
        uint256 rewardPerPowerDelta;
        if (fullPower > 0) {
            rewardPerPowerDelta = (MAGNITUDE * rewardForFullPower) / fullPower;
        }

        rewardPerPower += rewardPerPowerDelta;
        distribution.time = block.timestamp.toUint64();
        distribution.reward = reward.toUint96();
        distribution.rewardPerPower = rewardPerPower;
        // We store only total reward for partial powers
        distribution.rewardForPartialPower = (reward - rewardForFullPower)
            .toUint96();
    }

    /**
     *  @notice Internal function that collects reward for given stake
     *  @param stakeId ID of the stake
     */
    function _withdrawReward(uint256 stakeId) private {
        if (stakes[stakeId].owner != msg.sender) revert NotStakeOwner();

        uint96 reward = rewardOf(stakeId);
        stakes[stakeId].withdrawnReward += reward;
        token.safeTransfer(msg.sender, reward);

        emit RewardWithdrawn(stakeId, reward);
    }

    /**
     *  @notice Internal function that request unstake of given stake
     *  @param stakeId ID of the stake
     */
    function _requestUnstake(uint256 stakeId) private {
        _withdrawReward(stakeId);

        uint32 distributionId = lastDistributionId + 1;
        uint96 amount = stakes[stakeId].amount;

        totalStaked -= amount;
        if (stakes[stakeId].firstDistributionId == distributionId) {
            distributions[distributionId].stakedIn -= amount;

            uint160 timeDelta = stakes[stakeId].time -
                distributions[distributionId - 1].time;
            distributions[distributionId].powerXTimeDelta -= timeDelta * amount;
        }

        unstakes[stakeId] = Unstake({
            owner: msg.sender,
            amount: amount,
            time: (block.timestamp + unstakePeriod).toUint64()
        });

        delete stakes[stakeId];

        emit UnstakeRequested(stakeId, msg.sender, amount);
    }

    /**
     *  @notice Internal function that unstakes given stake
     *  @param stakeId ID of the stake
     */
    function _unstake(uint256 stakeId) private {
        Unstake memory unstake_ = unstakes[stakeId];
        if (unstake_.owner == address(0) || unstake_.amount == 0)
            revert IncorrectUnstake();
        if (block.timestamp < unstake_.time) revert IncorrectUnstakeTime();

        delete unstakes[stakeId];
        token.safeTransfer(unstake_.owner, unstake_.amount);

        emit Unstaked(stakeId, unstake_.owner, unstake_.amount);
    }

    /**
     *  @notice Internal function that calculates total accumulated reward for stake (without withdrawals)
     *  @param stakeId ID of the stake
     *  @return Total reward
     */
    function _accumulatedRewardOf(
        uint256 stakeId
    ) private view returns (uint96) {
        Stake memory stake_ = stakes[stakeId];
        Distribution memory firstDistribution = distributions[
            stake_.firstDistributionId
        ];
        if (firstDistribution.time == 0) {
            return 0;
        }

        // Reward for periods when stake was full, calculated straightforward
        uint256 fullReward = (stake_.amount *
            (rewardPerPower - firstDistribution.rewardPerPower)) / MAGNITUDE;

        // Timestamp of previous distribution
        uint256 previousTimestamp = distributions[
            stake_.firstDistributionId - 1
        ].time;

        //  Maximal possible (not actual) sum of powerXTimes in first distribution for stake
        uint256 maxTotalPowerXTime = uint256(firstDistribution.stakedIn) *
            (firstDistribution.time - previousTimestamp);

        // Real sum of powerXTimes in first distribution for stake
        uint256 realTotalPowerXTime = maxTotalPowerXTime -
            firstDistribution.powerXTimeDelta;

        // PowerXTime of this stake in first distribution
        uint256 stakePowerXTime = uint256(stake_.amount) *
            (firstDistribution.time - stake_.time);

        // Reward when stake was partial as propotionate share of total reward for partial stakes in distribution
        uint256 partialReward;
        if (realTotalPowerXTime > 0) {
            partialReward =
                (uint256(firstDistribution.rewardForPartialPower) *
                    stakePowerXTime) /
                realTotalPowerXTime;
        }

        return (fullReward + partialReward).toUint96();
    }
}
