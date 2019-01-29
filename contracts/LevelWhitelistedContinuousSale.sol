/* THIS IS A WORK IN PROGRESS, DO NOT TRUST THIS CONTRACT! */

/**
 *  @authors: [@ferittuncer]
 *  @reviewers: []
 *  @auditors: []
 *  @bounties: []
 *  @deployments: []
 */

pragma solidity ^0.5.3;

import "./ContinuousSale.sol";

/** @title Level Whitelisted Continuous Sale Contract
 *  This contract implements a continuous sale with two whitelist: The base one with limited contribution and the reinforced one with unlimited contribution.
 *  There are multiple subsales.
 *  Each subsale is maintained by a sorted doubly-linked-list with HEAD and TAIL artifical bids (to avoid null checks).
 *  All the doubly-linked-lists are maintained in a single mapping.
 *  There is no bonus period and no widthdrawal period. Bids can either get accepted and redeemed or get refused and reimbursed.
 *  Bids should be submitted to correct spot into the respective linked-list, otherwise will be reverted.
 *  Search function can help locating correct insertion spot.
 *  Providing a better first guess to search function reduces the amount of iteration needed for searching correct spot.
 *  Bidder can use searchAndBid and searchAndBidToOngoingSubsale functions to bid without proving the correct spot, with a gas cost for search function.
 *  To avoid searching costs, first, call search function and obtain correct spot, then submitBid using the correct spot.
 */
contract LevelWhitelistedContinuousSale is ContinuousSale {
    uint public maximumBaseContribution;
    mapping (address => bool) public baseWhitelist; // True if in the base whitelist (has a contribution limit).
    mapping (address => bool) public reinforcedWhitelist; // True if in the reinforced whitelist (does not have a contribution limit).
    address public whitelister; // The party which can add or remove people from the whitelist.

    modifier onlyWhitelister{ require(whitelister == msg.sender, "Only the whitelister is authorized to execute this."); _; }

    /** @dev Constructor. First contract set up (tokens will also need to be transferred to the contract
     *  and then setToken needs to be called to finish the setup).
     *  @param _beneficiary Beneficiary of the raised funds.
     *  @param _numberOfSubsales Number of subsales.
     *  @param _secondsPerSubsale Duration per subsale in seconds.
     *  @param _startTime Start time of the sale.
     *  @param _maximumBaseContribution The maximum contribution for buyers on the base list.
     */
    constructor (address payable _beneficiary, uint _numberOfSubsales, uint _secondsPerSubsale, uint _startTime, uint _maximumBaseContribution) ContinuousSale (_beneficiary, _numberOfSubsales, _secondsPerSubsale, _startTime) public {
        maximumBaseContribution = _maximumBaseContribution;
    }

    /** @dev Submit a bid. The caller must give the exact position the bid must be inserted into in the list.
     *  In practice, use searchAndBid to avoid the position being incorrect due to a new bid being inserted and changing the position the bid must be inserted at.
     *  @param _subsaleNumber Target subsale of the bid.
     *  @param _maxValuation The maximum valuation given by the contributor. If the amount raised is higher, the bid is cancelled and the contributor refunded because it prefers a refund instead of this level of dilution. To buy no matter what, use INFINITY.
     *  @param _next The bidID of the next bid in the list.
     */
    function submitBid(uint _subsaleNumber, uint _maxValuation, uint _next) public payable {
        require(reinforcedWhitelist[msg.sender] || (baseWhitelist[msg.sender] && (msg.value + totalContrib(msg.sender) <= maximumBaseContribution)), "Buyer is not authorized to contribute this amount. Try contributing less."); // Check if the buyer is in the reinforced whitelist or if it is on the base one and this would not make its total contribution exceed the limit.
        super.submitBid(_subsaleNumber, _maxValuation, _next);
    }

    /** @dev Set the whitelister.
     *  @param _whitelister The whitelister.
     */
    function setWhitelister(address _whitelister) public onlyOwner {
        whitelister=_whitelister;
    }

    /** @dev Add buyers to the base whitelist.
     *  @param _buyersToWhitelist Buyers to add to the whitelist.
     */
    function addBaseWhitelist(address[] memory _buyersToWhitelist) public onlyWhitelister {
        for(uint i=0;i<_buyersToWhitelist.length;++i)
            baseWhitelist[_buyersToWhitelist[i]]=true;
    }

    /** @dev Add buyers to the reinforced whitelist.
     *  @param _buyersToWhitelist Buyers to add to the whitelist.
     */
    function addReinforcedWhitelist(address[] memory _buyersToWhitelist) public onlyWhitelister {
        for(uint i=0;i<_buyersToWhitelist.length;++i)
            reinforcedWhitelist[_buyersToWhitelist[i]]=true;
    }

    /** @dev Remove buyers from the base whitelist.
     *  @param _buyersToRemove Buyers to remove from the whitelist.
     */
    function removeBaseWhitelist(address[] memory _buyersToRemove) public onlyWhitelister {
        for(uint i=0;i<_buyersToRemove.length;++i)
            baseWhitelist[_buyersToRemove[i]]=false;
    }

    /** @dev Remove buyers from the reinforced whitelist.
     *  @param _buyersToRemove Buyers to remove from the whitelist.
     */
    function removeReinforcedWhitelist(address[] memory _buyersToRemove) public onlyWhitelister {
        for(uint i=0;i<_buyersToRemove.length;++i)
            reinforcedWhitelist[_buyersToRemove[i]]=false;
    }
}
