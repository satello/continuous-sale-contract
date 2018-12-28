/* eslint-disable no-undef */ // Avoid the linter considering truffle elements as undef.
const web3 = require("web3");
const time = require("openzeppelin-solidity/test/helpers/time");
const shouldFail = require("openzeppelin-solidity/test/helpers/shouldFail");
const MintableToken = artifacts.require(
  "openzeppelin-solidity/contracts/token/ERC20/ERC20Mintable.sol"
);
const IICO = artifacts.require("ContinuousIICO");

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
  const tokensToMint = new web3.utils.BN("120000000000000000000000000"); // 1.2e26
  const uint256Max = new web3.utils.BN("2")
    .pow(new web3.utils.BN("256"))
    .sub(new web3.utils.BN("1"));

  const TIME_BEFORE_START = 1000;
  const withdrawalLockUpLength = 2500;
  const noCap = 120000000e18; // for placing bids with no cap
  testAccount = buyerE;

  let iico;
  let startTestTime;

  beforeEach("initialize the contract", async function() {
    iico = await IICO.new({
      from: owner
    });
  });

  // Constructor
  it.only("Should create the contract with the initial values", async () => {
    assert.equal(await iico.owner(), owner, "The owner is not set correctly");
  });

  // setToken
  it.only("Should set the token", async () => {
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

  it.only("Should start the sale", async () => {
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
  it.only("Should submit only valid bids", async () => {
    let headOfFirstDay = await iico.bids(0);
    let tailID = uint256Max;
    let tailIDHex = web3.utils.numberToHex(tailID);
    let tail = await iico.bids(tailID);
    let token = await MintableToken.new({ from: owner });
    await token.mint(iico.address, tokensToMint, { from: owner });
    await iico.setToken(token.address, { from: owner });
    await iico.startSale(TIME_BEFORE_START, { from: owner });
    await iico.startSubSale(0);

    let bid = new web3.utils.BN("1").pow(new web3.utils.BN("18"));
    await shouldFail.reverting(
      iico.submitBid(bid, 7, { from: buyerA, value: 0.1e18 })
    ); // Should not work before the sale hasn't start yet.
    // increase(1010); // Full bonus period.
    // await iico.submitBid(1e18, head[1], { from: buyerA, value: 0.1e18 }); // Bid 1.
    // await shouldFail.reverting(
    //   iico.submitBid(0.5e18, head[1], { from: buyerB, value: 0.1e18 })
    // ); // Should not work because not inserted in the right position.
    // await shouldFail.reverting(
    //   iico.submitBid(0.5e18, 0, { from: buyerB, value: 0.1e18 })
    // );
    // await iico.submitBid(0.5e18, 1, { from: buyerB, value: 0.1e18 }); // Bid 2.
    //
    // increase(5000); // Partial bonus period.
    // await iico.submitBid(0.8e18, 1, { from: buyerC, value: 0.15e18 }); // Bid 3.
    // increase(2500); // Withdrawal lock period.
    // await iico.submitBid(0.7e18, 3, { from: buyerD, value: 0.15e18 }); // Bid 4.
    // increase(2500); // End of sale period.
    // await shouldFail.reverting(
    //   iico.submitBid(0.9e18, 1, { from: buyerE, value: 0.15e18 })
    // );
  });

  // searchAndBid
  it("Should submit even if not the right position", async () => {
    let startTestTime = web3.eth.getBlock("latest").timestamp;
    let iico = await IICO.new(
      startTestTime + timeBeforeStart,
      fullBonusLength,
      partialWithdrawalLength,
      withdrawalLockUpLength,
      maxBonus,
      beneficiary,
      { from: owner }
    );
    let head = await iico.bids(0);
    let tailID = head[1];
    let tail = await iico.bids(tailID);
    let token = await MintableToken.new({ from: owner });
    await token.mint(iico.address, 160e24, { from: owner });
    await iico.setToken(token.address, { from: owner });

    increaseTime(1010); // Full bonus period.
    await iico.searchAndBid(1e18, 0, { from: buyerA, value: 0.1e18 }); // Bid 1.
    await iico.searchAndBid(0.5e18, 1, { from: buyerB, value: 0.1e18 }); // Bid 2.
    increaseTime(5000); // Partial bonus period.
    await iico.searchAndBid(0.8e18, 2, { from: buyerC, value: 0.15e18 }); // Bid 3.
    increaseTime(2500); // Withdrawal lock period.
    await iico.searchAndBid(0.7e18, 0, { from: buyerD, value: 0.15e18 }); // Bid 4.
    await iico.searchAndBid(0.5e18, tailID, { from: buyerE, value: 0.1e18 }); // Bid 5.
  });

  // withdraw
  it("Should withdraw the proper amount", async () => {
    let startTestTime = web3.eth.getBlock("latest").timestamp;
    let iico = await IICO.new(
      startTestTime + timeBeforeStart,
      fullBonusLength,
      partialWithdrawalLength,
      withdrawalLockUpLength,
      maxBonus,
      beneficiary,
      { from: owner }
    );
    let head = await iico.bids(0);
    let tailID = head[1];
    let tail = await iico.bids(head[1]);
    let token = await MintableToken.new({ from: owner });
    await token.mint(iico.address, 160e24, { from: owner });
    await iico.setToken(token.address, { from: owner });

    increaseTime(1010); // Full bonus period.
    await iico.searchAndBid(1e18, 0, { from: buyerA, value: 0.1e18 }); // Bid 1.
    let buyerABalanceBeforeReimbursment = web3.eth.getBalance(buyerA);
    await expectThrow(iico.withdraw(1, { from: buyerB })); // Only the contributor can withdraw.
    let tx = await iico.withdraw(1, { from: buyerA, GAS_PRICE: GAS_PRICE });
    let txFee = tx.receipt.gasUsed * GAS_PRICE;
    let buyerABalanceAfterReimbursment = web3.eth.getBalance(buyerA);
    assert.equal(
      buyerABalanceBeforeReimbursment
        .plus(0.1e18)
        .minus(txFee)
        .toNumber(),
      buyerABalanceAfterReimbursment.toNumber(),
      "The buyer has not been reimbursed completely"
    );
    await expectThrow(iico.withdraw(1, { from: buyerA, GAS_PRICE: GAS_PRICE }));

    await iico.searchAndBid(0.8e18, 2, { from: buyerB, value: 0.1e18 }); // Bid 2.
    increaseTime(5490); // Partial bonus period. Around 20% locked.
    let buyerBBalanceBeforeReimbursment = web3.eth.getBalance(buyerB);
    tx = await iico.withdraw(2, { from: buyerB, GAS_PRICE: GAS_PRICE });
    txFee = tx.receipt.gasUsed * GAS_PRICE;
    let buyerBBalanceAfterReimbursment = web3.eth.getBalance(buyerB);
    assert(
      buyerBBalanceAfterReimbursment
        .minus(buyerBBalanceBeforeReimbursment.minus(txFee).toNumber())
        .toNumber() -
        (4 * 0.1e18) / 5 <=
        (4 * 0.1e18) / 5 / 100,
      "The buyer has not been reimbursed correctly"
    ); // Allow up to 1% error due to time taken outside of increaseTime.
    await expectThrow(iico.withdraw(2, { from: buyerB, GAS_PRICE: GAS_PRICE })); // You should not be able to withdraw twice.

    await iico.searchAndBid(0.5e18, 2, { from: buyerC, value: 0.15e18 }); // Bid 3.
    increaseTime(2500);
    await expectThrow(iico.withdraw(3, { from: buyerC })); // Not possible to withdraw after the withdrawal lock.
  });

  // finalized
  it("Should finalize in one shot", async () => {
    let startTestTime = web3.eth.getBlock("latest").timestamp;
    let iico = await IICO.new(
      startTestTime + timeBeforeStart,
      fullBonusLength,
      partialWithdrawalLength,
      withdrawalLockUpLength,
      maxBonus,
      beneficiary,
      { from: owner }
    );
    let head = await iico.bids(0);
    let tailID = head[1];
    let tail = await iico.bids(head[1]);
    let token = await MintableToken.new({ from: owner });
    await token.mint(iico.address, 160e24, { from: owner });
    await iico.setToken(token.address, { from: owner });

    increaseTime(1010); // Full bonus period.
    await iico.searchAndBid(1e18, 0, { from: buyerA, value: 0.1e18 }); // Bid 1.
    await iico.searchAndBid(0.5e18, 1, { from: buyerB, value: 0.1e18 }); // Bid 2.
    increaseTime(5000); // Partial bonus period.
    await iico.searchAndBid(0.8e18, 2, { from: buyerC, value: 0.15e18 }); // Bid 3.
    increaseTime(2500); // Withdrawal lock period.
    await iico.searchAndBid(0.7e18, 0, { from: buyerD, value: 0.15e18 }); // Bid 4.
    await iico.searchAndBid(0.5e18, tailID, { from: buyerE, value: 0.1e18 }); // Bid 5.
    await expectThrow(iico.finalize(1000000000000)); // Should not be able to finalize before the end of the sale.
    increaseTime(2500); // End of sale.
    await iico.finalize(1000000000000);
    assert.equal(
      await iico.finalized(),
      true,
      "The one shot finalization did not work as expected"
    );
  });

  it("Should finalize in multiple shots", async () => {
    let startTestTime = web3.eth.getBlock("latest").timestamp;
    let iico = await IICO.new(
      startTestTime + timeBeforeStart,
      fullBonusLength,
      partialWithdrawalLength,
      withdrawalLockUpLength,
      maxBonus,
      beneficiary,
      { from: owner }
    );
    let head = await iico.bids(0);
    let tailID = head[1];
    let tail = await iico.bids(head[1]);
    let token = await MintableToken.new({ from: owner });
    await token.mint(iico.address, 160e24, { from: owner });
    await iico.setToken(token.address, { from: owner });

    increaseTime(1010); // Full bonus period.
    await iico.searchAndBid(1e18, 0, { from: buyerA, value: 0.1e18 }); // Bid 1.
    await iico.searchAndBid(0.5e18, 1, { from: buyerB, value: 0.1e18 }); // Bid 2.
    increaseTime(5000); // Partial bonus period.
    await iico.searchAndBid(0.8e18, 2, { from: buyerC, value: 0.4e18 }); // Bid 3.
    increaseTime(2500); // Withdrawal lock period.
    await iico.searchAndBid(0.7e18, 0, { from: buyerD, value: 0.2e18 }); // Bid 4.
    await iico.searchAndBid(0.5e18, tailID, { from: buyerE, value: 0.1e18 }); // Bid 5.
    increaseTime(2500); // End of sale.
    await iico.finalize(2);
    assert.equal(
      await iico.finalized(),
      false,
      "The multiple shots finalization finalized while it should have taken longer"
    );
    await iico.finalize(2);
    assert.equal(
      await iico.finalized(),
      true,
      "The multiple shots finalization did not work as expected"
    );
  });

  it("Should give back tokens to accepted bids and refund others. Full last bid", async () => {
    let startTestTime = web3.eth.getBlock("latest").timestamp;
    let iico = await IICO.new(
      startTestTime + timeBeforeStart,
      fullBonusLength,
      partialWithdrawalLength,
      withdrawalLockUpLength,
      maxBonus,
      beneficiary,
      { from: owner }
    );
    let head = await iico.bids(0);
    let tailID = head[1];
    let tail = await iico.bids(head[1]);
    let token = await MintableToken.new({ from: owner });
    await token.mint(iico.address, 70e24, { from: owner });
    await iico.setToken(token.address, { from: owner });

    increaseTime(1100); // Full bonus period.
    await iico.searchAndBid(1e18, 0, { from: buyerA, value: 0.1e18 }); // Bid 1.
    await iico.searchAndBid(0.6e18, 1, { from: buyerB, value: 0.1e18 }); // Bid 2.
    await iico.searchAndBid(0.8e18, 2, { from: buyerC, value: 0.4e18 }); // Bid 3.
    await iico.searchAndBid(0.7e18, 0, { from: buyerD, value: 0.2e18 }); // Bid 4.
    await iico.searchAndBid(0.5e18, tailID, { from: buyerE, value: 0.15e18 }); // Bid 5.
    await iico.searchAndBid(0.5e18, tailID, { from: buyerF, value: 0.3e18 }); // Bid 6.
    increaseTime(1e4); // End of sale.

    let buyerABalanceAtTheEndOfSale = web3.eth.getBalance(buyerA).toNumber();
    let buyerBBalanceAtTheEndOfSale = web3.eth.getBalance(buyerB).toNumber();
    let buyerCBalanceAtTheEndOfSale = web3.eth.getBalance(buyerC).toNumber();
    let buyerDBalanceAtTheEndOfSale = web3.eth.getBalance(buyerD).toNumber();
    let buyerEBalanceAtTheEndOfSale = web3.eth.getBalance(buyerE).toNumber();
    let buyerFBalanceAtTheEndOfSale = web3.eth.getBalance(buyerF).toNumber();
    let beneficiaryBalanceAtTheEndOfSale = web3.eth
      .getBalance(beneficiary)
      .toNumber();

    await iico.finalize(1000);

    // Redeem and verify we can't redeem more than once.
    await iico.redeem(1);
    await expectThrow(iico.redeem(1));
    await iico.redeem(2);
    await expectThrow(iico.redeem(2));
    await iico.redeem(3);
    await expectThrow(iico.redeem(3));
    await iico.redeem(4);
    await expectThrow(iico.redeem(4));
    await iico.redeem(5);
    await expectThrow(iico.redeem(5));
    await iico.redeem(6);
    await expectThrow(iico.redeem(6));

    // Verify the proper amounts of ETH are refunded.
    assert.equal(
      web3.eth.getBalance(buyerA).toNumber(),
      buyerABalanceAtTheEndOfSale,
      "The buyer A has been given ETH back while the full bid should have been accepted"
    );
    assert.equal(
      web3.eth.getBalance(buyerB).toNumber(),
      buyerBBalanceAtTheEndOfSale + 0.1e18,
      "The buyer B has not been reimbursed as it should"
    );
    assert.equal(
      web3.eth.getBalance(buyerC).toNumber(),
      buyerCBalanceAtTheEndOfSale,
      "The buyer C has been given ETH back while the full bid should have been accepted"
    );
    assert.equal(
      web3.eth.getBalance(buyerD).toNumber(),
      buyerDBalanceAtTheEndOfSale,
      "The buyer D has been given ETH back while the full bid should have been accepted"
    );
    assert.equal(
      web3.eth.getBalance(buyerE).toNumber(),
      buyerEBalanceAtTheEndOfSale + 0.15e18,
      "The buyer E has not been reimbursed as it should"
    );
    assert.equal(
      web3.eth.getBalance(buyerF).toNumber(),
      buyerFBalanceAtTheEndOfSale + 0.3e18,
      "The buyer F has not been reimbursed as it should"
    );

    assert.equal(
      web3.eth.getBalance(beneficiary).toNumber(),
      beneficiaryBalanceAtTheEndOfSale + 0.7e18,
      "The beneficiary has not been paid correctly"
    );

    // Verify that the tokens are correctly distributed.
    assert.equal(
      (await token.balanceOf(buyerA)).toNumber(),
      10e24,
      "The buyer A has not been given the right amount of tokens"
    );
    assert.equal(
      (await token.balanceOf(buyerB)).toNumber(),
      0,
      "The buyer B got some tokens despite having its bid refunded"
    );
    assert.equal(
      (await token.balanceOf(buyerC)).toNumber(),
      40e24,
      "The buyer C has not been given the right amount of tokens"
    );
    assert.equal(
      (await token.balanceOf(buyerD)).toNumber(),
      20e24,
      "The buyer D has not been given the right amount of tokens"
    );
    assert.equal(
      (await token.balanceOf(buyerE)).toNumber(),
      0,
      "The buyer E got some tokens despite having its bid refunded"
    );
    assert.equal(
      (await token.balanceOf(buyerF)).toNumber(),
      0,
      "The buyer F got some tokens despite having its bid refunded"
    );
  });

  it("Should give back tokens to accepted bids and refund others. Non full last bid", async () => {
    let startTestTime = web3.eth.getBlock("latest").timestamp;
    let iico = await IICO.new(
      startTestTime + timeBeforeStart,
      fullBonusLength,
      partialWithdrawalLength,
      withdrawalLockUpLength,
      maxBonus,
      beneficiary,
      { from: owner }
    );
    let head = await iico.bids(0);
    let tailID = head[1];
    let tail = await iico.bids(head[1]);
    let token = await MintableToken.new({ from: owner });
    await token.mint(iico.address, 70e24, { from: owner });
    await iico.setToken(token.address, { from: owner });

    increaseTime(1100); // Full bonus period.
    await iico.searchAndBid(1e18, 0, { from: buyerA, value: 0.1e18 }); // Bid 1.
    await iico.searchAndBid(0.6e18, 1, { from: buyerB, value: 0.1e18 }); // Bid 2.
    await iico.searchAndBid(0.8e18, 2, { from: buyerC, value: 0.4e18 }); // Bid 3.
    await iico.searchAndBid(0.75e18, 0, { from: buyerD, value: 0.2e18 }); // Bid 4.
    await iico.searchAndBid(0.5e18, tailID, { from: buyerE, value: 0.15e18 }); // Bid 5.
    await iico.searchAndBid(0.5e18, tailID, { from: buyerF, value: 0.3e18 }); // Bid 6.
    increaseTime(1e4); // End of sale.

    let buyerABalanceAtTheEndOfSale = web3.eth.getBalance(buyerA).toNumber();
    let buyerBBalanceAtTheEndOfSale = web3.eth.getBalance(buyerB).toNumber();
    let buyerCBalanceAtTheEndOfSale = web3.eth.getBalance(buyerC).toNumber();
    let buyerDBalanceAtTheEndOfSale = web3.eth.getBalance(buyerD).toNumber();
    let buyerEBalanceAtTheEndOfSale = web3.eth.getBalance(buyerE).toNumber();
    let buyerFBalanceAtTheEndOfSale = web3.eth.getBalance(buyerF).toNumber();
    let beneficiaryBalanceAtTheEndOfSale = web3.eth
      .getBalance(beneficiary)
      .toNumber();

    await iico.finalize(1000);

    // Redeem and verify we can't redeem more than once.
    await iico.redeem(1);
    await expectThrow(iico.redeem(1));
    await iico.redeem(2);
    await expectThrow(iico.redeem(2));
    await iico.redeem(3);
    await expectThrow(iico.redeem(3));
    await iico.redeem(4);
    await expectThrow(iico.redeem(4));
    await iico.redeem(5);
    await expectThrow(iico.redeem(5));
    await iico.redeem(6);
    await expectThrow(iico.redeem(6));

    // Verify the proper amounts of ETH are refunded.
    assert.equal(
      web3.eth.getBalance(buyerA).toNumber(),
      buyerABalanceAtTheEndOfSale,
      "The buyer A has been given ETH back while the full bid should have been accepted"
    );
    assert.equal(
      web3.eth.getBalance(buyerB).toNumber(),
      buyerBBalanceAtTheEndOfSale + 0.1e18,
      "The buyer B has not been reimbursed as it should"
    );
    assert.equal(
      web3.eth.getBalance(buyerC).toNumber(),
      buyerCBalanceAtTheEndOfSale,
      "The buyer C has been given ETH back while the full bid should have been accepted"
    );
    assert.equal(
      web3.eth.getBalance(buyerD).toNumber(),
      buyerDBalanceAtTheEndOfSale,
      "The buyer D has been given ETH back while the full bid should have been accepted"
    );
    assert.equal(
      web3.eth.getBalance(buyerE).toNumber(),
      buyerEBalanceAtTheEndOfSale + 0.15e18,
      "The buyer E has not been reimbursed as it should"
    );
    assert.equal(
      web3.eth.getBalance(buyerF).toNumber(),
      buyerFBalanceAtTheEndOfSale + 0.3e18,
      "The buyer F has not been reimbursed as it should"
    );

    assert.equal(
      web3.eth.getBalance(beneficiary).toNumber(),
      beneficiaryBalanceAtTheEndOfSale + 0.7e18,
      "The beneficiary has not been paid correctly"
    );

    // Verify that the tokens are correctly distributed.
    assert.equal(
      (await token.balanceOf(buyerA)).toNumber(),
      10e24,
      "The buyer A has not been given the right amount of tokens"
    );
    assert.equal(
      (await token.balanceOf(buyerB)).toNumber(),
      0,
      "The buyer B got some tokens despite having its bid refunded"
    );
    assert.equal(
      (await token.balanceOf(buyerC)).toNumber(),
      40e24,
      "The buyer C has not been given the right amount of tokens"
    );
    assert.equal(
      (await token.balanceOf(buyerD)).toNumber(),
      20e24,
      "The buyer D has not been given the right amount of tokens"
    );
    assert.equal(
      (await token.balanceOf(buyerE)).toNumber(),
      0,
      "The buyer E got some tokens despite having its bid refunded"
    );
    assert.equal(
      (await token.balanceOf(buyerF)).toNumber(),
      0,
      "The buyer F got some tokens despite having its bid refunded"
    );
  });

  it("Should give back tokens to accepted bids and refund others. Partially accepted last bid", async () => {
    let startTestTime = web3.eth.getBlock("latest").timestamp;
    let iico = await IICO.new(
      startTestTime + timeBeforeStart,
      fullBonusLength,
      partialWithdrawalLength,
      withdrawalLockUpLength,
      maxBonus,
      beneficiary,
      { from: owner }
    );
    let head = await iico.bids(0);
    let tailID = head[1];
    let tail = await iico.bids(head[1]);
    let token = await MintableToken.new({ from: owner });
    await token.mint(iico.address, 65e24, { from: owner });
    await iico.setToken(token.address, { from: owner });

    increaseTime(1100); // Full bonus period.
    await iico.searchAndBid(1e18, 0, { from: buyerA, value: 0.1e18 }); // Bid 1.
    await iico.searchAndBid(0.6e18, 1, { from: buyerB, value: 0.1e18 }); // Bid 2.
    await iico.searchAndBid(0.8e18, 2, { from: buyerC, value: 0.4e18 }); // Bid 3.
    await iico.searchAndBid(0.65e18, 0, { from: buyerD, value: 0.2e18 }); // Bid 4.
    await iico.searchAndBid(0.5e18, tailID, { from: buyerE, value: 0.15e18 }); // Bid 5.
    await iico.searchAndBid(0.5e18, tailID, { from: buyerF, value: 0.3e18 }); // Bid 6.
    increaseTime(1e4); // End of sale.

    let buyerABalanceAtTheEndOfSale = web3.eth.getBalance(buyerA).toNumber();
    let buyerBBalanceAtTheEndOfSale = web3.eth.getBalance(buyerB).toNumber();
    let buyerCBalanceAtTheEndOfSale = web3.eth.getBalance(buyerC).toNumber();
    let buyerDBalanceAtTheEndOfSale = web3.eth.getBalance(buyerD).toNumber();
    let buyerEBalanceAtTheEndOfSale = web3.eth.getBalance(buyerE).toNumber();
    let buyerFBalanceAtTheEndOfSale = web3.eth.getBalance(buyerF).toNumber();
    let beneficiaryBalanceAtTheEndOfSale = web3.eth
      .getBalance(beneficiary)
      .toNumber();

    await iico.finalize(1000);

    // Redeem and verify we can't redeem more than once.
    await iico.redeem(1);
    await expectThrow(iico.redeem(1));
    await iico.redeem(2);
    await expectThrow(iico.redeem(2));
    await iico.redeem(3);
    await expectThrow(iico.redeem(3));
    await iico.redeem(4);
    await expectThrow(iico.redeem(4));
    await iico.redeem(5);
    await expectThrow(iico.redeem(5));
    await iico.redeem(6);
    await expectThrow(iico.redeem(6));

    // Verify the proper amounts of ETH are refunded.
    assert.equal(
      web3.eth.getBalance(buyerA).toNumber(),
      buyerABalanceAtTheEndOfSale,
      "The buyer A has been given ETH back while the full bid should have been accepted"
    );
    assert.equal(
      web3.eth.getBalance(buyerB).toNumber(),
      buyerBBalanceAtTheEndOfSale + 0.1e18,
      "The buyer B has not been reimbursed as it should"
    );
    assert.equal(
      web3.eth.getBalance(buyerC).toNumber(),
      buyerCBalanceAtTheEndOfSale,
      "The buyer C has been given ETH back while the full bid should have been accepted"
    );
    assert.equal(
      web3.eth.getBalance(buyerD).toNumber(),
      buyerDBalanceAtTheEndOfSale + 0.05e18,
      "The buyer D, whose bid was partially accepted, has not been refunded the correct amount"
    );
    assert.equal(
      web3.eth.getBalance(buyerE).toNumber(),
      buyerEBalanceAtTheEndOfSale + 0.15e18,
      "The buyer E has not been reimbursed as it should"
    );
    assert.equal(
      web3.eth.getBalance(buyerF).toNumber(),
      buyerFBalanceAtTheEndOfSale + 0.3e18,
      "The buyer F has not been reimbursed as it should"
    );

    assert.equal(
      web3.eth.getBalance(beneficiary).toNumber(),
      beneficiaryBalanceAtTheEndOfSale + 0.65e18,
      "The beneficiary has not been paid correctly"
    );

    // Verify that the tokens are correctly distributed.
    assert.equal(
      (await token.balanceOf(buyerA)).toNumber(),
      10e24,
      "The buyer A has not been given the right amount of tokens"
    );
    assert.equal(
      (await token.balanceOf(buyerB)).toNumber(),
      0,
      "The buyer B got some tokens despite having its bid refunded"
    );
    assert.equal(
      (await token.balanceOf(buyerC)).toNumber(),
      40e24,
      "The buyer C has not been given the right amount of tokens"
    );
    assert.equal(
      (await token.balanceOf(buyerD)).toNumber(),
      15e24,
      "The buyer D has not been given the right amount of tokens"
    );
    assert.equal(
      (await token.balanceOf(buyerE)).toNumber(),
      0,
      "The buyer E got some tokens despite having its bid refunded"
    );
    assert.equal(
      (await token.balanceOf(buyerF)).toNumber(),
      0,
      "The buyer F got some tokens despite having its bid refunded"
    );
  });

  it("Should give back tokens to accepted bids and refund others. Full withdrawn bid, full last bid", async () => {
    let startTestTime = web3.eth.getBlock("latest").timestamp;
    let iico = await IICO.new(
      startTestTime + timeBeforeStart,
      fullBonusLength,
      partialWithdrawalLength,
      withdrawalLockUpLength,
      maxBonus,
      beneficiary,
      { from: owner }
    );
    let head = await iico.bids(0);
    let tailID = head[1];
    let tail = await iico.bids(head[1]);
    let token = await MintableToken.new({ from: owner });
    await token.mint(iico.address, 60e24, { from: owner });
    await iico.setToken(token.address, { from: owner });

    increaseTime(1100); // Full bonus period.
    await iico.searchAndBid(1e18, 0, { from: buyerA, value: 0.3e18 }); // Bid 1.
    await iico.searchAndBid(0.6e18, 1, { from: buyerB, value: 0.1e18 }); // Bid 2.
    await iico.searchAndBid(0.8e18, 2, { from: buyerC, value: 0.4e18 }); // Bid 3.
    await iico.searchAndBid(0.7e18, 0, { from: buyerD, value: 0.2e18 }); // Bid 4.
    await iico.searchAndBid(0.5e18, tailID, { from: buyerE, value: 0.15e18 }); // Bid 5.
    await iico.searchAndBid(0.5e18, tailID, { from: buyerF, value: 0.3e18 }); // Bid 6.
    await iico.withdraw(3, { from: buyerC });

    increaseTime(1e4); // End of sale.

    let buyerABalanceAtTheEndOfSale = web3.eth.getBalance(buyerA).toNumber();
    let buyerBBalanceAtTheEndOfSale = web3.eth.getBalance(buyerB).toNumber();
    let buyerCBalanceAtTheEndOfSale = web3.eth.getBalance(buyerC).toNumber();
    let buyerDBalanceAtTheEndOfSale = web3.eth.getBalance(buyerD).toNumber();
    let buyerEBalanceAtTheEndOfSale = web3.eth.getBalance(buyerE).toNumber();
    let buyerFBalanceAtTheEndOfSale = web3.eth.getBalance(buyerF).toNumber();
    let beneficiaryBalanceAtTheEndOfSale = web3.eth
      .getBalance(beneficiary)
      .toNumber();

    await iico.finalize(1000);

    // Redeem and verify we can't redeem more than once.
    await iico.redeem(1);
    await expectThrow(iico.redeem(1));
    await iico.redeem(2);
    await expectThrow(iico.redeem(2));
    await iico.redeem(3);
    await expectThrow(iico.redeem(3));
    await iico.redeem(4);
    await expectThrow(iico.redeem(4));
    await iico.redeem(5);
    await expectThrow(iico.redeem(5));
    await iico.redeem(6);
    await expectThrow(iico.redeem(6));

    // Verify the proper amounts of ETH are refunded.
    assert.equal(
      web3.eth.getBalance(buyerA).toNumber(),
      buyerABalanceAtTheEndOfSale,
      "The buyer A has been given ETH back while the full bid should have been accepted"
    );
    assert.equal(
      web3.eth.getBalance(buyerB).toNumber(),
      buyerBBalanceAtTheEndOfSale,
      "The buyer B has been given ETH back while the full bid should have been accepted"
    );
    assert.equal(
      web3.eth.getBalance(buyerC).toNumber(),
      buyerCBalanceAtTheEndOfSale,
      "The buyer C has withdrawn completely but still got refund after finalization"
    );
    assert.equal(
      web3.eth.getBalance(buyerD).toNumber(),
      buyerDBalanceAtTheEndOfSale,
      "The buyer D has been given ETH back while the full bid should have been accepted"
    );
    assert.equal(
      web3.eth.getBalance(buyerE).toNumber(),
      buyerEBalanceAtTheEndOfSale + 0.15e18,
      "The buyer E has not been reimbursed as it should"
    );
    assert.equal(
      web3.eth.getBalance(buyerF).toNumber(),
      buyerFBalanceAtTheEndOfSale + 0.3e18,
      "The buyer F has not been reimbursed as it should"
    );

    assert.equal(
      web3.eth.getBalance(beneficiary).toNumber(),
      beneficiaryBalanceAtTheEndOfSale + 0.6e18,
      "The beneficiary has not been paid correctly"
    );

    // Verify that the tokens are correctly distributed.
    assert.equal(
      (await token.balanceOf(buyerA)).toNumber(),
      30e24,
      "The buyer A has not been given the right amount of tokens"
    );
    assert.equal(
      (await token.balanceOf(buyerB)).toNumber(),
      10e24,
      "The buyer B got some tokens despite having its bid refunded"
    );
    assert.equal(
      (await token.balanceOf(buyerC)).toNumber(),
      0,
      "The buyer C has withdrawn completely but still got tokens"
    );
    assert.equal(
      (await token.balanceOf(buyerD)).toNumber(),
      20e24,
      "The buyer D has not been given the right amount of tokens"
    );
    assert.equal(
      (await token.balanceOf(buyerE)).toNumber(),
      0,
      "The buyer E got some tokens despite having its bid refunded"
    );
    assert.equal(
      (await token.balanceOf(buyerF)).toNumber(),
      0,
      "The buyer F got some tokens despite having its bid refunded"
    );
  });

  it("Should give back tokens to accepted bids and refund others. Full withdrawn bid, non full last bid", async () => {
    let startTestTime = web3.eth.getBlock("latest").timestamp;
    let iico = await IICO.new(
      startTestTime + timeBeforeStart,
      fullBonusLength,
      partialWithdrawalLength,
      withdrawalLockUpLength,
      maxBonus,
      beneficiary,
      { from: owner }
    );
    let head = await iico.bids(0);
    let tailID = head[1];
    let tail = await iico.bids(head[1]);
    let token = await MintableToken.new({ from: owner });
    await token.mint(iico.address, 60e24, { from: owner });
    await iico.setToken(token.address, { from: owner });

    increaseTime(1100); // Full bonus period.
    await iico.searchAndBid(1e18, 0, { from: buyerA, value: 0.3e18 }); // Bid 1.
    await iico.searchAndBid(0.65e18, 1, { from: buyerB, value: 0.1e18 }); // Bid 2.
    await iico.searchAndBid(0.8e18, 2, { from: buyerC, value: 0.4e18 }); // Bid 3.
    await iico.searchAndBid(0.7e18, 0, { from: buyerD, value: 0.2e18 }); // Bid 4.
    await iico.searchAndBid(0.5e18, tailID, { from: buyerE, value: 0.15e18 }); // Bid 5.
    await iico.searchAndBid(0.5e18, tailID, { from: buyerF, value: 0.3e18 }); // Bid 6.
    await iico.withdraw(3, { from: buyerC });

    increaseTime(1e4); // End of sale.

    let buyerABalanceAtTheEndOfSale = web3.eth.getBalance(buyerA).toNumber();
    let buyerBBalanceAtTheEndOfSale = web3.eth.getBalance(buyerB).toNumber();
    let buyerCBalanceAtTheEndOfSale = web3.eth.getBalance(buyerC).toNumber();
    let buyerDBalanceAtTheEndOfSale = web3.eth.getBalance(buyerD).toNumber();
    let buyerEBalanceAtTheEndOfSale = web3.eth.getBalance(buyerE).toNumber();
    let buyerFBalanceAtTheEndOfSale = web3.eth.getBalance(buyerF).toNumber();
    let beneficiaryBalanceAtTheEndOfSale = web3.eth
      .getBalance(beneficiary)
      .toNumber();

    await iico.finalize(1000);

    // Redeem and verify we can't redeem more than once.
    await iico.redeem(1);
    await expectThrow(iico.redeem(1));
    await iico.redeem(2);
    await expectThrow(iico.redeem(2));
    await iico.redeem(3);
    await expectThrow(iico.redeem(3));
    await iico.redeem(4);
    await expectThrow(iico.redeem(4));
    await iico.redeem(5);
    await expectThrow(iico.redeem(5));
    await iico.redeem(6);
    await expectThrow(iico.redeem(6));

    // Verify the proper amounts of ETH are refunded.
    assert.equal(
      web3.eth.getBalance(buyerA).toNumber(),
      buyerABalanceAtTheEndOfSale,
      "The buyer A has been given ETH back while the full bid should have been accepted"
    );
    assert.equal(
      web3.eth.getBalance(buyerB).toNumber(),
      buyerBBalanceAtTheEndOfSale,
      "The buyer B has been given ETH back while the full bid should have been accepted"
    );
    assert.equal(
      web3.eth.getBalance(buyerC).toNumber(),
      buyerCBalanceAtTheEndOfSale,
      "The buyer C has withdrawn completely but still got refund after finalization"
    );
    assert.equal(
      web3.eth.getBalance(buyerD).toNumber(),
      buyerDBalanceAtTheEndOfSale,
      "The buyer D has been given ETH back while the full bid should have been accepted"
    );
    assert.equal(
      web3.eth.getBalance(buyerE).toNumber(),
      buyerEBalanceAtTheEndOfSale + 0.15e18,
      "The buyer E has not been reimbursed as it should"
    );
    assert.equal(
      web3.eth.getBalance(buyerF).toNumber(),
      buyerFBalanceAtTheEndOfSale + 0.3e18,
      "The buyer F has not been reimbursed as it should"
    );

    assert.equal(
      web3.eth.getBalance(beneficiary).toNumber(),
      beneficiaryBalanceAtTheEndOfSale + 0.6e18,
      "The beneficiary has not been paid correctly"
    );

    // Verify that the tokens are correctly distributed.
    assert.equal(
      (await token.balanceOf(buyerA)).toNumber(),
      30e24,
      "The buyer A has not been given the right amount of tokens"
    );
    assert.equal(
      (await token.balanceOf(buyerB)).toNumber(),
      10e24,
      "The buyer B has not been given the right amount of tokens"
    );
    assert.equal(
      (await token.balanceOf(buyerC)).toNumber(),
      0,
      "The buyer C has withdrawn completely but still got tokens"
    );
    assert.equal(
      (await token.balanceOf(buyerD)).toNumber(),
      20e24,
      "The buyer D has not been given the right amount of tokens"
    );
    assert.equal(
      (await token.balanceOf(buyerE)).toNumber(),
      0,
      "The buyer E got some tokens despite having its bid refunded"
    );
    assert.equal(
      (await token.balanceOf(buyerF)).toNumber(),
      0,
      "The buyer F got some tokens despite having its bid refunded"
    );
  });

  it("Should give back tokens to accepted bids and refund others. Full withdrawn bid, partial last bid", async () => {
    let startTestTime = web3.eth.getBlock("latest").timestamp;
    let iico = await IICO.new(
      startTestTime + timeBeforeStart,
      fullBonusLength,
      partialWithdrawalLength,
      withdrawalLockUpLength,
      maxBonus,
      beneficiary,
      { from: owner }
    );
    let head = await iico.bids(0);
    let tailID = head[1];
    let tail = await iico.bids(head[1]);
    let token = await MintableToken.new({ from: owner });
    await token.mint(iico.address, 60e24, { from: owner });
    await iico.setToken(token.address, { from: owner });

    increaseTime(1100); // Full bonus period.
    await iico.searchAndBid(1e18, 0, { from: buyerA, value: 0.3e18 }); // Bid 1.
    await iico.searchAndBid(0.6e18, 1, { from: buyerB, value: 0.2e18 }); // Bid 2.
    await iico.searchAndBid(0.8e18, 2, { from: buyerC, value: 0.4e18 }); // Bid 3.
    await iico.searchAndBid(0.7e18, 0, { from: buyerD, value: 0.2e18 }); // Bid 4.
    await iico.searchAndBid(0.5e18, tailID, { from: buyerE, value: 0.15e18 }); // Bid 5.
    await iico.searchAndBid(0.5e18, tailID, { from: buyerF, value: 0.3e18 }); // Bid 6.
    await iico.withdraw(3, { from: buyerC });

    increaseTime(1e4); // End of sale.

    let buyerABalanceAtTheEndOfSale = web3.eth.getBalance(buyerA).toNumber();
    let buyerBBalanceAtTheEndOfSale = web3.eth.getBalance(buyerB).toNumber();
    let buyerCBalanceAtTheEndOfSale = web3.eth.getBalance(buyerC).toNumber();
    let buyerDBalanceAtTheEndOfSale = web3.eth.getBalance(buyerD).toNumber();
    let buyerEBalanceAtTheEndOfSale = web3.eth.getBalance(buyerE).toNumber();
    let buyerFBalanceAtTheEndOfSale = web3.eth.getBalance(buyerF).toNumber();
    let beneficiaryBalanceAtTheEndOfSale = web3.eth
      .getBalance(beneficiary)
      .toNumber();

    await iico.finalize(1000);

    // Redeem and verify we can't redeem more than once.
    await iico.redeem(1);
    await expectThrow(iico.redeem(1));
    await iico.redeem(2);
    await expectThrow(iico.redeem(2));
    await iico.redeem(3);
    await expectThrow(iico.redeem(3));
    await iico.redeem(4);
    await expectThrow(iico.redeem(4));
    await iico.redeem(5);
    await expectThrow(iico.redeem(5));
    await iico.redeem(6);
    await expectThrow(iico.redeem(6));

    // Verify the proper amounts of ETH are refunded.
    assert.equal(
      web3.eth.getBalance(buyerA).toNumber(),
      buyerABalanceAtTheEndOfSale,
      "The buyer A has been given ETH back while the full bid should have been accepted"
    );
    assert.equal(
      web3.eth.getBalance(buyerB).toNumber(),
      buyerBBalanceAtTheEndOfSale + 0.1e18,
      "The buyer B whose bid has been partially accepted has not gotten the right amount of ETH back"
    );
    assert.equal(
      web3.eth.getBalance(buyerC).toNumber(),
      buyerCBalanceAtTheEndOfSale,
      "The buyer C has withdrawn completely but still got refund after finalization"
    );
    assert.equal(
      web3.eth.getBalance(buyerD).toNumber(),
      buyerDBalanceAtTheEndOfSale,
      "The buyer D has been given ETH back while the full bid should have been accepted"
    );
    assert.equal(
      web3.eth.getBalance(buyerE).toNumber(),
      buyerEBalanceAtTheEndOfSale + 0.15e18,
      "The buyer E has not been reimbursed as it should"
    );
    assert.equal(
      web3.eth.getBalance(buyerF).toNumber(),
      buyerFBalanceAtTheEndOfSale + 0.3e18,
      "The buyer F has not been reimbursed as it should"
    );

    assert.equal(
      web3.eth.getBalance(beneficiary).toNumber(),
      beneficiaryBalanceAtTheEndOfSale + 0.6e18,
      "The beneficiary has not been paid correctly"
    );

    // Verify that the tokens are correctly distributed.
    assert.equal(
      (await token.balanceOf(buyerA)).toNumber(),
      30e24,
      "The buyer A has not been given the right amount of tokens"
    );
    assert.equal(
      (await token.balanceOf(buyerB)).toNumber(),
      10e24,
      "The buyer B has not been given the right amount of tokens"
    );
    assert.equal(
      (await token.balanceOf(buyerC)).toNumber(),
      0,
      "The buyer C has withdrawn completely but still got tokens"
    );
    assert.equal(
      (await token.balanceOf(buyerD)).toNumber(),
      20e24,
      "The buyer D has not been given the right amount of tokens"
    );
    assert.equal(
      (await token.balanceOf(buyerE)).toNumber(),
      0,
      "The buyer E got some tokens despite having its bid refunded"
    );
    assert.equal(
      (await token.balanceOf(buyerF)).toNumber(),
      0,
      "The buyer F got some tokens despite having its bid refunded"
    );
  });

  it("Should give back tokens to accepted bids and refund others. All accepted, some without max bonus", async () => {
    let startTestTime = web3.eth.getBlock("latest").timestamp;
    let iico = await IICO.new(
      startTestTime + timeBeforeStart,
      fullBonusLength,
      partialWithdrawalLength,
      withdrawalLockUpLength,
      maxBonus,
      beneficiary,
      { from: owner }
    );
    let head = await iico.bids(0);
    let tailID = head[1];
    let tail = await iico.bids(head[1]);
    let token = await MintableToken.new({ from: owner });
    await token.mint(iico.address, 115.8e24, { from: owner });
    await iico.setToken(token.address, { from: owner });

    increaseTime(1010); // Full bonus period.
    await iico.searchAndBid(10e18, 0, { from: buyerA, value: 0.1e18 }); // Bid 1.
    increaseTime(5990);
    await iico.searchAndBid(6e18, 1, { from: buyerB, value: 0.1e18 }); // Bid 2. Bonus: 0.8*maxBonus
    increaseTime(1000);
    await iico.searchAndBid(8e18, 2, { from: buyerC, value: 0.4e18 }); // Bid 3. Bonus: 0.6*maxBonus
    increaseTime(1000);
    await iico.searchAndBid(7e18, 0, { from: buyerD, value: 0.2e18 }); // Bid 4. Bonus: 0.4*maxBonus
    increaseTime(1000);
    await iico.searchAndBid(5e18, tailID, { from: buyerE, value: 0.15e18 }); // Bid 5. Bonus: 0.2*maxBonus
    increaseTime(500);
    await iico.searchAndBid(5e18, tailID, { from: buyerF, value: 0.1e18 }); // Bid 6. Bonus : 0.1*maxBonus
    increaseTime(1e4); // End of sale.

    let buyerABalanceAtTheEndOfSale = web3.eth.getBalance(buyerA).toNumber();
    let buyerBBalanceAtTheEndOfSale = web3.eth.getBalance(buyerB).toNumber();
    let buyerCBalanceAtTheEndOfSale = web3.eth.getBalance(buyerC).toNumber();
    let buyerDBalanceAtTheEndOfSale = web3.eth.getBalance(buyerD).toNumber();
    let buyerEBalanceAtTheEndOfSale = web3.eth.getBalance(buyerE).toNumber();
    let buyerFBalanceAtTheEndOfSale = web3.eth.getBalance(buyerF).toNumber();
    let beneficiaryBalanceAtTheEndOfSale = web3.eth
      .getBalance(beneficiary)
      .toNumber();

    await iico.finalize(1000);

    // Redeem and verify we can't redeem more than once.
    await iico.redeem(1);
    await expectThrow(iico.redeem(1));
    await iico.redeem(2);
    await expectThrow(iico.redeem(2));
    await iico.redeem(3);
    await expectThrow(iico.redeem(3));
    await iico.redeem(4);
    await expectThrow(iico.redeem(4));
    await iico.redeem(5);
    await expectThrow(iico.redeem(5));
    await iico.redeem(6);
    await expectThrow(iico.redeem(6));

    // Verify the proper amounts of ETH are refunded.
    assert.equal(
      web3.eth.getBalance(buyerA).toNumber(),
      buyerABalanceAtTheEndOfSale,
      "The buyer A has been given ETH back while the full bid should have been accepted"
    );
    assert.equal(
      web3.eth.getBalance(buyerB).toNumber(),
      buyerBBalanceAtTheEndOfSale,
      "The buyer B has been given ETH back while the full bid should have been accepted"
    );
    assert.equal(
      web3.eth.getBalance(buyerC).toNumber(),
      buyerCBalanceAtTheEndOfSale,
      "The buyer C has been given ETH back while the full bid should have been accepted"
    );
    assert.equal(
      web3.eth.getBalance(buyerD).toNumber(),
      buyerDBalanceAtTheEndOfSale,
      "The buyer D has been given ETH back while the full bid should have been accepted"
    );
    assert.equal(
      web3.eth.getBalance(buyerE).toNumber(),
      buyerEBalanceAtTheEndOfSale,
      "The buyer E has been given ETH back while the full bid should have been accepted"
    );
    assert.equal(
      web3.eth.getBalance(buyerF).toNumber(),
      buyerFBalanceAtTheEndOfSale,
      "The buyer F has been given ETH back while the full bid should have been accepted"
    );

    assert.equal(
      web3.eth.getBalance(beneficiary).toNumber(),
      beneficiaryBalanceAtTheEndOfSale + 1.05e18,
      "The beneficiary has not been paid correctly"
    );

    // Verify that the tokens are correctly distributed.
    // Allow up to 1% of error due to time not being prefect.
    assert(
      Math.abs((await token.balanceOf(buyerA)).toNumber() - 12e24) <=
        12e24 / 100,
      "The buyer A has not been given the right amount of tokens"
    );
    assert(
      Math.abs((await token.balanceOf(buyerB)).toNumber() - 11.6e24) <=
        11.6e24 / 100,
      "The buyer B has not been given the right amount of tokens"
    );
    assert(
      Math.abs((await token.balanceOf(buyerC)).toNumber() - 44.8e24) <=
        44.8e24 / 100,
      "The buyer C has not been given the right amount of tokens"
    );
    assert(
      Math.abs((await token.balanceOf(buyerD)).toNumber() - 21.6e24) <=
        21.6e24 / 100,
      "The buyer D has not been given the right amount of tokens"
    );
    assert(
      Math.abs((await token.balanceOf(buyerE)).toNumber() - 15.6e24) <=
        15.6e24 / 100,
      "The buyer E has not been given the right amount of tokens"
    );
    assert(
      Math.abs((await token.balanceOf(buyerF)).toNumber() - 10.2e24) <=
        10.2e24 / 100,
      "The buyer F has not been given the right amount of tokens"
    );
  });

  it("Should give back tokens to accepted bids and refund others. Some accepted, some without max bonus", async () => {
    let startTestTime = web3.eth.getBlock("latest").timestamp;
    let iico = await IICO.new(
      startTestTime + timeBeforeStart,
      fullBonusLength,
      partialWithdrawalLength,
      withdrawalLockUpLength,
      maxBonus,
      beneficiary,
      { from: owner }
    );
    let head = await iico.bids(0);
    let tailID = head[1];
    let tail = await iico.bids(head[1]);
    let token = await MintableToken.new({ from: owner });
    await token.mint(iico.address, 78.4e24, { from: owner });
    await iico.setToken(token.address, { from: owner });

    increaseTime(1010); // Full bonus period.
    await iico.searchAndBid(1e18, 0, { from: buyerA, value: 0.1e18 }); // Bid 1.
    increaseTime(5990);
    await iico.searchAndBid(0.6e18, 1, { from: buyerB, value: 0.1e18 }); // Bid 2. Bonus: 0.8*maxBonus
    increaseTime(1000);
    await iico.searchAndBid(0.8e18, 2, { from: buyerC, value: 0.4e18 }); // Bid 3. Bonus: 0.6*maxBonus
    increaseTime(1000);
    await iico.searchAndBid(0.7e18, 0, { from: buyerD, value: 0.2e18 }); // Bid 4. Bonus: 0.4*maxBonus
    increaseTime(1000);
    await iico.searchAndBid(0.5e18, tailID, { from: buyerE, value: 0.15e18 }); // Bid 5. Bonus: 0.2*maxBonus
    increaseTime(500);
    await iico.searchAndBid(0.5e18, tailID, { from: buyerF, value: 0.1e18 }); // Bid 6. Bonus : 0.1*maxBonus
    increaseTime(1e4); // End of sale.

    let buyerABalanceAtTheEndOfSale = web3.eth.getBalance(buyerA).toNumber();
    let buyerBBalanceAtTheEndOfSale = web3.eth.getBalance(buyerB).toNumber();
    let buyerCBalanceAtTheEndOfSale = web3.eth.getBalance(buyerC).toNumber();
    let buyerDBalanceAtTheEndOfSale = web3.eth.getBalance(buyerD).toNumber();
    let buyerEBalanceAtTheEndOfSale = web3.eth.getBalance(buyerE).toNumber();
    let buyerFBalanceAtTheEndOfSale = web3.eth.getBalance(buyerF).toNumber();
    let beneficiaryBalanceAtTheEndOfSale = web3.eth
      .getBalance(beneficiary)
      .toNumber();

    await iico.finalize(1000);

    // Redeem and verify we can't redeem more than once.
    await iico.redeem(1);
    await expectThrow(iico.redeem(1));
    await iico.redeem(2);
    await expectThrow(iico.redeem(2));
    await iico.redeem(3);
    await expectThrow(iico.redeem(3));
    await iico.redeem(4);
    await expectThrow(iico.redeem(4));
    await iico.redeem(5);
    await expectThrow(iico.redeem(5));
    await iico.redeem(6);
    await expectThrow(iico.redeem(6));

    // Verify the proper amounts of ETH are refunded.
    assert.equal(
      web3.eth.getBalance(buyerA).toNumber(),
      buyerABalanceAtTheEndOfSale,
      "The buyer A has been given ETH back while the full bid should have been accepted"
    );
    assert.equal(
      web3.eth.getBalance(buyerB).toNumber(),
      buyerBBalanceAtTheEndOfSale + 0.1e18,
      "The buyer B has not been reimbursed as it should"
    );
    assert.equal(
      web3.eth.getBalance(buyerC).toNumber(),
      buyerCBalanceAtTheEndOfSale,
      "The buyer C has been given ETH back while the full bid should have been accepted"
    );
    assert.equal(
      web3.eth.getBalance(buyerD).toNumber(),
      buyerDBalanceAtTheEndOfSale,
      "The buyer D has been given ETH back while the full bid should have been accepted"
    );
    assert.equal(
      web3.eth.getBalance(buyerE).toNumber(),
      buyerEBalanceAtTheEndOfSale + 0.15e18,
      "The buyer E has not been reimbursed as it should"
    );
    assert.equal(
      web3.eth.getBalance(buyerF).toNumber(),
      buyerFBalanceAtTheEndOfSale + 0.1e18,
      "The buyer F has not been reimbursed as it should"
    );

    assert.equal(
      web3.eth.getBalance(beneficiary).toNumber(),
      beneficiaryBalanceAtTheEndOfSale + 0.7e18,
      "The beneficiary has not been paid correctly"
    );

    // Verify that the tokens are correctly distributed.
    // Allow up to 1% of error due to time not being prefect.
    assert(
      Math.abs((await token.balanceOf(buyerA)).toNumber() - 12e24) <=
        12e24 / 100,
      "The buyer A has not been given the right amount of tokens"
    );
    assert(
      (await token.balanceOf(buyerB)).toNumber() === 0,
      "The buyer B has not been given the right amount of tokens"
    );
    assert(
      Math.abs((await token.balanceOf(buyerC)).toNumber() - 44.8e24) <=
        44.8e24 / 100,
      "The buyer C has not been given the right amount of tokens"
    );
    assert(
      Math.abs((await token.balanceOf(buyerD)).toNumber() - 21.6e24) <=
        21.6e24 / 100,
      "The buyer D has not been given the right amount of tokens"
    );
    assert(
      (await token.balanceOf(buyerE)).toNumber() === 0,
      "The buyer E has not been given the right amount of tokens"
    );
    assert(
      (await token.balanceOf(buyerF)).toNumber() === 0,
      "The buyer F has not been given the right amount of tokens"
    );
  });

  it("Should give back tokens to accepted bids and refund others. Some accepted, some without max bonus, one bid partially withdrawn", async () => {
    let startTestTime = web3.eth.getBlock("latest").timestamp;
    let iico = await IICO.new(
      startTestTime + timeBeforeStart,
      fullBonusLength,
      partialWithdrawalLength,
      withdrawalLockUpLength,
      maxBonus,
      beneficiary,
      { from: owner }
    );
    let head = await iico.bids(0);
    let tailID = head[1];
    let tail = await iico.bids(head[1]);
    let token = await MintableToken.new({ from: owner });
    await token.mint(iico.address, 75.36e24, { from: owner });
    await iico.setToken(token.address, { from: owner });

    increaseTime(1010); // Full bonus period.
    await iico.searchAndBid(1e18, 0, { from: buyerA, value: 0.1e18 }); // Bid 1.
    increaseTime(5990);
    await iico.searchAndBid(0.6e18, 1, { from: buyerB, value: 0.1e18 }); // Bid 2. Bonus: 0.8*maxBonus
    increaseTime(1000);
    await iico.searchAndBid(0.8e18, 2, { from: buyerC, value: 0.4e18 }); // Bid 3. Bonus: 0.6*maxBonus
    await iico.withdraw(1, { from: buyerA });
    increaseTime(1000);
    await iico.searchAndBid(0.7e18, 0, { from: buyerD, value: 0.2e18 }); // Bid 4. Bonus: 0.4*maxBonus
    increaseTime(1000);
    await iico.searchAndBid(0.5e18, tailID, { from: buyerE, value: 0.15e18 }); // Bid 5. Bonus: 0.2*maxBonus
    increaseTime(500);
    await iico.searchAndBid(0.5e18, tailID, { from: buyerF, value: 0.1e18 }); // Bid 6. Bonus : 0.1*maxBonus
    increaseTime(1e4); // End of sale.

    let buyerABalanceAtTheEndOfSale = web3.eth.getBalance(buyerA).toNumber();
    let buyerBBalanceAtTheEndOfSale = web3.eth.getBalance(buyerB).toNumber();
    let buyerCBalanceAtTheEndOfSale = web3.eth.getBalance(buyerC).toNumber();
    let buyerDBalanceAtTheEndOfSale = web3.eth.getBalance(buyerD).toNumber();
    let buyerEBalanceAtTheEndOfSale = web3.eth.getBalance(buyerE).toNumber();
    let buyerFBalanceAtTheEndOfSale = web3.eth.getBalance(buyerF).toNumber();
    let beneficiaryBalanceAtTheEndOfSale = web3.eth
      .getBalance(beneficiary)
      .toNumber();

    await iico.finalize(1000);

    // Redeem and verify we can't redeem more than once.
    await iico.redeem(1);
    await expectThrow(iico.redeem(1));
    await iico.redeem(2);
    await expectThrow(iico.redeem(2));
    await iico.redeem(3);
    await expectThrow(iico.redeem(3));
    await iico.redeem(4);
    await expectThrow(iico.redeem(4));
    await iico.redeem(5);
    await expectThrow(iico.redeem(5));
    await iico.redeem(6);
    await expectThrow(iico.redeem(6));

    // Verify the proper amounts of ETH are refunded.
    assert.equal(
      web3.eth.getBalance(buyerA).toNumber(),
      buyerABalanceAtTheEndOfSale,
      "The buyer A has been given ETH back while the full bid should have been accepted"
    );
    assert.equal(
      web3.eth.getBalance(buyerB).toNumber(),
      buyerBBalanceAtTheEndOfSale + 0.1e18,
      "The buyer B has not been reimbursed as it should"
    );
    assert.equal(
      web3.eth.getBalance(buyerC).toNumber(),
      buyerCBalanceAtTheEndOfSale,
      "The buyer C has been given ETH back while the full bid should have been accepted"
    );
    assert.equal(
      web3.eth.getBalance(buyerD).toNumber(),
      buyerDBalanceAtTheEndOfSale,
      "The buyer D has been given ETH back while the full bid should have been accepted"
    );
    assert.equal(
      web3.eth.getBalance(buyerE).toNumber(),
      buyerEBalanceAtTheEndOfSale + 0.15e18,
      "The buyer E has not been reimbursed as it should"
    );
    assert.equal(
      web3.eth.getBalance(buyerF).toNumber(),
      buyerFBalanceAtTheEndOfSale + 0.1e18,
      "The buyer F has not been reimbursed as it should"
    );

    assert(
      Math.abs(
        web3.eth.getBalance(beneficiary).toNumber() -
          (beneficiaryBalanceAtTheEndOfSale + 0.68e18)
      ) <=
        0.68e18 / 100,
      "The beneficiary has not been paid correctly"
    );

    // Verify that the tokens are correctly distributed.
    // Allow up to 1% of error due to time not being prefect. For buyer A up to 2% because of time error both in bid and withdraw.
    assert(
      Math.abs((await token.balanceOf(buyerA)).toNumber() - 8.96e24) <=
        (2 * 8.96e24) / 100,
      "The buyer A has not been given the right amount of tokens"
    );
    assert(
      (await token.balanceOf(buyerB)).toNumber() === 0,
      "The buyer B has not been given the right amount of tokens"
    );
    assert(
      Math.abs((await token.balanceOf(buyerC)).toNumber() - 44.8e24) <=
        44.8e24 / 100,
      "The buyer C has not been given the right amount of tokens"
    );
    assert(
      Math.abs((await token.balanceOf(buyerD)).toNumber() - 21.6e24) <=
        21.6e24 / 100,
      "The buyer D has not been given the right amount of tokens"
    );
    assert(
      (await token.balanceOf(buyerE)).toNumber() === 0,
      "The buyer E has not been given the right amount of tokens"
    );
    assert(
      (await token.balanceOf(buyerF)).toNumber() === 0,
      "The buyer F has not been given the right amount of tokens"
    );
  });

  // Fallback
  it("Should make bids of infinite max val and withdraw them", async () => {
    let startTestTime = web3.eth.getBlock("latest").timestamp;
    let iico = await IICO.new(
      startTestTime + timeBeforeStart,
      fullBonusLength,
      partialWithdrawalLength,
      withdrawalLockUpLength,
      maxBonus,
      beneficiary,
      { from: owner }
    );
    let head = await iico.bids(0);
    let tailID = head[1];
    let tail = await iico.bids(head[1]);
    let token = await MintableToken.new({ from: owner });
    await token.mint(iico.address, 70e24, { from: owner });
    await iico.setToken(token.address, { from: owner });

    increaseTime(1100); // Full bonus period.
    await iico.sendTransaction({ from: buyerA, value: 0.1e18 }); // Bid 1.
    await iico.searchAndBid(0.6e18, 1, { from: buyerB, value: 0.1e18 }); // Bid 2.
    await iico.sendTransaction({ from: buyerC, value: 0.3e18 }); // Bid 3.
    await iico.sendTransaction({ from: buyerC, value: 0.1e18 }); // Bid 4.
    await iico.searchAndBid(0.7e18, 0, { from: buyerD, value: 0.2e18 }); // Bid 5.
    await iico.searchAndBid(0.5e18, tailID, { from: buyerE, value: 0.15e18 }); // Bid 6.
    await iico.searchAndBid(0.5e18, tailID, { from: buyerF, value: 0.3e18 }); // Bid 7.
    increaseTime(1e4); // End of sale.

    let buyerABalanceAtTheEndOfSale = web3.eth.getBalance(buyerA).toNumber();
    let buyerBBalanceAtTheEndOfSale = web3.eth.getBalance(buyerB).toNumber();
    let buyerCBalanceAtTheEndOfSale = web3.eth.getBalance(buyerC).toNumber();
    let buyerDBalanceAtTheEndOfSale = web3.eth.getBalance(buyerD).toNumber();
    let buyerEBalanceAtTheEndOfSale = web3.eth.getBalance(buyerE).toNumber();
    let buyerFBalanceAtTheEndOfSale = web3.eth.getBalance(buyerF).toNumber();
    let beneficiaryBalanceAtTheEndOfSale = web3.eth
      .getBalance(beneficiary)
      .toNumber();

    await iico.finalize(1000);

    // Redeem and verify we can't redeem more than once.
    let txA = await iico.sendTransaction({
      from: buyerA,
      GAS_PRICE: GAS_PRICE
    });
    let txFeeA = txA.receipt.gasUsed * GAS_PRICE;
    await iico.redeem(2);
    await expectThrow(iico.redeem(2));
    let txC = await iico.sendTransaction({
      from: buyerC,
      GAS_PRICE: GAS_PRICE
    });
    let txFeeC = txC.receipt.gasUsed * GAS_PRICE;
    await iico.redeem(5);
    await expectThrow(iico.redeem(5));
    await iico.redeem(6);
    await expectThrow(iico.redeem(6));
    await iico.redeem(7);
    await expectThrow(iico.redeem(7));

    // Verify the proper amounts of ETH are refunded.
    assert.equal(
      web3.eth
        .getBalance(buyerA)
        .plus(txFeeA)
        .toNumber(),
      buyerABalanceAtTheEndOfSale,
      "The buyer A has been given ETH back while the full bid should have been accepted"
    );
    assert.equal(
      web3.eth.getBalance(buyerB).toNumber(),
      buyerBBalanceAtTheEndOfSale + 0.1e18,
      "The buyer B has not been reimbursed as it should"
    );
    assert.equal(
      web3.eth
        .getBalance(buyerC)
        .plus(txFeeC)
        .toNumber(),
      buyerCBalanceAtTheEndOfSale,
      "The buyer C has been given ETH back while the full bid should have been accepted"
    );
    assert.equal(
      web3.eth.getBalance(buyerD).toNumber(),
      buyerDBalanceAtTheEndOfSale,
      "The buyer D has been given ETH back while the full bid should have been accepted"
    );
    assert.equal(
      web3.eth.getBalance(buyerE).toNumber(),
      buyerEBalanceAtTheEndOfSale + 0.15e18,
      "The buyer E has not been reimbursed as it should"
    );
    assert.equal(
      web3.eth.getBalance(buyerF).toNumber(),
      buyerFBalanceAtTheEndOfSale + 0.3e18,
      "The buyer F has not been reimbursed as it should"
    );

    assert.equal(
      web3.eth.getBalance(beneficiary).toNumber(),
      beneficiaryBalanceAtTheEndOfSale + 0.7e18,
      "The beneficiary has not been paid correctly"
    );

    // Verify that the tokens are correctly distributed.
    assert.equal(
      (await token.balanceOf(buyerA)).toNumber(),
      10e24,
      "The buyer A has not been given the right amount of tokens"
    );
    assert.equal(
      (await token.balanceOf(buyerB)).toNumber(),
      0,
      "The buyer B got some tokens despite having its bid refunded"
    );
    assert.equal(
      (await token.balanceOf(buyerC)).toNumber(),
      40e24,
      "The buyer C has not been given the right amount of tokens"
    );
    assert.equal(
      (await token.balanceOf(buyerD)).toNumber(),
      20e24,
      "The buyer D has not been given the right amount of tokens"
    );
    assert.equal(
      (await token.balanceOf(buyerE)).toNumber(),
      0,
      "The buyer E got some tokens despite having its bid refunded"
    );
    assert.equal(
      (await token.balanceOf(buyerF)).toNumber(),
      0,
      "The buyer F got some tokens despite having its bid refunded"
    );
  });

  // https://medium.com/kleros/how-interactive-coin-offerings-iicos-work-beed401ce526
  // ! ! ! NOTE THAT WE ARE DOING REFUNDS DIFFERENTLY, see: https://github.com/kleros/openiico-contract/issues/18
  // Bob 6 ETH remains in the sale, up to 20 ETH, only 4 ETH gets refunded
  it("Test case from the blog", async () => {
    let startTestTime = web3.eth.getBlock("latest").timestamp;
    let iico = await IICO.new(
      startTestTime + timeBeforeStart,
      fullBonusLength,
      partialWithdrawalLength,
      withdrawalLockUpLength,
      maxBonus,
      beneficiary,
      { from: owner }
    );
    let head = await iico.bids(0);
    let tailID = head[1];
    let tail = await iico.bids(head[1]);
    let token = await MintableToken.new({ from: owner });
    await token.mint(iico.address, 100e18, { from: owner }); // We will use a 100 PNK sale for the example.
    await iico.setToken(token.address, { from: owner });

    increaseTime(1000); // Full bonus period.
    /* ALICE */ await iico.searchAndBid(noCap, 0, {
      from: buyerA,
      value: 6e18
    }); // Alice's bid
    var aliceBid = await iico.bids.call(1);

    increaseTime(5250); // 250 elapsed, 1/20 of 2500+2500
    /* BOB */ await iico.searchAndBid(20e18, 0, { from: buyerB, value: 10e18 }); // Bob's bid, bonus 19%

    increaseTime(250); // another 250 elapsed, 2/20 of 2500
    /* CARL */ await iico.searchAndBid(25e18, 0, { from: buyerC, value: 5e18 }); // Carl's bid, bonus 18%

    // He will only be able to withdraw whatever percentage is left of the first phase.
    // Carl withdraws manually 80% of the way through the end of the first phase.
    increaseTime(1500); // now it's 2000 of 2500 partialWithdrawalLength, which equal to 80%, therefore returning 20% of the bid

    let CarlBalanceBeforeReimbursment = web3.eth.getBalance(buyerC);
    var CarlsBidBefore = await iico.bids.call(3);
    var CarlsBidBeforeBonus = CarlsBidBefore[4].toNumber(); // it's a struct, getting 4 field
    assert.closeTo(
      CarlsBidBeforeBonus,
      1.8e8,
      0.01e8,
      "Bonus amount not correct before withdrawing the bid"
    );

    await expectThrow(iico.withdraw(3, { from: buyerB })); // Only the contributor can withdraw.
    let tx = await iico.withdraw(3, { from: buyerC, GAS_PRICE: GAS_PRICE });

    await expectThrow(iico.withdraw(3, { from: buyerC, GAS_PRICE: GAS_PRICE })); // cannot withdraw more than once
    let txFee = tx.receipt.gasUsed * GAS_PRICE;
    let CarlBalanceAfterReimbursment = web3.eth.getBalance(buyerC);
    assert.closeTo(
      CarlBalanceBeforeReimbursment.plus(1e18)
        .minus(txFee)
        .toNumber(),
      CarlBalanceAfterReimbursment.toNumber(),
      0.01 * 1e18,
      "Reimbursement amount not correct"
    );

    var CarlsBidAfter = await iico.bids.call(3);
    var CarlsBidAfterBonus = CarlsBidAfter[4].toNumber();
    assert.closeTo(
      CarlsBidAfterBonus,
      1.2e8,
      0.01e8,
      "Bonus amount not correct, after withdrawal of the bid (reduced by 1/3)"
    );

    // Now David, after seeing how the sale is evolving, decides that he also wants some tokens
    // and contributes 4 ETH with a personal cap of 24 ETH. He gets an 8% bonus.
    increaseTime(1000); // now it is 3000 out of 5000
    /* DAVID */ await iico.searchAndBid(24e18, 0, {
      from: buyerD,
      value: 4e18
    }); // Davids's bid, bonus 8%

    var DavidsBid = await iico.bids.call(4);
    var DavidsBidBonus = DavidsBid[4].toNumber();
    assert.closeTo(DavidsBidBonus, 0.8e8, 0.01e8, "Bonus amount not correct");

    increaseTime(1e4); // End of sale.

    let buyerABalanceAtTheEndOfSale = web3.eth.getBalance(buyerA).toNumber();
    let buyerBBalanceAtTheEndOfSale = web3.eth.getBalance(buyerB).toNumber();
    let buyerCBalanceAtTheEndOfSale = web3.eth.getBalance(buyerC).toNumber();
    let buyerDBalanceAtTheEndOfSale = web3.eth.getBalance(buyerD).toNumber();
    let beneficiaryBalanceAtTheEndOfSale = web3.eth
      .getBalance(beneficiary)
      .toNumber();

    await iico.finalize(1000);

    // Redeem and verify we can't redeem more than once.
    await iico.redeem(1);
    await expectThrow(iico.redeem(1));
    await iico.redeem(2);
    await expectThrow(iico.redeem(2));
    await iico.redeem(3);
    await expectThrow(iico.redeem(3));
    await iico.redeem(4);
    await expectThrow(iico.redeem(4));

    // Verify the proper amounts of ETH are refunded.
    assert.equal(
      web3.eth.getBalance(buyerA).toNumber(),
      buyerABalanceAtTheEndOfSale,
      "The buyer A has been given ETH back while the full bid should have been accepted"
    );
    assert.closeTo(
      web3.eth.getBalance(buyerB).toNumber(),
      buyerBBalanceAtTheEndOfSale + 4e18,
      0.01 * 1e18,
      "The buyer B has been given ETH back while the full bid should have been accepted"
    );
    assert.equal(
      web3.eth.getBalance(buyerC).toNumber(),
      buyerCBalanceAtTheEndOfSale,
      "The buyer C has been given ETH back while the full bid should have been accepted"
    );
    assert.equal(
      web3.eth.getBalance(buyerD).toNumber(),
      buyerDBalanceAtTheEndOfSale,
      "The buyer D has been given ETH back while the full bid should have been accepted"
    );

    assert.equal(
      web3.eth.getBalance(beneficiary).toNumber(),
      beneficiaryBalanceAtTheEndOfSale + 20e18,
      "The beneficiary has not been paid correctly"
    );

    // Alice: 6 ETH 20% bonus = 7.20
    // Bob:   6 ETH 18% bonus = 7.08
    // Carl:  4 ETH 12% bonus = 4.48
    // David: 4 ETH 8%  bonus = 4.32
    var totalContributed = 7.2 + 7.08 + 4.48 + 4.32; // 23.08

    // Verify that the tokens are correctly distributed.
    assert.closeTo(
      (await token.balanceOf(buyerA)).toNumber() / 1e18,
      (7.2 / totalContributed) * 100,
      0.2,
      "The buyer A has not been given the right amount of tokens"
    );
    assert.closeTo(
      (await token.balanceOf(buyerB)).toNumber() / 1e18,
      (7.08 / totalContributed) * 100,
      0.2,
      "The buyer B has not been given the right amount of tokens"
    );
    assert.closeTo(
      (await token.balanceOf(buyerC)).toNumber() / 1e18,
      (4.48 / totalContributed) * 100,
      0.2,
      "The buyer C has not been given the right amount of tokens"
    );
    assert.closeTo(
      (await token.balanceOf(buyerD)).toNumber() / 1e18,
      (4.32 / totalContributed) * 100,
      0.2,
      "The buyer D has not been given the right amount of tokens"
    );
  });
});
