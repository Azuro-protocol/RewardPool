require("@nomicfoundation/hardhat-toolbox");
require("@openzeppelin/hardhat-upgrades");
require("hardhat-contract-sizer");
require("hardhat-gas-reporter");
require("dotenv").config();

const MAINNET_PRIVATE_KEY = process.env.MAINNET_PRIVATE_KEY || "";
const MUMBAI_PRIVATE_KEY = process.env.MUMBAI_PRIVATE_KEY || "";
const POLYGON_PRIVATE_KEY = process.env.POLYGON_PRIVATE_KEY || "";
const POLYGONSCAN_API_KEY = process.env.POLYGONSCAN_API_KEY || "";
const ETHERSCAN_API_KEY = process.env.ETHERSCAN_API_KEY || "";
const INFURA_API_KEY = process.env.INFURA_API_KEY || "";

const exportNetworks = {
  hardhat: {
    accounts: {
      accountsBalance: "1000000000000000000000000000000000",
    },
  },
};

if (MUMBAI_PRIVATE_KEY != "") {
  exportNetworks["mumbai"] = {
    url: "https://polygon-testnet-rpc.allthatnode.com:8545",
    accounts: [`${MUMBAI_PRIVATE_KEY}`],
  };
}

if (POLYGON_PRIVATE_KEY != "") {
  exportNetworks["polygon"] = {
    url: "https://polygon-rpc.com",
    accounts: [`${POLYGON_PRIVATE_KEY}`],
  };
}

if (MAINNET_PRIVATE_KEY != "") {
  exportNetworks["mainnet"] = {
    url: `https://mainnet.infura.io/v3/${INFURA_API_KEY}`,
    accounts: [`${MAINNET_PRIVATE_KEY}`]
  }
}

module.exports = {
  solidity: {
    compilers: [
      {
        version: "0.8.28",
        settings: {
          optimizer: {
            enabled: true,
            runs: 1000000,
          },
        },
      },
    ],
  },
  paths: {sources: "./contracts/hardhat/contracts"},
  defaultNetwork: "hardhat",
  networks: exportNetworks,
  etherscan: {
    apiKey: {
      mumbai: POLYGONSCAN_API_KEY,
      polygon: POLYGONSCAN_API_KEY,
      mainnet: ETHERSCAN_API_KEY,
    },
  },
  contractSizer: {
    alphaSort: true,
    runOnCompile: true,
    disambiguatePaths: false,
  },
  gasReporter: {
    enabled: true,
    currency: "USD",
  },
  sourcify: {
    enabled: true
  }

};
