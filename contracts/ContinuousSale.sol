/* THIS IS A WORK IN PROGRESS, DO NOT TRUST THIS CONTRACT! */

/**
 *  @authors: [@ferittuncer]
 *  @reviewers: []
 *  @auditors: []
 *  @bounties: []
 *  @deployments: []
 */

pragma solidity ^0.5.3;

import "openzeppelin-solidity/contracts/token/ERC20/ERC20.sol";

/** @title Continuous Interactive Initial Coin Offering Contract
 *  This contract implements the Interactive Coin Offering token sale as described in this paper:
 *  https://people.cs.uchicago.edu/~teutsch/papers/ico.pdf
 *  Implementation details and modifications compared to the paper:
 *  - A fixed amount of tokens is sold.
 *  - The valuation pointer is only moved when the sale is over. This greatly reduces the amount of write operations and code complexity. However, at least one party must make one or multiple calls to finalize the sale.
 *  - Buckets are not used as they are not required and increase code complexity.
 *  - The bid submitter must provide the insertion spot. A search of the insertion spot is still done in the contract just in case the one provided was wrong or other bids were added between when the TX got signed and executed, but giving the search starting point greatly lowers gas consumption.
 *  - Calling the fallback function while sending ETH places a bid with an infinite maximum valuation. This allows buyers who want to buy no matter the price not need to use a specific interface and just send ETH. Without ETH, a call to the fallback function redeems the bids of the caller.
 *  - The main sale has many subsales which is in-effect similar to running multiple interactive initial coin offerings consecutively.
 *  - Subsales are maintained in different linked-lists but all linked-lists are stored in the same mapping `bids`.
 */
