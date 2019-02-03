/* eslint-disable no-undef */ // Avoid the linter considering truffle elements as undef.
const pify = require('pify')
const {
  shouldFail,
  time
} = require('openzeppelin-test-helpers/openzeppelin-test-helpers')

const MintableToken = artifacts.require(
  'openzeppelin-solidity/contracts/token/ERC20/ERC20Mintable.sol'
)
const ContinuousSale = artifacts.require('ContinuousSale')

const BN = web3.utils.BN // Alias
const toBN = web3.utils.toBN

contract('ContinuousSale', function(accounts) {
  const owner = accounts[0]
  const beneficiary = accounts[1]
  const buyerA = accounts[2]
  const buyerB = accounts[3]
  const buyerC = accounts[4]
  const buyerD = accounts[5]
  const buyerE = accounts[6]
  const buyerF = accounts[7]
  const GAS_PRICE = 1
  const tokensToMint = new BN('12').mul(new BN('10').pow(new BN('25')))
  const uint256Max = new BN('2').pow(new BN('256')).sub(new BN('1'))

  const numberOfSubsales = 365
  const secondsPerSubsale = 86400
  testAccount = buyerE

  const tokensPerSubsale = tokensToMint.div(new BN(numberOfSubsales))

  let START_TIME
  let cs

  beforeEach('initialize the contract', async function() {
    START_TIME = Math.floor(Date.now() / 1000) // Unix epoch now
    cs = await ContinuousSale.new(
      beneficiary,
      numberOfSubsales,
      secondsPerSubsale,
      START_TIME,
      {
        from: owner
      }
    )
  })

  // Constructor
  it('Should create the contract with the initial values', async () => {
    assert.equal(await cs.owner(), owner, 'The owner is not set correctly.')
    assert.equal(
      await cs.beneficiary(),
      beneficiary,
      'The beneficiary is not set correctly.'
    )

    assert.equal(
      await cs.numberOfSubsales(),
      numberOfSubsales,
      'Number of subsales is not set correctly.'
    )

    assert.equal(
      await cs.secondsPerSubsale(),
      secondsPerSubsale,
      'Duration per subsale is not set correctly.'
    )
  })

  // setToken
  it('Should set the token', async () => {
    const token = await MintableToken.new({ from: owner })
    await shouldFail.reverting(cs.setToken(token.address, { from: owner })) // Can't set the token if contracts balance is zero.
    await token.mint(cs.address, tokensToMint, {
      from: owner
    })
    await shouldFail.reverting(cs.setToken(token.address, { from: buyerA })) // Only owner can set.
    await cs.setToken(token.address, { from: owner })

    assert.equal(
      await cs.token(),
      token.address,
      'The token is not set correctly'
    )

    assert(
      (await cs.tokensForSale()).eq(tokensToMint),
      'The tokensForSale is not set correctly'
    )
  })

  // submitBidToOngoingSubsale
  it('Should submit only valid bids', async () => {
    const token = await MintableToken.new({ from: owner })
    await token.mint(cs.address, tokensToMint, { from: owner })
    await cs.setToken(token.address, { from: owner })

    const Valuation1 = new BN('10').pow(new BN('18'))
    const Valuation2 = new BN('10').pow(new BN('17'))
    const Valuation3 = new BN('10').pow(new BN('16'))

    await shouldFail.reverting(
      cs.submitBidToOngoingSubsale(
        Valuation1,
        Math.floor(Math.random() * 1000000000 + 1),
        {
          from: buyerA,
          value: 0.1e18
        }
      )
    ) // Should not work because the insertion position is incorrect

    const ongoingSaleNumber = await cs.getOngoingSubsaleNumber()
    const tailBidID = uint256Max.sub(ongoingSaleNumber)
    headBidID = ongoingSaleNumber
    await cs.submitBidToOngoingSubsale(Valuation1, tailBidID, {
      from: buyerA,
      value: 0.1e18
    }) // Bid 1.
    globalLastBidID = await cs.globalLastBidID()
    assert.equal(globalLastBidID, 366)
    await shouldFail.reverting(
      cs.submitBidToOngoingSubsale(Valuation2, tailBidID, {
        from: buyerB,
        value: 0.1e18
      })
    ) // Should not work because not inserted in the right position.

    await cs.submitBidToOngoingSubsale(Valuation2, globalLastBidID, {
      from: buyerB,
      value: 0.1e18
    }) // Bid 2.
    await cs.submitBidToOngoingSubsale(Valuation3, 367, {
      from: buyerC,
      value: 0.15e18
    }) // Bid 3.
    await shouldFail.reverting(
      cs.submitBidToOngoingSubsale(Valuation2, 367, {
        from: buyerB,
        value: 0.25e18
      })
    ) // Should not work because not inserted in the right position.
    await cs.submitBidToOngoingSubsale(Valuation2, 366, {
      from: buyerB,
      value: 0.25e18
    }) // Bid 4

    await cs.searchAndBidToOngoingSubsale(Valuation2, tailBidID, {
      from: buyerE,
      value: 0.1e18
    }) // Bid 5.

    await cs.sendTransaction({ from: buyerF, value: 0.3e18 }) // Bid 6.
  })

  it('Should finalize in single run', async () => {
    let tailBidID = uint256Max
    const token = await MintableToken.new({ from: owner })
    await token.mint(cs.address, tokensToMint, { from: owner })
    await cs.setToken(token.address, { from: owner })

    const Valuation1 = new BN('10').pow(new BN('18'))
    const Valuation2 = new BN('10').pow(new BN('17'))
    const Valuation3 = new BN('10').pow(new BN('16'))

    const ongoingSaleNumber = await cs.getOngoingSubsaleNumber()
    tailBidID = uint256Max.sub(ongoingSaleNumber)
    headBidID = ongoingSaleNumber

    await shouldFail.reverting(
      cs.submitBidToOngoingSubsale(
        Valuation1,
        Math.floor(Math.random() * 1000000000 + 1),
        {
          from: buyerA,
          value: 0.1e18
        }
      )
    ) // Should not work because the insertion position is incorrect
    await cs.submitBidToOngoingSubsale(Valuation1, tailBidID, {
      from: buyerA,
      value: 0.1e18
    }) // Bid 1.
    assert.equal(await cs.globalLastBidID(), 366)
    await shouldFail.reverting(
      cs.submitBidToOngoingSubsale(Valuation2, tailBidID, {
        from: buyerB,
        value: 0.1e17
      })
    ) // Should not work because not inserted in the right position.

    await cs.submitBidToOngoingSubsale(Valuation2, 366, {
      from: buyerB,
      value: 0.1e18
    }) // Bid 2.
    await cs.submitBidToOngoingSubsale(Valuation3, 367, {
      from: buyerC,
      value: 0.15e18
    }) // Bid 3.
    await shouldFail.reverting(
      cs.submitBidToOngoingSubsale(Valuation2, 2, {
        from: buyerB,
        value: 0.25e18
      })
    ) // Should not work because not inserted in the right position.
    await cs.submitBidToOngoingSubsale(Valuation2, 366, {
      from: buyerB,
      value: 0.25e18
    }) // Bid 4

    await cs.searchAndBidToOngoingSubsale(Valuation2, tailBidID, {
      from: buyerE,
      value: 0.1e17
    }) // Bid 5.

    assert.equal(await cs.finalized(1), false)
    await time.increase(secondsPerSubsale)
    await shouldFail.reverting(cs.finalize(uint256Max, 200, { from: buyerB }))
    await cs.finalize(30, 1)
    assert.equal(await cs.finalized(1), true)
  })

  it('Should finalize in multiple runs', async () => {
    assert.equal(await cs.finalized(0), false)

    const token = await MintableToken.new({ from: owner })
    await token.mint(cs.address, tokensToMint, { from: owner })
    await cs.setToken(token.address, { from: owner })

    const Valuation1 = new BN('10').pow(new BN('20'))
    const Valuation2 = new BN('10').pow(new BN('19'))
    const Valuation3 = new BN('10').pow(new BN('18'))

    const ongoingSaleNumber = await cs.getOngoingSubsaleNumber()
    tailBidID = uint256Max.sub(ongoingSaleNumber)

    await shouldFail.reverting(
      cs.submitBidToOngoingSubsale(
        Valuation1,
        Math.floor(Math.random() * 1000000000 + 1),
        {
          from: buyerA,
          value: 0.1e18
        }
      )
    ) // Should not work because the insertion position is incorrect
    await cs.submitBidToOngoingSubsale(Valuation1, tailBidID, {
      from: buyerA,
      value: 0.1e18
    }) // Bid 1.
    assert.equal(await cs.globalLastBidID(), 366)
    await shouldFail.reverting(
      cs.submitBidToOngoingSubsale(Valuation2, tailBidID, {
        from: buyerB,
        value: 0.1e18
      })
    ) // Should not work because not inserted in the right position.

    await cs.submitBidToOngoingSubsale(Valuation2, 366, {
      from: buyerB,
      value: 0.1e18
    }) // Bid 2.
    await cs.submitBidToOngoingSubsale(Valuation3, 367, {
      from: buyerC,
      value: 0.15e18
    }) // Bid 3.
    await shouldFail.reverting(
      cs.submitBidToOngoingSubsale(Valuation2, 367, {
        from: buyerB,
        value: 0.25e18
      })
    ) // Should not work because not inserted in the right position.
    await cs.submitBidToOngoingSubsale(Valuation2, 366, {
      from: buyerB,
      value: 0.25e18
    }) // Bid 4

    await cs.searchAndBidToOngoingSubsale(Valuation2, tailBidID, {
      from: buyerE,
      value: 0.1e18
    }) // Bid 5.

    await time.increase(secondsPerSubsale)

    assert.equal(await cs.finalized(ongoingSaleNumber), false)
    await cs.finalize(2, ongoingSaleNumber, { from: buyerB })
    assert.equal(await cs.finalized(ongoingSaleNumber), false)
    await cs.finalize(2, ongoingSaleNumber, { from: buyerC })
    await cs.finalize(30, ongoingSaleNumber, { from: buyerA })
    assert.equal(await cs.finalized(ongoingSaleNumber), true)
  })

  it('Should redeem', async function() {
    const token = await MintableToken.new({ from: owner })
    await token.mint(cs.address, tokensToMint, { from: owner })
    await cs.setToken(token.address, { from: owner })

    const Valuation1 = new BN('10').pow(new BN('20'))
    const Valuation2 = new BN('10').pow(new BN('19'))
    const Valuation3 = new BN('10').pow(new BN('18'))
    const ValuationTooLow = new BN('10').pow(new BN('14'))

    const ongoingSaleNumber = await cs.getOngoingSubsaleNumber()
    tailBidID = uint256Max.sub(ongoingSaleNumber)

    await cs.submitBidToOngoingSubsale(Valuation1, tailBidID, {
      from: buyerA,
      value: 0.1e18
    }) // Bid 1.
    await cs.submitBidToOngoingSubsale(Valuation2, 366, {
      from: buyerB,
      value: 0.1e18
    }) // Bid 2.
    await cs.submitBidToOngoingSubsale(Valuation3, 367, {
      from: buyerC,
      value: 0.2e18
    }) // Bid 3.
    await cs.searchAndBidToOngoingSubsale(Valuation2, ongoingSaleNumber, {
      from: buyerD,
      value: 0.2e18
    }) // Bid 4
    await cs.searchAndBidToOngoingSubsale(Valuation2, tailBidID, {
      from: buyerE,
      value: 0.1e18
    }) // Bid 5.

    await cs.searchAndBidToOngoingSubsale(ValuationTooLow, tailBidID, {
      from: buyerF,
      value: 0.1e18
    }) // Bid 6.

    const latestSubsaleNumber = (await cs.getOngoingSubsaleNumber()).toString()
    await time.increase(secondsPerSubsale)

    const buyerABalanceBeforeRedeem = await web3.eth.getBalance(buyerA)
    const buyerBBalanceBeforeRedeem = await web3.eth.getBalance(buyerB)
    const buyerCBalanceBeforeRedeem = await web3.eth.getBalance(buyerC)
    const buyerDBalanceBeforeRedeem = await web3.eth.getBalance(buyerD)
    const buyerEBalanceBeforeRedeem = await web3.eth.getBalance(buyerE)
    const buyerFBalanceBeforeRedeem = await web3.eth.getBalance(buyerF)
    const beneficiaryBalanceBeforeRedeem = await web3.eth.getBalance(
      beneficiary
    )

    let finalizationCounter = 1
    for (let i = 1; i <= latestSubsaleNumber; i++)
      await cs.finalize(uint256Max, finalizationCounter++, { from: owner })

    for (let i = 366; i < 371; i++) {
      await cs.redeem(i, { from: owner })
      await shouldFail.reverting(cs.redeem(i, { from: owner })) // Duplicate redeem calls should fail.
    }

    const redeemTxUsingFallback = await cs.sendTransaction({
      from: buyerF,
      gasPrice: GAS_PRICE,
      value: 0
    }) // Redeem using fallback

    // Verify the proper amounts of ETH are refunded.
    assert.equal(
      await web3.eth.getBalance(buyerA),
      buyerABalanceBeforeRedeem,
      'The buyer A has been given ETH back while the full bid should have been accepted'
    )
    assert.equal(
      await web3.eth.getBalance(buyerB),
      buyerBBalanceBeforeRedeem,
      'The buyer B has been given ETH back while the full bid should have been accepted'
    )
    assert.equal(
      await web3.eth.getBalance(buyerC),
      buyerCBalanceBeforeRedeem,
      'The buyer C has been given ETH back while the full bid should have been accepted'
    )
    assert.equal(
      await web3.eth.getBalance(buyerD),
      buyerDBalanceBeforeRedeem,
      'The buyer D has been given ETH back while the full bid should have been accepted'
    )
    assert.equal(
      await web3.eth.getBalance(buyerE),
      buyerEBalanceBeforeRedeem,
      'The buyer E has been given ETH back while the full bid should have been accepted'
    )

    assert(
      toBN(await web3.eth.getBalance(buyerF)).eq(
        new BN(buyerFBalanceBeforeRedeem).add(
          new BN('10')
            .pow(new BN('17'))
            .sub(
              new BN(redeemTxUsingFallback.receipt.gasUsed).mul(
                new BN(GAS_PRICE)
              )
            )
        )
      ),
      'The buyer F has not been reimbursed as it should'
    )

    const balance = web3.utils.toBN(await web3.eth.getBalance(beneficiary))
    const difference = new BN('7').mul(new BN('10').pow(new BN('17')))

    assert(
      balance.eq(
        web3.utils.toBN(beneficiaryBalanceBeforeRedeem).add(difference)
      ),
      'The beneficiary has not been paid correctly'
    )

    assert(
      toBN(await token.balanceOf(buyerA)).eq(tokensPerSubsale.div(new BN('7'))),
      'The buyer A has not been given the right amount of tokens'
    )

    assert(
      toBN(await token.balanceOf(buyerB)).eq(
        tokensPerSubsale.div(new BN('7')).mul(new BN('1'))
      ),
      'The buyer B has not been given the right amount of tokens'
    )

    assert(
      toBN(await token.balanceOf(buyerC)).eq(
        tokensPerSubsale.div(new BN('7')).mul(new BN('2'))
      ),
      'The buyer C has not been given the right amount of tokens'
    )

    assert(
      toBN(await token.balanceOf(buyerD)).eq(
        tokensPerSubsale.div(new BN('7')).mul(new BN('2'))
      ),
      'The buyer D has not been given the right amount of tokens'
    )

    assert(
      toBN(await token.balanceOf(buyerE)).eq(tokensPerSubsale.div(new BN('7'))),
      'The buyer E has not been given the right amount of tokens'
    )

    assert(
      toBN(await token.balanceOf(buyerF)).eq(new BN('0')),
      'The buyer F has been given tokens while the bid should not be accepted.'
    )
  })

  it('Should correctly show current valuation and cut off', async function() {
    const tailID = uint256Max
    const token = await MintableToken.new({ from: owner })
    await token.mint(cs.address, tokensToMint, { from: owner })
    await cs.setToken(token.address, { from: owner })

    const Valuation1 = new BN('10').pow(new BN('18'))
    const Valuation2 = new BN('10').pow(new BN('18'))
    const Valuation4 = new BN('10').pow(new BN('18')).div(new BN('2'))

    await cs.searchAndBidToOngoingSubsale(Valuation1, tailID, {
      from: buyerA,
      value: 0.1e18
    }) // Bid 1.
    await cs.searchAndBidToOngoingSubsale(Valuation2, tailID, {
      from: buyerB,
      value: 0.1e18
    }) // Bid 2.
    await cs.searchAndBidToOngoingSubsale(Valuation4, tailID, {
      from: buyerC,
      value: 0.2e18
    }) // Bid 3.
    await cs.searchAndBidToOngoingSubsale(Valuation2, tailID, {
      from: buyerD,
      value: 0.15e18
    }) // Bid 4
    await cs.searchAndBidToOngoingSubsale(Valuation2, tailID, {
      from: buyerE,
      value: 0.1e18
    }) // Bid 5.
    await cs.searchAndBidToOngoingSubsale(Valuation4, tailID, {
      from: buyerF,
      value: 0.1e18
    }) // Bid 6.

    const ongoingSaleNumber = await cs.getOngoingSubsaleNumber()

    const {
      currentCutOffBidContrib,
      currentCutOffBidID,
      currentCutOffBidMaxValuation,
      valuation
    } = await cs.valuationAndCutOff(ongoingSaleNumber)

    assert(valuation.eq(new BN('10').pow(new BN('17')).mul(new BN('5'))))
    assert.equal(currentCutOffBidID, 371) // Last bid.
    assert(
      currentCutOffBidMaxValuation.eq(
        new BN('10').pow(new BN('17')).mul(new BN('5'))
      )
    )
    assert(
      currentCutOffBidContrib.eq(
        new BN('10').pow(new BN('16')).mul(new BN('5'))
      )
    )
  })

  it('Should correctly finalize a multiple subsale case and show total conribution correctly', async function() {
    const tailID = uint256Max
    const token = await MintableToken.new({ from: owner })
    await token.mint(cs.address, tokensToMint, { from: owner })
    await cs.setToken(token.address, { from: owner })

    const Valuation1 = new BN('10').pow(new BN('18'))
    const Valuation2 = new BN('10').pow(new BN('18'))
    const Valuation4 = new BN('10').pow(new BN('18')).div(new BN('2'))

    await cs.searchAndBidToOngoingSubsale(Valuation1, tailID, {
      from: buyerA,
      value: 0.1e18
    }) // Bid 1.
    await cs.searchAndBidToOngoingSubsale(Valuation2, tailID, {
      from: buyerB,
      value: 0.1e18
    }) // Bid 2.
    await cs.searchAndBidToOngoingSubsale(Valuation1, tailID, {
      from: buyerC,
      value: 0.2e18
    }) // Bid 3.
    await cs.searchAndBidToOngoingSubsale(Valuation2, tailID, {
      from: buyerD,
      value: 0.15e18
    }) // Bid 4
    await cs.searchAndBidToOngoingSubsale(Valuation2, tailID, {
      from: buyerE,
      value: 0.1e18
    }) // Bid 5.
    await cs.searchAndBidToOngoingSubsale(Valuation4, tailID, {
      from: buyerF,
      value: 0.1e18
    }) // Bid 6.

    await time.increase(secondsPerSubsale)

    await cs.searchAndBidToOngoingSubsale(Valuation1, tailID, {
      from: buyerA,
      value: 0.1e18
    }) // Bid 1.
    await cs.searchAndBidToOngoingSubsale(Valuation2, tailID, {
      from: buyerB,
      value: 0.1e18
    }) // Bid 2.
    await cs.searchAndBidToOngoingSubsale(Valuation1, tailID, {
      from: buyerC,
      value: 0.2e18
    }) // Bid 3.
    await cs.searchAndBidToOngoingSubsale(Valuation2, tailID, {
      from: buyerD,
      value: 0.15e18
    }) // Bid 4
    await cs.searchAndBidToOngoingSubsale(Valuation2, tailID, {
      from: buyerE,
      value: 0.1e18
    }) // Bid 5.
    await cs.searchAndBidToOngoingSubsale(Valuation4, tailID, {
      from: buyerF,
      value: 0.1e18
    }) // Bid 6.

    await time.increase(secondsPerSubsale)

    await cs.searchAndBidToOngoingSubsale(Valuation1, tailID, {
      from: buyerA,
      value: 0.1e18
    }) // Bid 1.
    await cs.searchAndBidToOngoingSubsale(Valuation2, tailID, {
      from: buyerB,
      value: 0.1e18
    }) // Bid 2.
    await cs.searchAndBidToOngoingSubsale(Valuation1, tailID, {
      from: buyerC,
      value: 0.1e18
    }) // Bid 3.
    await cs.searchAndBidToOngoingSubsale(Valuation2, tailID, {
      from: buyerD,
      value: 0.1e18
    }) // Bid 4
    await cs.searchAndBidToOngoingSubsale(Valuation2, tailID, {
      from: buyerE,
      value: 0.1e18
    }) // Bid 5.
    await cs.searchAndBidToOngoingSubsale(Valuation4, tailID, {
      from: buyerF,
      value: 0.1e18
    }) // Bid 6.

    await time.increase(secondsPerSubsale)
    await cs.finalize(uint256Max, 1) // Finalize day 1.
    await cs.finalize(uint256Max, 2) // Finalize day 2.

    assert(
      (await cs.totalContrib(buyerE)).eq(
        new BN('10').pow(new BN('17')).mul(new BN('3'))
      )
    )
    await cs.searchAndBidToOngoingSubsale(Valuation2, tailID, {
      from: buyerE,
      value: 0.2e18
    })
    assert(
      (await cs.totalContrib(buyerE)).eq(
        new BN('10').pow(new BN('17')).mul(new BN('5'))
      )
    )
  })

  it('Should correctly finalize an empty subsale', async function() {
    const ongoingSaleNumber = await cs.getOngoingSubsaleNumber()
    const token = await MintableToken.new({ from: owner })
    await token.mint(cs.address, tokensToMint, { from: owner })
    await cs.setToken(token.address, { from: owner })

    await time.increase(secondsPerSubsale)

    await cs.finalize(uint256Max, ongoingSaleNumber)
    assert.equal(await cs.finalized(ongoingSaleNumber), true)
  })

  it('Should correctly finalize a subsale with only one bid and redeem it', async function() {
    const ongoingSaleNumber = await cs.getOngoingSubsaleNumber()
    const token = await MintableToken.new({ from: owner })
    await token.mint(cs.address, tokensToMint, { from: owner })
    await cs.setToken(token.address, { from: owner })
    const Valuation1 = new BN('10').pow(new BN('18'))

    await cs.searchAndBidToOngoingSubsale(Valuation1, uint256Max, {
      from: buyerA,
      value: 0.1e18
    }) // Bid 1.

    const bidID = await cs.globalLastBidID()
    await time.increase(secondsPerSubsale)

    await cs.finalize(uint256Max, ongoingSaleNumber)
    assert.equal(await cs.finalized(ongoingSaleNumber), true)
    await cs.redeem(bidID)
    assert.equal((await cs.bids(bidID))[5], true) // Assert redeemed
    assert((await token.balanceOf(buyerA)).eq(tokensPerSubsale)) // Assert all tokens are redeemed to this account as there is no other bid.
  })

  // after('revert evm to first snapshot', async function() {
  //   await pify(web3.currentProvider.send)({
  //     jsonrpc: '2.0',
  //     method: 'evm_revert',
  //     params: 1
  //   })
  // })
})
