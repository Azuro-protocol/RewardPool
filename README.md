# distributor
Azuro rewardPool and reward distribution

## Description
This contract is used for distributing rewards for rewardPool to various stakers.
At each rewards distribution, it is distributed proportionate to "stake powers".

Stake power for a given stake is a value calculated following way:
1. At first distribution (after rewardPool) it is share of stake amount equal to share of time passed between stake 
and this distribution to time passed between previous distribution and this distribution. This is named partial power.
2. At subsequent distributions stake power is equal to staked amount. This is named full power.

Therefore, reward calculations are split into 2 parts: for full stakes and for partial stakes.

Calculations for full stakes is going through increasing "rewardPerPower" value 
(that equals to total accrued reward per 1 unit of power, then magnified by MAGNITUDE to calculate small values correct)
Therefore for a stake reward for periods where it was full is it's amount multiplied by difference of current rewardPerPower and value of rewardPerPower at distribution where stake happened (first distribution)

To calculate partial stake reward (happenes only 1 for each stake) other mechanism is used.
At first distribution share of reward for given stake among all rewards for partial stakes in that distribution
is equal to share of product of stake amount and time passed between stake and distribution to sum of such products
for all partial stakes. These products are named "powerXTime" in the codebase;
For correct calculation of sum of powerXTimes we calculate it as difference of maxTotalPowerXTime 
(sum of powerXTimes if all partial stakes were immediately after previous distribution) and sum of powerXTime deltas
(differences between maximal possible powerXTime and real powerXTime for each stake).
Such way allows to calculate all values using O(1) of operations in one transaction

## Deployment

### 1. Set environment variables

Before start deployment you need to set `.env` variables:
- **AZUR** stake token address (AZUR token).
- **UNSTAKEPERIOD** unstake period (seconds).


### 2. Configure network in hardhat.config.js
Set %netwok% connection configuration

### 3. Run deploy script

```
npx hardhat run scripts/deploy.js --network %network%
```