// Fetch the contract data
var ContinuousIICO = artifacts.require("./ContinuousIICO.sol");

// JavaScript export
module.exports = function(deployer, network, accounts) {
  // Deployer is the Truffle wrapper for deploying
  // contracts to the network
  // Deploy the contract to the network
  deployer.deploy(ContinuousIICO, web3.utils.numberToHex(accounts[1]), 5, 5);
};
