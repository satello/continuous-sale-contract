/* eslint-disable no-undef */ // Avoid the linter considering truffle elements as undef.
const pify = require("pify");
const time = require("openzeppelin-solidity/test/helpers/time");
const shouldFail = require("openzeppelin-solidity/test/helpers/shouldFail");
const MintableToken = artifacts.require(
  "openzeppelin-solidity/contracts/token/ERC20/ERC20Mintable.sol"
);
const IICO = artifacts.require("ContinuousIICO");

const BN = web3.utils.BN; // Alias
const toBN = web3.utils.toBN;

contract("ContinuousIICO", function(accounts) {
  const owner = accounts[0];
  const beneficiary = accounts[1];
  const buyerA = accounts[2];
  const buyerB = accounts[3];
  const buyerC = accounts[4];
  const buyerD = accounts[5];
  const buyerE = accounts[6];
  const buyerF = accounts[7];
  const GAS_PRICE = 5e9;
  const tokensToMint = new BN("12").mul(new BN("10").pow(new BN("25")));
  const uint256Max = new BN("2").pow(new BN("256")).sub(new BN("1"));

  const TIME_BEFORE_START = 1000;
  const withdrawalLockUpLength = 2500;
  const numberOfSubSales = 365;
  const durationPerSubSale = 86400;
  const noCap = 120000000e18; // for placing bids with no cap
  testAccount = buyerE;

  let iico;
  let startTestTime;

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async function increase(duration) {
    if (duration < 0)
      throw Error(`Cannot increase time by a negative amount (${duration})`);

    await pify(web3.currentProvider.send)({
      jsonrpc: "2.0",
      method: "evm_increaseTime",
      params: [duration]
    });

    await pify(web3.currentProvider.send)({
      jsonrpc: "2.0",
      method: "evm_mine"
    });
  }

  beforeEach("initialize the contract", async function() {
    iico = await IICO.new(beneficiary, numberOfSubSales, durationPerSubSale, {
      from: owner
    });
  });

  // Constructor
  it("Should create the contract with the initial values", async () => {
    assert.equal(await iico.owner(), owner, "The owner is not set correctly.");
    assert.equal(
      await iico.beneficiary(),
      beneficiary,
      "The beneficiary is not set correctly."
    );

    assert.equal(
      await iico.numberOfSubSales(),
      numberOfSubSales,
      "Number of subsales is not set correctly."
    );

    assert.equal(
      await iico.durationPerSubSale(),
      durationPerSubSale,
      "Duration per subsale is not set correctly."
    );
  });

  // setToken
  it("Should set the token", async () => {
    let token = await MintableToken.new({ from: owner });
    await shouldFail.reverting(iico.setToken(token.address, { from: owner })); // Can't set the token if contracts balance is zero.
    await token.mint(iico.address, tokensToMint, {
      from: owner
    });
    await shouldFail.reverting(iico.setToken(token.address, { from: buyerA })); // Only owner can set.
    await iico.setToken(token.address, { from: owner });

    assert.equal(
      await iico.token(),
      token.address,
      "The token is not set correctly"
    );

    assert(
      (await iico.tokensForSale()).eq(tokensToMint),
      "The tokensForSale is not set correctly"
    );
  });

  it("Should start the sale", async () => {
    let token = await MintableToken.new({ from: owner });
    await token.mint(iico.address, tokensToMint, {
      from: owner
    });

    await shouldFail.reverting(
      iico.startSale(TIME_BEFORE_START, { from: owner })
    ); // Token not set yet, should revert.

    await iico.setToken(token.address, { from: owner });
    await iico.startSale(TIME_BEFORE_START, { from: owner });
  });

  // submitBid
  it("Should submit only valid bids", async () => {
    let head = await iico.bids(0);
    let tailID = uint256Max;
    let token = await MintableToken.new({ from: owner });
    await token.mint(iico.address, tokensToMint, { from: owner });
    await iico.setToken(token.address, { from: owner });
    await iico.startSale(0, { from: owner });

    let Valuation1 = new BN("10").pow(new BN("18"));
    let Valuation2 = new BN("10").pow(new BN("17"));
    let Valuation3 = new BN("10").pow(new BN("16"));

    await shouldFail.reverting(
      iico.submitBid(
        Valuation1,
        Math.floor(Math.random() * 1000000000 + 1),
        5,
        {
          from: buyerA,
          value: 0.1e18
        }
      )
    ); // Should not work because the insertion position is incorrect
    await iico.submitBid(Valuation1, tailID, 5, {
      from: buyerA,
      value: 0.1e18
    }); // Bid 1.
    assert.equal(await iico.globalLastBidID(), 1);
    const s = await iico.search(Valuation2, 6, 0);
    console.log(s);
    await shouldFail.reverting(
      iico.submitBid(Valuation2, tailID, 6, { from: buyerB, value: 0.1e18 })
    ); // Should not work because not inserted in the right position.

    await iico.submitBid(Valuation2, 1, 6, { from: buyerB, value: 0.1e18 }); // Bid 2.
    await iico.submitBid(Valuation3, 2, 6, { from: buyerC, value: 0.15e18 }); // Bid 3.
    await shouldFail.reverting(
      iico.submitBid(Valuation2, 2, 3, { from: buyerB, value: 0.25e18 })
    ); // Should not work because not inserted in the right position.
    await iico.submitBid(Valuation2, 1, 3, { from: buyerB, value: 0.25e18 }); // Bid 4

    await iico.searchAndBid(Valuation2, tailID, 4, {
      from: buyerE,
      value: 0.1e18
    }); // Bid 5.
  });

  // searchAndBid
  it("Should finalize in single run", async () => {
    let head = await iico.bids(0);
    let tailID = uint256Max;
    let token = await MintableToken.new({ from: owner });
    await token.mint(iico.address, tokensToMint, { from: owner });
    await iico.setToken(token.address, { from: owner });
    await iico.startSale(0, { from: owner });

    let Valuation1 = new BN("10").pow(new BN("18"));
    let Valuation2 = new BN("10").pow(new BN("17"));
    let Valuation3 = new BN("10").pow(new BN("16"));

    await shouldFail.reverting(
      iico.submitBid(
        Valuation1,
        Math.floor(Math.random() * 1000000000 + 1),
        5,
        {
          from: buyerA,
          value: 0.1e18
        }
      )
    ); // Should not work because the insertion position is incorrect
    await iico.submitBid(Valuation1, tailID, 5, {
      from: buyerA,
      value: 0.1e18
    }); // Bid 1.
    assert.equal(await iico.globalLastBidID(), 1);
    const s = await iico.search(Valuation2, 6, 0);
    console.log(s);
    await shouldFail.reverting(
      iico.submitBid(Valuation2, tailID, 6, { from: buyerB, value: 0.1e18 })
    ); // Should not work because not inserted in the right position.

    await iico.submitBid(Valuation2, 1, 6, { from: buyerB, value: 0.1e18 }); // Bid 2.
    await iico.submitBid(Valuation3, 2, 6, { from: buyerC, value: 0.15e18 }); // Bid 3.
    await shouldFail.reverting(
      iico.submitBid(Valuation2, 2, 3, { from: buyerB, value: 0.25e18 })
    ); // Should not work because not inserted in the right position.
    await iico.submitBid(Valuation2, 1, 3, { from: buyerB, value: 0.25e18 }); // Bid 4

    await iico.searchAndBid(Valuation2, tailID, 4, {
      from: buyerE,
      value: 0.1e18
    }); // Bid 5.

    console.log(web3.currentProvider);
    await increase(86400);
    await iico.finalize(uint256Max, 0, { from: buyerB });
    assert.equal(await iico.finalizationTurn(), 1);
  });

  it("Should finalize in multiple runs", async () => {
    let head = await iico.bids(0);
    let tailID = uint256Max;
    let token = await MintableToken.new({ from: owner });
    await token.mint(iico.address, tokensToMint, { from: owner });
    await iico.setToken(token.address, { from: owner });
    await iico.startSale(0, { from: owner });

    let Valuation1 = new BN("10").pow(new BN("20"));
    let Valuation2 = new BN("10").pow(new BN("19"));
    let Valuation3 = new BN("10").pow(new BN("18"));

    await shouldFail.reverting(
      iico.submitBid(
        Valuation1,
        Math.floor(Math.random() * 1000000000 + 1),
        5,
        {
          from: buyerA,
          value: 0.1e18
        }
      )
    ); // Should not work because the insertion position is incorrect
    await iico.submitBid(Valuation1, tailID, 5, {
      from: buyerA,
      value: 0.1e18
    }); // Bid 1.
    assert.equal(await iico.globalLastBidID(), 1);
    const s = await iico.search(Valuation2, 6, 0);
    console.log(s);
    await shouldFail.reverting(
      iico.submitBid(Valuation2, tailID, 6, { from: buyerB, value: 0.1e18 })
    ); // Should not work because not inserted in the right position.

    await iico.submitBid(Valuation2, 1, 6, { from: buyerB, value: 0.1e18 }); // Bid 2.
    await iico.submitBid(Valuation3, 2, 6, { from: buyerC, value: 0.15e18 }); // Bid 3.
    await shouldFail.reverting(
      iico.submitBid(Valuation2, 2, 3, { from: buyerB, value: 0.25e18 })
    ); // Should not work because not inserted in the right position.
    await iico.submitBid(Valuation2, 1, 3, { from: buyerB, value: 0.25e18 }); // Bid 4

    await iico.searchAndBid(Valuation2, tailID, 4, {
      from: buyerE,
      value: 0.1e18
    }); // Bid 5.

    await increase(86400);

    await iico.finalize(2, 0, { from: buyerB });
    assert.equal(await iico.finalizationTurn(), 0);
    await iico.finalize(2, 0, { from: buyerC });
    assert.equal(await iico.finalizationTurn(), 0);
    await iico.finalize(3, 0, { from: buyerA });
    assert.equal(await iico.finalizationTurn(), 1);
  });

  it("Should redeem", async function() {
    let head = await iico.bids(0);
    let tailID = uint256Max;
    let token = await MintableToken.new({ from: owner });
    await token.mint(iico.address, tokensToMint, { from: owner });
    await iico.setToken(token.address, { from: owner });
    await iico.startSale(0, { from: owner });

    let Valuation1 = new BN("10").pow(new BN("20"));
    let Valuation2 = new BN("10").pow(new BN("19"));
    let Valuation3 = new BN("10").pow(new BN("18"));
    let ValuationTooLow = new BN("10").pow(new BN("14"));

    await iico.submitBid(Valuation1, tailID, 5, {
      from: buyerA,
      value: 0.1e18
    }); // Bid 1.
    await iico.submitBid(Valuation2, 1, 6, { from: buyerB, value: 0.1e18 }); // Bid 2.
    await iico.submitBid(Valuation3, 2, 6, { from: buyerC, value: 0.2e18 }); // Bid 3.
    await iico.submitBid(Valuation2, 1, 3, { from: buyerD, value: 0.2e18 }); // Bid 4
    await iico.searchAndBid(Valuation2, tailID, 4, {
      from: buyerE,
      value: 0.1e18
    }); // Bid 5.
    await iico.searchAndBid(ValuationTooLow, tailID, 4, {
      from: buyerF,
      value: 0.1e18
    }); // Bid 5.

    await increase(86400);

    let buyerABalanceBeforeRedeem = await web3.eth.getBalance(buyerA);
    let buyerBBalanceBeforeRedeem = await web3.eth.getBalance(buyerB);
    let buyerCBalanceBeforeRedeem = await web3.eth.getBalance(buyerC);
    let buyerDBalanceBeforeRedeem = await web3.eth.getBalance(buyerD);
    let buyerEBalanceBeforeRedeem = await web3.eth.getBalance(buyerE);
    let buyerFBalanceBeforeRedeem = await web3.eth.getBalance(buyerF);
    let beneficiaryBalanceBeforeRedeem = await web3.eth.getBalance(beneficiary);

    await iico.finalize(uint256Max, 0, { from: owner });

    for (let i = 1; i < 6; i++) {
      await iico.redeem(i, { from: owner });
      await shouldFail.reverting(iico.redeem(i, { from: owner }));
    }

    console.log(await web3.eth.getBalance(buyerA));
    // Verify the proper amounts of ETH are refunded.
    assert.equal(
      await web3.eth.getBalance(buyerA),
      buyerABalanceBeforeRedeem,
      "The buyer A has been given ETH back while the full bid should have been accepted"
    );
    assert.equal(
      await web3.eth.getBalance(buyerB),
      buyerBBalanceBeforeRedeem,
      "The buyer B has not been reimbursed as it should"
    );
    assert.equal(
      await web3.eth.getBalance(buyerC),
      buyerCBalanceBeforeRedeem,
      "The buyer C has been given ETH back while the full bid should have been accepted"
    );
    assert.equal(
      await web3.eth.getBalance(buyerD),
      buyerDBalanceBeforeRedeem,
      "The buyer D has been given ETH back while the full bid should have been accepted"
    );
    assert.equal(
      await web3.eth.getBalance(buyerE),
      buyerEBalanceBeforeRedeem,
      "The buyer E has not been reimbursed as it should"
    );
    assert(
      toBN(await web3.eth.getBalance(buyerF)).eq(
        new BN(buyerFBalanceBeforeRedeem).add(new BN("10").pow(new BN("17")))
      ),
      "The buyer F has not been reimbursed as it should"
    );

    console.log(typeof beneficiaryBalanceBeforeRedeem);

    const balance = new web3.utils.toBN(await web3.eth.getBalance(beneficiary));
    const difference = new BN("7").mul(new BN("10").pow(new BN("17")));

    assert(
      balance.eq(
        web3.utils.toBN(beneficiaryBalanceBeforeRedeem).add(difference)
      ),
      "The beneficiary has not been paid correctly"
    );

    const tokensPerSubSale = tokensToMint.div(new BN(numberOfSubSales));

    assert(
      toBN(await token.balanceOf(buyerA)).eq(tokensPerSubSale.div(new BN("7"))),
      "The buyer A has not been given the right amount of tokens"
    );

    console.log(toBN(await token.balanceOf(buyerB)).toString());
    console.log(
      tokensPerSubSale
        .div(new BN("7"))
        .mul(new BN("1"))
        .toString()
    );

    assert(
      toBN(await token.balanceOf(buyerB)).eq(
        tokensPerSubSale.div(new BN("7")).mul(new BN("1"))
      ),
      "The buyer B has not been given the right amount of tokens"
    );

    assert(
      toBN(await token.balanceOf(buyerC)).eq(
        tokensPerSubSale.div(new BN("7")).mul(new BN("2"))
      ),
      "The buyer C has not been given the right amount of tokens"
    );

    assert(
      toBN(await token.balanceOf(buyerD)).eq(
        tokensPerSubSale.div(new BN("7")).mul(new BN("2"))
      ),
      "The buyer D has not been given the right amount of tokens"
    );

    assert(
      toBN(await token.balanceOf(buyerE)).eq(
        tokensPerSubSale.div(new BN("7")).mul(new BN("1"))
      ),
      "The buyer E has not been given the right amount of tokens"
    );

    assert(
      toBN(await token.balanceOf(buyerF)).eq(new BN("0")),
      "The buyer F has not been given the right amount of tokens"
    );
  });
});
