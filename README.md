#  Azuro Reward Pool

This contract facilitates the distribution of rewards from the reward pool to various stakers. 
During each rewards distribution cycle, rewards are distributed proportionally based on "stake powers".

The stake power for a given stake is calculated as follows:
1. During the initial distribution (following the establishment of the reward pool), it is determined by the proportion of the stake amount relative to the time elapsed between the stake and the current distribution, compared to the time elapsed between the previous distribution and the current one. This is referred to as partial power.
2. In subsequent distributions, the stake power equals the staked amount, referred to as full power.

Consequently, reward calculations are divided into two parts: for **full stakes** and for **partial stakes**.

Calculations for full stakes involve incrementally increasing the `rewardPerPower` value. This value represents the total accrued reward per unit of power, magnified by a `MAGNITUDE` factor to ensure accurate calculation of small values. Therefore, for a stake, the reward for periods where it was fully staked is computed as its amount multiplied by the difference between the current `rewardPerPower` and the value of `rewardPerPower` at the distribution when the stake occurred (the first distribution).

To calculate the reward for partial stakes (which only occurs once for each stake), a different mechanism is employed. During the initial distribution, the share of the reward for a given stake among all rewards for partial stakes in that distribution is determined by the proportion of the product of the stake amount and the time elapsed between the stake and the distribution, relative to the sum of such products for all partial stakes. These products are referred to as `powerXTime` in the codebase.
For the accurate calculation of the sum of `powerXTimes`, it is calculated as the difference between `maxTotalPowerXTime` (the sum of powerXTimes if all partial stakes were immediately after the previous distribution) and the sum of powerXTime deltas (the differences between the maximal possible `powerXTime` and the real `powerXTime` for each stake).  

This approach enables the calculation of all values using O(1) operations in a single transaction.

## Deployment

### 1. Set environment variables

Before start deployment you need to set `.env` variables:
- **AZUR** stake token address (AZUR token).
- **UNSTAKEPERIOD** unstake period (seconds).


### 2. Configure network in hardhat.config.js
Set netwok connection configuration

### 3. Run deploy script

```
npx hardhat run scripts/deploy.js --network %network%
```