contract ContinuousSale {

    /* *** General *** */
    address public owner;       // The one setting up the contract.
    address payable public beneficiary; // The address which will get the funds.

    uint public constant INFINITY = uint(-2);   // An astronomic number which is still less than uint(-1) which is the maxValuation of TAIL bids.

    /** A bid to buy tokens as long as the personal maximum valuation and expiration deadline not expired.
     *  For each subsale, bids are in a sorted doubly linked list.
     *  They are sorted in ascending order by maxValuation.
     *  Each list contains two artificial bids, HEAD and TAIL having respectively, the minimum and maximum bidID and maxValuation.
     */
    struct Bid {
        /* *** Linked List Members *** */
        uint prev;                              // bidID of the previous element.
        uint next;                              // bidID of the next element.
        /* ***     Bid Members     *** */
        uint maxValuation;                      // Maximum valuation in wei beyond which the contributor prefers refund.
        uint contrib;                           // Contribution in wei.
        address payable contributor;                    // The contributor who placed the bid.
        bool redeemed;                          // True if the ether contribution reimbursed or tokens have been redeemed.
        uint subsaleNumber;                     // Target subsale of the bid
    }

    uint public globalLastBidID;                          // Global bid ID counter, incremented when a new bid summitted.
    mapping (address => uint[]) public contributorBidIDs; // Map contributor to a list of its bid ID.
    mapping (uint => Bid) public bids;                    // Map bidID to bid.

    /* *** Sale parameters *** */
    uint public numberOfSubsales;               // Number of subsales, first on index zero last on index numberOfSubsales-1
    uint public secondsPerSubsale;              // Duration per subsale in seconds.
    uint public startTime;                      // Starting time of the sale in seconds, UNIX epoch
    ERC20 public token;                         // The token which will be sold.
    uint public tokensForSale;                  // Total amount of tokens for sale.

    /* *** Finalization variables *** */
    bool[] public finalized;                                // Is subsale finalized?
    mapping(uint => uint) public cutOffBidIDs;              // Cutoff points for subsales.
    mapping(uint => uint) public sumAcceptedContribs;       // The sum of accepted contributions for a given subsale.

    /* *** Events *** */
    event BidSubmitted(uint subsaleNumber, uint bidID, uint time);

    /* *** Modifiers *** */
    modifier onlyOwner{require(owner == msg.sender, "Only the owner is authorized to execute this."); _;}


    /** @dev Constructor. First contract set up (tokens will also need to be transferred to the contract
     *  and then setToken needs to be called to finish the setup).
     *  @param _beneficiary Beneficiary of the raised funds.
     *  @param _numberOfSubsales Number of subsales.
     *  @param _secondsPerSubsale Duration per subsale in seconds.
     *  @param _startTime Start time of the sale.
     */
    constructor(address payable _beneficiary, uint _numberOfSubsales, uint _secondsPerSubsale, uint _startTime) public {
        owner = msg.sender;
        beneficiary = _beneficiary;
        numberOfSubsales = _numberOfSubsales;
        secondsPerSubsale = _secondsPerSubsale;
        startTime = _startTime;

        globalLastBidID = _numberOfSubsales; // Initialization. bidsIDs with less than _numberOfSubsales are reserved for HEAD bids.

    }

    /** @dev Set the token. Must only be called after the contract receives the tokens to be sold.
     *  @param _token The token to be sold.
     */
    function setToken(ERC20 _token) public onlyOwner {
        require(address(token) == address(0), "Token address has been set already.");         // Make sure the token is not already set.
        require(_token.balanceOf(address(this)) > 0, "Token balance owned by this contract is zero."); // Make sure the contract received the balance.

        token = _token;
        tokensForSale = token.balanceOf(address(this));
    }

    /** @dev Submit a bid. The caller must give the exact position the bid must be inserted into in the list.
     *  In practice, use searchAndBid to avoid the position being incorrect due to a new bid being inserted and changing the position the bid must be inserted at.
     *  @param _subsaleNumber Target subsale of the bid.
     *  @param _maxValuation The maximum valuation given by the contributor. If the amount raised is higher, the bid is cancelled and the contributor refunded because it prefers a refund instead of this level of dilution. To buy no matter what, use INFINITY.
     *  @param _next The bidID of the next bid in the list.
     */
    function submitBid(uint _subsaleNumber, uint _maxValuation, uint _next) public payable {
        uint tailBidID = uint(-1) - _subsaleNumber;
        uint headBidID = _subsaleNumber;

        if(bids[tailBidID].contributor == address(0)){ // Not initialized
            bids[headBidID] = Bid({
                prev: tailBidID,
                next: tailBidID,
                maxValuation: 0,
                contrib: 0,
                contributor: address(uint(-1)), // Mark as initialized with a non-default value
                redeemed: true,                 // Mark as initialized with a non-default value
                subsaleNumber: _subsaleNumber
            });
            bids[tailBidID] = Bid({
                prev: headBidID,
                next: headBidID,
                maxValuation: uint(-1),
                contrib: 0,
                contributor: address(uint(-1)), // Mark as initialized with a non-default value
                redeemed: true,                 // Mark as initialized with a non-default value
                subsaleNumber: _subsaleNumber
            });

            cutOffBidIDs[_subsaleNumber] = tailBidID;
        }

        require(_subsaleNumber < numberOfSubsales, "This subsale is non-existent.");
        require(now < startTime + (_subsaleNumber * secondsPerSubsale) + secondsPerSubsale, "This subsale has been expired.");
        require(bids[_next].subsaleNumber == _subsaleNumber, "This insertion point is inside another subsales linked-list.");

        Bid storage nextBid = bids[_next];
        uint prev = nextBid.prev;
        Bid storage prevBid = bids[prev];
        require(_maxValuation >= prevBid.maxValuation, "Bids should be inserted into a spot where the prev bid doesn't have a higher valuation");
        require(_maxValuation < nextBid.maxValuation,  "Bids should be inserted into a spot where the next bid has a higher valuation");

        ++globalLastBidID; // Increment the globalLastBidID. It will be the new bid's ID.
        // Update the pointers of neighboring bids.
        prevBid.next = globalLastBidID;
        nextBid.prev = globalLastBidID;

        // Insert the bid.
        bids[globalLastBidID] = Bid({
            prev: prev,
            next: _next,
            maxValuation: _maxValuation,
            contrib: msg.value,
            contributor: msg.sender,
            redeemed: false,
            subsaleNumber: _subsaleNumber
        });

        // Add the bid to the list of bids by this contributor.
        contributorBidIDs[msg.sender].push(globalLastBidID);

        emit BidSubmitted(_subsaleNumber, globalLastBidID, now);
    }

    /** @dev Submit a bid to ongoing subsale. The caller must give the exact position the bid must be inserted into in the list.
     *  In practice, use searchAndBid to avoid the position being incorrect due to a new bid being inserted and changing the position the bid must be inserted at.
     *  @param _maxValuation The maximum valuation given by the contributor. If the amount raised is higher, the bid is cancelled and the contributor refunded because it prefers a refund instead of this level of dilution. To buy no matter what, use INFINITY.
     *  @param _next The bidID of the correct insertion spot in the linked-list.
     */
    function submitBidToOngoingSubsale(uint _maxValuation, uint _next) public payable {
        submitBid(getOngoingSubsaleNumber(), _maxValuation, _next);
    }

    /** @dev Search for the correct insertion spot and submit a bid.
     *  This function is O(n), where n is the amount of bids between the initial search position and the insertion position.
     *  The UI must first call search to find the best point to start the search such that it consumes the least amount of gas possible.
     *  Using this function instead of calling submitBid directly prevents it from failing in the case where new bids are added before the transaction is executed.
     *  @param _subsaleNumber Target subsale of the bid.
     *  @param _maxValuation The maximum valuation given by the contributor. If the amount raised is higher, the bid is cancelled and the contributor refunded because it prefers a refund instead of this level of dilution. To buy no matter what, use INFINITY.
     *  @param _next The bidID of the correct insertion spot in the linked-list.
     */
    function searchAndBid(uint _subsaleNumber, uint _maxValuation, uint _next) public payable {
        submitBid(_subsaleNumber, _maxValuation, search(_subsaleNumber, _maxValuation, _next));
    }

    /** @dev Search for the correct insertion spot and submit a bid to the ongoing subsale.
     *  This function is O(n), where n is the amount of bids between the initial search position and the insertion position.
     *  The UI must first call search to find the best point to start the search such that it consumes the least amount of gas possible.
     *  Using this function instead of calling submitBid directly prevents it from failing in the case where new bids are added before the transaction is executed.
     *  @param _maxValuation The maximum valuation given by the contributor. If the amount raised is higher, the bid is cancelled and the contributor refunded because it prefers a refund instead of this level of dilution. To buy no matter what, use INFINITY.
     *  @param _next The bidID of the correct insertion spot in the linked-list..
     */
    function searchAndBidToOngoingSubsale(uint _maxValuation, uint _next) public payable {
        uint ongoingSubsaleNumber = getOngoingSubsaleNumber();
        searchAndBid(ongoingSubsaleNumber, _maxValuation, _next);
    }

    /** @dev Finalize by finding the cut-off bid.
     *  Since the amount of bids is not bounded, this function may have to be called multiple times.
     *  The function is O(min(n,_maxIt)) where n is the amount of bids. In total it will perform O(n) computations, possibly in multiple calls.
     *  Each call has only a constant amount of storage write operations.
     *  The main loop removes inactive accepted bids on stumbling upon. This avoids future finalizations to iterate over.
     *  Note that not every inactive bid will be removed in this process, only if they are stumbled upon.
     *  @param _maxIt The maximum amount of bids to go through. This value must be set in order to not exceed the gas limit.
     *  @param _subsaleNumber Number of the subsale to finalize. Subsale should be due before calling this. Also all previous subsales should be finalized.
     */
    function finalize(uint _maxIt, uint _subsaleNumber) public {
        require(_subsaleNumber < numberOfSubsales, "This subsale doesn't exit.");
        require(now >= startTime + (_subsaleNumber * secondsPerSubsale) + secondsPerSubsale, "This subsale is not expired yet.");
        require(!finalized[_subsaleNumber], "This subsale is already finalized.");

        // Make local copies of the finalization variables in order to avoid modifying storage in order to save gas.
        uint localCutOffBidID = cutOffBidIDs[_subsaleNumber];
        uint localSumAcceptedContrib = sumAcceptedContribs[_subsaleNumber];

        // Search for the cut-off bid while adding the contributions.
        for (uint it = 0; it < _maxIt && !finalized[_subsaleNumber]; ++it) {
            Bid storage bid = bids[localCutOffBidID];

            if (bid.contrib+localSumAcceptedContrib < bid.maxValuation) { // We haven't found the cut-off yet.
                localSumAcceptedContrib += bid.contrib;
                localCutOffBidID = bid.prev; // Go to the previous bid.

            } else { // We found the cut-off. This bid will be taken partially.
                finalized[_subsaleNumber] = true; // This subSale is finalized as it found a cut-off.
                uint contribCutOff = bid.maxValuation >= localSumAcceptedContrib ? bid.maxValuation - localSumAcceptedContrib : 0; // The amount of the contribution of the cut-off bid that can stay in the sale without spilling over the maxValuation.
                contribCutOff = contribCutOff < bid.contrib ? contribCutOff : bid.contrib; // The amount that stays in the sale should not be more than the original contribution. This line is not required but it is added as an extra security measure.
                bid.contributor.send(bid.contrib-contribCutOff); // Send the non-accepted part. Use send in order to not block if the contributor's fallback reverts.
                bid.contrib = contribCutOff; // Update the contribution value.
                localSumAcceptedContrib += bid.contrib;
                beneficiary.send(localSumAcceptedContrib); // Use send in order to not block if the beneficiary's fallback reverts.
            }
        }

        // Update storage. Keeping track of cut-offs and accepted contributions separately as they are needed in redeem function.
        cutOffBidIDs[_subsaleNumber] = localCutOffBidID;
        sumAcceptedContribs[_subsaleNumber] = localSumAcceptedContrib;
    }

    /** @dev Redeem a bid. If the bid is accepted, send the tokens. Otherwise refund ETH contribution.
     *  Note that anyone can call this function, not only the party which made the bid.
     *  @param _bidID ID of the bid to redeem.
     */
    function redeem(uint _bidID) public {
        Bid storage bid = bids[_bidID];
        uint cutOffBidID = cutOffBidIDs[bid.subsaleNumber];
        Bid storage cutOffBid = bids[cutOffBidID];
        require(!bid.redeemed, "This bid is already redeemed.");
        require(finalized[bids[_bidID].subsaleNumber], "This bid is not finalized yet.");

        bid.redeemed = true;
        if (bid.maxValuation > cutOffBid.maxValuation || (bid.maxValuation == cutOffBid.maxValuation && _bidID >= cutOffBidID)) // Give tokens if the bid is accepted.
            require(token.transfer(bid.contributor, (tokensForSale / numberOfSubsales * bid.contrib) / sumAcceptedContribs[bid.subsaleNumber]), "Failed to transfer redeemed tokens. Rolling back.");
        else  // Reimburse ETH otherwise.
            bid.contributor.transfer(bid.contrib);
    }

    /** @dev Fallback. Make a bid to ongoing subsale if ETH are sent. Redeem all the bids of the contributor otherwise.
     *  Note that the contributor could make this function go out of gas if it has too much bids. This in not a problem as it is still possible to redeem using the redeem function directly.
     *  This allows users to bid and get their tokens back using only send operations.
     */
    function () external payable {
        uint tailBidIDForOngoingSale = uint(-1) - getOngoingSubsaleNumber();

        if (msg.value != 0)                                               // Make a bid with an INFINITY maxValuation if some ETH was sent.
            submitBidToOngoingSubsale(INFINITY, tailBidIDForOngoingSale);
        else if (msg.value == 0)                                          // Else, redeem all the non redeemed bids if no ETH was sent.
            for (uint i = 0; i < contributorBidIDs[msg.sender].length; ++i)
            {
                uint bidID = contributorBidIDs[msg.sender][i];
                if (finalized[bids[bidID].subsaleNumber] && !bids[bidID].redeemed) // Select eligible bids to avoid a call that will cause a revert.
                    redeem(bidID);
            }
    }

    /* *** View Functions *** */

    /** @dev Get the number of ongoing subsale
     *  @return numberOfOngoingSubsale
     */
    function getOngoingSubsaleNumber() view public returns (uint numberOfOngoingSubsale){
        numberOfOngoingSubsale = ((now - startTime) / secondsPerSubsale);
    }

    /** @dev Search for the correct insertion spot of a bid.
     *  This function is O(n), where n is the amount of bids between the initial search position and the insertion position.
     *  Max valuation decreases from tail to head node.
     *  @param _maxValuation The maximum valuation given by the contributor. Or INFINITY if no maximum valuation is given.
     *  @param _nextStart The bidID of the next bid from the initial position to start the search from.
     *  @return nextInsert The bidID of the next bid from the position the bid must be inserted at.
     */
    function search(uint _subsaleNumber, uint _maxValuation, uint _nextStart) view public returns(uint nextInsert){
        uint next;
        if(bids[_nextStart].subsaleNumber != _subsaleNumber){ // Invalid first guess point.
            uint tailBidID = uint(-1) - _subsaleNumber;
            next = tailBidID; // Resetting to respective tail bid.
        } else {
            next = _nextStart; // Valid first guess point.
        }

        bool found;

        while(!found) { // While we aren't at the insertion point.
            Bid storage nextBid = bids[next];
            uint prev = nextBid.prev;
            Bid storage prevBid = bids[prev];

            if (_maxValuation < prevBid.maxValuation)       // It should be inserted before.
                next = prev;
            else if (_maxValuation >= nextBid.maxValuation) // It should be inserted after. The second value we sort by is bidID. Those are increasing, thus if the next bid is of the same maxValuation, we should insert after it.
                next = nextBid.next;
            else                                            // We found the insertion point.
                found = true;
        }

        return next;
    }

    /** @dev Get the total contribution of an address. Doesn't count rejected bids.
     *  This can be used for a KYC threshold.
     *  This function is O(n) where n is the amount of bids made by the contributor.
     *  This means that the contributor can make totalContrib(contributor) revert due to an out of gas error on purpose.
     *  @param _contributor The contributor whose contribution will be returned.
     *  @return contribution The total contribution of the contributor.
     */
    function totalContrib(address _contributor) public view returns (uint contribution) {
        for (uint i = 0; i < contributorBidIDs[_contributor].length; ++i){
            uint bidID = contributorBidIDs[_contributor][i];
            Bid storage bid = bids[bidID];
            uint cutOffBidID = cutOffBidIDs[bid.subsaleNumber];
            Bid storage cutOffBid = bids[cutOffBidID];
            if(finalized[bids[bidID].subsaleNumber]){ // The bid is finalized.
                if(bid.maxValuation > cutOffBid.maxValuation || (bid.maxValuation == cutOffBid.maxValuation && bidID >= cutOffBidID)){ // Bid accepted.
                    contribution += bid.contrib;
                }
            }
            else{ // The bid is still active.
                contribution += bid.contrib;
            }
        }
    }

    /** @dev Get the current valuation and cut off bid's details on ongoing subsale.
     *  This function is O(n), where n is the amount of bids. This could exceed the gas limit, therefore this function should only be used for interface display and not by other contracts.
     *  @param _subsaleNumber The number of the subsale to be queried.
     *  @return valuation The current valuation and cut off bid's details.
     *  @return currentCutOffBidID The current cut-off bid.
     *  @return currentCutOffBidMaxValuation The max valuation of the current cut-off bid.
     *  @return currentCutOffBidContrib The contributed amount of current cut-off bid.
     */
    function valuationAndCutOff(uint _subsaleNumber) public view returns (uint valuation, uint currentCutOffBidID, uint currentCutOffBidMaxValuation, uint currentCutOffBidContrib) {
        uint headBidID = _subsaleNumber;
        uint tailBidID = uint(-1) - _subsaleNumber;

        currentCutOffBidID = bids[tailBidID].prev;

        // Loop over all bids or until cut off bid is found
        while (currentCutOffBidID != headBidID) {
            Bid storage bid = bids[currentCutOffBidID];
            if (bid.contrib + valuation < bid.maxValuation) { // We haven't found the cut-off yet.
                valuation += bid.contrib;
                currentCutOffBidID = bid.prev; // Go to the previous bid.
            } else { // We found the cut-off bid. This bid will be taken partially.
                currentCutOffBidContrib = bid.maxValuation >= valuation ? bid.maxValuation - valuation : 0; // The amount of the contribution of the cut-off bid that can stay in the sale without spilling over the maxValuation.
                valuation += currentCutOffBidContrib;
                break;
            }
        }

        currentCutOffBidMaxValuation = bids[currentCutOffBidID].maxValuation;
    }
}
