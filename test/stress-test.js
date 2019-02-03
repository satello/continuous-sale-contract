/* eslint-disable no-undef */ // Avoid the linter considering truffle elements as undef.
const { time } = require('openzeppelin-test-helpers/openzeppelin-test-helpers')

const BN = web3.utils.BN

const MintableToken = artifacts.require(
  'openzeppelin-solidity/contracts/token/ERC20/ERC20Mintable.sol'
)
const LWCS = artifacts.require('LevelWhitelistedContinuousSale.sol')

function getRandomInt(max) {
  return Math.floor(Math.random() * Math.floor(max))
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

contract('LevelWhitelistedContinuousSale', function(accounts) {
  assert(
    accounts.length >= 100,
    'You need at least 100 accounts to run this test. You can use -a parameter of ganache-cli to change number of accounts.'
  )
  const owner = accounts[0]
  const beneficiary = accounts[1]

  const tokenForSale = new BN('12').mul(new BN('10').pow(new BN('7')))

  const maximumBaseContribution = new BN('5').mul(
    new BN('10').pow(new BN('18'))
  )

  const TIME_BEFORE_START = 1000
  const NUMBER_OF_SUBSALES = 365
  const SECONDS_PER_SUBSALE = 86400
  const TOO_MANY_BIDS = 5000

  it('Should gracefully handle 100 bidders and 5000 bids', async function() {
    this.timeout(6000000) // Test takes too long to load, need increase default timeout: https://stackoverflow.com/a/35398816/775359

    const startTestTime = (await web3.eth.getBlock('latest')).timestamp
    const lwcs = await LWCS.new(
      beneficiary,
      NUMBER_OF_SUBSALES,
      SECONDS_PER_SUBSALE,
      startTestTime + TIME_BEFORE_START,
      maximumBaseContribution,
      { from: owner }
    )
    const token = await MintableToken.new({ from: owner })
    await token.mint(lwcs.address, tokenForSale, {
      from: owner
    })
    await lwcs.setToken(token.address, { from: owner })
    await lwcs.setWhitelister(owner, { from: owner })

    time.increase(1000)

    let totalValueContributed = new BN('0')
    await lwcs.addReinforcedWhitelist(accounts.slice(2, 100), {
      from: owner
    })

    let value
    let bidder
    const bidTable = []
    for (let i = 0; i < 100; i++) bidTable[accounts[i]] = new BN('0')

    for (var i = 0; i < TOO_MANY_BIDS; i++) {
      value = new BN('10').pow(new BN('18')) // .mul(toBN(getRandomInt(10) + 1))
      bidder = accounts[getRandomInt(98) + 2]
      assert(value.gt(new BN('0')), "Bid value can't be zero")

      bidTable[bidder].iadd(value)

      totalValueContributed = totalValueContributed.add(value)

      tx = await lwcs.searchAndBid(
        getRandomInt(NUMBER_OF_SUBSALES) + 1,
        new BN(getRandomInt(100) + 100).mul(new BN('10').pow(new BN('18'))),
        0,
        {
          from: bidder,
          value: value
        }
      )
      time.increase(1)

      /// ////////////// OPTIONAL LOGGING
      if (i % 50 === 0)
        console.log(
          `${i} bids submitted so far and ${
            tx.receipt.gasUsed
          } gas used for submitting the last bid.`
        )
    }

    time.increase(NUMBER_OF_SUBSALES * SECONDS_PER_SUBSALE) // End of sale.

    const beneficiaryBalanceAtTheEndOfSale = await web3.eth.getBalance(
      beneficiary
    )

    console.log('Finalizing all subsales...')
    for (let i = 1; i <= NUMBER_OF_SUBSALES; i++)
      try {
        await lwcs.finalize(TOO_MANY_BIDS + 2, i)
      } catch (_) {
        console.log(i)
      }

    const beneficiaryBalanceAfterFinalising = await web3.eth.getBalance(
      beneficiary
    )

    let failedRedeemCount = 0
    const failedBids = []
    for (
      let i = NUMBER_OF_SUBSALES + 1;
      i < TOO_MANY_BIDS + NUMBER_OF_SUBSALES + 1;
      i++
    ) {
      time.advanceBlock() // Without this redeem has a chance to fail.
      console.log(`Redeeming ${i}`)
      try {
        await lwcs.redeem(i, { from: owner })
      } catch (_) {
        const bid = await lwcs.bids(i)
        failedRedeemCount++
        failedBids.push(i)
        console.log(bid)
        console.log(await lwcs.valuationAndCutOff(bid.subsaleNumber))
      }
    }
    if (failedRedeemCount > 0)
      console.log(
        `Failed to redeem ${failedRedeemCount} bids over ${TOO_MANY_BIDS} bids, in first try.`
      )
    time.advanceBlock()

    let retry = 2
    for (let i = 0; i < failedBids.length; )
      if (retry > 0)
        try {
          console.log(`Trying to redeem ${failedBids[i]}`)
          await lwcs.redeem(failedBids[i])
          i++
        } catch (err) {
          console.log(err.message)
          await time.advanceBlock()
          await sleep(1000)
          retry--

          const subsaleNumber = (await lwcs.bids(i))[6]
          console.log(await lwcs.finalized(subsaleNumber))
        }
      else {
        i++
        retry = 2
      }

    const beneficiaryBalanceAfterRedeeming = await web3.eth.getBalance(
      beneficiary
    )

    assert(
      new BN(beneficiaryBalanceAfterFinalising.toString()).eq(
        new BN(beneficiaryBalanceAfterRedeeming.toString())
      ),
      'There is a difference in beneficiary balance between finalization and redeem.'
    )

    let expectedTotal = new BN(beneficiaryBalanceAtTheEndOfSale.toString())
    for (let i = 2; i < 100; i++)
      expectedTotal = expectedTotal.add(bidTable[accounts[i]])

    assert(
      expectedTotal.eq(new BN(beneficiaryBalanceAfterRedeeming.toString())),
      'Beneficiary balance is unexpected.'
    )
  })
})
