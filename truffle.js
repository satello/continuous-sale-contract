var HDWalletProvider = require('truffle-hdwallet-provider')

var mnemonic =
  'emerge cabbage panel need lens sweet assault benefit broken lunch insect differ'

module.exports = {
  // See <http://truffleframework.com/docs/advanced/configuration>
  // to customize your Truffle configuration!
  compilers: {
    solc: {
      version: '^0.5.3'
    }
  },
  mocha: {
    reporter: 'eth-gas-reporter',
    reporterOptions: {
      currency: 'USD'
    }
  },

  networks: {
    development: {
      host: 'localhost',
      network_id: '*',
      port: 8545
    },
    kovan: {
      confirmations: 2,
      gas: 4200000,
      gasPrice: 20000000000,
      network_id: 42,
      provider: new HDWalletProvider(
        mnemonic,
        'https://kovan.infura.io/v3/344bdb3c652c4ce6acc12f10a7557ba6'
      )
    }
  }
}
