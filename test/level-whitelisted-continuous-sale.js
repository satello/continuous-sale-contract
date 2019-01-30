/* eslint-disable no-undef */ // Avoid the linter considering truffle elements as undef.
const LWCS = artifacts.require('LevelWhitelistedContinuousSale.sol')

const {
  shouldFail,
  time
} = require('openzeppelin-test-helpers/openzeppelin-test-helpers')

const BN = web3.utils.BN // Alias

contract('Level Whitelisted Continuous Sale', function(accounts) {
  const owner = accounts[0]
  const beneficiary = accounts[1]
  const buyerA = accounts[2]
  const buyerB = accounts[3]
  const buyerC = accounts[4]
  const whitelister = accounts[5]
  const whitelister2 = accounts[6]

  const timeBeforeStart = 1000
  const maximumBaseContribution = new BN('5').mul(
    new BN('10').pow(new BN('18'))
  )
  const NUMBER_OF_SUBSALES = 365
  const SECONDS_PER_SUBSALE = 86400

  let startTestTime
  let lwcs

  beforeEach('initialize the contract', async function() {
    startTestTime = (await web3.eth.getBlock('latest')).timestamp
    lwcs = await LWCS.new(
      beneficiary,
      NUMBER_OF_SUBSALES,
      SECONDS_PER_SUBSALE,
      startTestTime + timeBeforeStart,
      maximumBaseContribution,
      { from: owner }
    )

    time.increase(1010)
  })

  // Constructor
  it('Should create the contract with the initial values', async () => {
    assert(
      (await lwcs.maximumBaseContribution()).eq(maximumBaseContribution),
      'Maximum base contribution not set correctly'
    )
    assert.equal(
      await lwcs.whitelister.call(),
      0,
      'Whitelister should not be set initially'
    )
  })

  it('Should be able to set and change whitelister (only owner)', async () => {
    await lwcs.setWhitelister(whitelister, { from: owner })
    assert.equal(
      await lwcs.whitelister.call(),
      whitelister,
      'Whitelister is not set'
    )

    await lwcs.setWhitelister(whitelister2, { from: owner })
    assert.equal(
      await lwcs.whitelister.call(),
      whitelister2,
      'Whitelister is not changed'
    )
  })

  it('Should not be able to set whitelister (anyone else)', async () => {
    await shouldFail.reverting(
      lwcs.setWhitelister(whitelister, { from: buyerA })
    )
  })

  it('Should not be able to add to whitelist (anyone else)', async () => {
    await lwcs.setWhitelister(whitelister, { from: owner })
    await shouldFail.reverting(
      lwcs.addBaseWhitelist([buyerA], { from: buyerA })
    )
  })

  it('Should be forbidden to send ETH without whitelist', async () => {
    await shouldFail.reverting(
      lwcs.searchAndBidToOngoingSubsale(new BN('10').pow(new BN('18')), 0, {
        from: buyerA,
        value: 0.1e18
      })
    )
  })

  it('Should be possible to send ETH after whitelisting', async () => {
    await lwcs.setWhitelister(whitelister, { from: owner })
    await lwcs.addBaseWhitelist([buyerA], { from: whitelister })

    lwcs.searchAndBidToOngoingSubsale(new BN('10').pow(new BN('18')), 0, {
      from: buyerA,
      value: 0.1e18
    })
    var bid = await lwcs.bids(await lwcs.globalLastBidID())
    assert.equal(bid[4], buyerA, 'Bid is not properly saved')
  })

  it('Should not be possible to send too much ETH after whitelisting', async () => {
    await lwcs.setWhitelister(whitelister, { from: owner })
    await lwcs.addBaseWhitelist([buyerA], { from: whitelister })

    await shouldFail.reverting(
      lwcs.searchAndBidToOngoingSubsale(new BN('10').pow(new BN('18')), 0, {
        from: buyerA,
        value: maximumBaseContribution.add(new BN('1'))
      })
    )
  })

  it('Should not be possible to send too much ETH after whitelisting in multiple goes', async () => {
    await lwcs.setWhitelister(whitelister, { from: owner })
    await lwcs.addBaseWhitelist([buyerA], { from: whitelister })

    lwcs.searchAndBidToOngoingSubsale(new BN('10').pow(new BN('18')), 0, {
      from: buyerA,
      value: 1e18
    })

    await shouldFail.reverting(
      lwcs.searchAndBidToOngoingSubsale(new BN('10').pow(new BN('18')), 0, {
        from: buyerA,
        value: 4.5e18
      })
    )
  })

  it('Should not be possible to send ETH after removing from whitelist', async () => {
    await lwcs.setWhitelister(whitelister, { from: owner })
    await lwcs.addBaseWhitelist([buyerA], { from: whitelister })

    lwcs.searchAndBidToOngoingSubsale(new BN('10').pow(new BN('18')), 0, {
      from: buyerA,
      value: 1e18
    })

    await lwcs.removeBaseWhitelist([buyerA], { from: whitelister })

    await shouldFail.reverting(
      lwcs.searchAndBidToOngoingSubsale(new BN('10').pow(new BN('18')), 0, {
        from: buyerA,
        value: 1e18
      })
    )
  })

  it('Should be possible to add and remove multiple users at once to base whitelist', async () => {
    await lwcs.setWhitelister(whitelister, { from: owner })
    await lwcs.addBaseWhitelist([buyerA, buyerB], { from: whitelister })

    lwcs.searchAndBidToOngoingSubsale(new BN('10').pow(new BN('18')), 0, {
      from: buyerA,
      value: 0.1e18
    })
    lwcs.searchAndBidToOngoingSubsale(new BN('10').pow(new BN('18')), 0, {
      from: buyerB,
      value: 0.2e18
    })
    var bidA = await lwcs.bids.call(
      (await lwcs.globalLastBidID()).sub(new BN('1'))
    )
    var bidB = await lwcs.bids.call(await lwcs.globalLastBidID())

    assert.equal(bidA[4], buyerA, 'Bid of buyerA is not properly saved')
    assert.equal(bidB[4], buyerB, 'Bid of buyerB is not properly saved')

    await lwcs.removeBaseWhitelist([buyerA, buyerB], { from: whitelister })

    await shouldFail.reverting(
      lwcs.searchAndBidToOngoingSubsale(new BN('10').pow(new BN('18')), 0, {
        from: buyerA,
        value: 0.1e18
      })
    )
    await shouldFail.reverting(
      lwcs.searchAndBidToOngoingSubsale(new BN('10').pow(new BN('18')), 0, {
        from: buyerB,
        value: 0.2e18
      })
    )
  })

  it('Should be able to add to reinforced (only whitelister)', async () => {
    await lwcs.setWhitelister(whitelister, { from: owner })
    await lwcs.addReinforcedWhitelist([buyerA], { from: whitelister })
  })

  it('Should not be able to add to reinforced (anyone else)', async () => {
    await lwcs.setWhitelister(whitelister, { from: owner })
    await shouldFail.reverting(
      lwcs.addReinforcedWhitelist([buyerA], { from: buyerA })
    )
  })

  it('Should be possible to send a lot ETH after reinforced whitelisting', async () => {
    await lwcs.setWhitelister(whitelister, { from: owner })
    await lwcs.addReinforcedWhitelist([buyerC], { from: whitelister })

    lwcs.searchAndBidToOngoingSubsale(new BN('10').pow(new BN('18')), 0, {
      from: buyerC,
      value: maximumBaseContribution.mul(new BN('10'))
    })
  })

  it('Should be possible to send some ETH first and more after reinforced whitelisting', async () => {
    await lwcs.setWhitelister(whitelister, { from: owner })
    await lwcs.addBaseWhitelist([buyerA], { from: whitelister })

    lwcs.searchAndBidToOngoingSubsale(new BN('10').pow(new BN('18')), 0, {
      from: buyerA,
      value: 1e18
    })

    await lwcs.addReinforcedWhitelist([buyerA], { from: whitelister })

    lwcs.searchAndBidToOngoingSubsale(new BN('10').pow(new BN('18')), 0, {
      from: buyerA,
      value: 6e18
    })

    const buyerAContrib = await lwcs.totalContrib.call(buyerA)

    assert.equal(buyerAContrib, 7e18)
  })

  it('Should be possible to add and remove multiple users at once to reinforced whitelist', async () => {
    await lwcs.setWhitelister(whitelister, { from: owner })
    await lwcs.addReinforcedWhitelist([buyerA, buyerB], { from: whitelister })

    lwcs.searchAndBidToOngoingSubsale(new BN('10').pow(new BN('18')), 0, {
      from: buyerA,
      value: 6e18
    })
    lwcs.searchAndBidToOngoingSubsale(new BN('10').pow(new BN('18')), 0, {
      from: buyerB,
      value: 7e18
    })
    var bidA = await lwcs.bids.call(
      (await lwcs.globalLastBidID()).sub(new BN('1'))
    )
    var bidB = await lwcs.bids.call(await lwcs.globalLastBidID())

    assert.equal(bidA[4], buyerA, 'Bid of buyerA is not properly saved')
    assert.equal(bidB[4], buyerB, 'Bid of buyerB is not properly saved')

    await lwcs.removeReinforcedWhitelist([buyerA, buyerB], {
      from: whitelister
    })

    await shouldFail.reverting(
      lwcs.searchAndBidToOngoingSubsale(new BN('10').pow(new BN('18')), 0, {
        from: buyerA,
        value: 0.1e18
      })
    )
    await shouldFail.reverting(
      lwcs.searchAndBidToOngoingSubsale(new BN('10').pow(new BN('18')), 0, {
        from: buyerB,
        value: 0.2e18
      })
    )
  })
})
