/* THIS IS A WORK IN PROGRESS, DO NOT TRUST THIS CONTRACT! */

/**
 *  @authors: [@ferittuncer]
 *  @reviewers: []
 *  @auditors: []
 *  @bounties: []
 *  @deployments: []
 */

pragma solidity ^0.4.25;

import "openzeppelin-solidity/contracts/token/ERC20/ERC20.sol";

/** @title Continuous Interactive Initial Coin Offering Contract
 *  This contract implements the Interactive Coin Offering token sale as described in this paper:
 *  https://people.cs.uchicago.edu/~teutsch/papers/ico.pdf
 *  Implementation details and modifications compared to the paper:
 *  - A fixed amount of tokens is sold. This allows more flexibility for the distribution of the remaining tokens (rounds, team tokens which can be preallocated, non-initial sell of some cryptographic assets).
 *  - The valuation pointer is only moved when the sale is over. This greatly reduces the amount of write operations and code complexity. However, at least one party must make one or multiple calls to finalize the sale.
 *  - Buckets are not used as they are not required and increase code complexity.
 *  - The bid submitter must provide the insertion spot. A search of the insertion spot is still done in the contract just in case the one provided was wrong or other bids were added between when the TX got signed and executed, but giving the search starting point greatly lowers gas consumption.
 *  - Calling the fallback function while sending ETH places a bid with an infinite maximum valuation. This allows buyers who want to buy no matter the price not need to use a specific interface and just send ETH. Without ETH, a call to the fallback function redeems the bids of the caller.
 *  - The main sale has many subsales which is in-effect similar to running multiple interactive initial coin offerings consecutively.
 */
contract ContinuousIICO {

    /* *** General *** */
    address public owner;       // The one setting up the contract.
    address public beneficiary; // The address which will get the funds.

    /* *** Bid *** */
    uint constant HEAD = 0;            // Minimum value used for both the maxValuation and bidID of the head of the linked list.
    uint constant TAIL = uint(-1);     // Maximum value used for both the maxValuation and bidID of the tail of the linked list.
    uint constant INFINITY = uint(-2); // A value so high that a bid using it is guaranteed to succeed. Still lower than TAIL to be placed before TAIL.

    /** A bid to buy tokens as long as the personal maximum valuation and expiration deadline not expired.
     *  Bids are in a sorted doubly linked list.
     *  They are sorted in ascending order by maxValuation.
     *  The list contains two artificial bids HEAD and TAIL having respectively the minimum and maximum bidID and maxValuation.
     */
    struct Bid {
        /* *** Linked List Members *** */
        uint prev;                              // bidID of the previous element.
        uint next;                              // bidID of the next element.
        /* ***     Bid Members     *** */
        uint maxValuation;                      // Maximum valuation in wei beyond which the contributor prefers refund.
        uint contrib;                           // Contribution in wei.
        address contributor;                    // The contributor who placed the bid.
        bool redeemed;                          // True if the ETH or tokens have been redeemed.
        uint subsaleNumber;                     // Target subsale of the bid
    }

    uint public globalLastBidID = 0;                      // Global bid ID counter, incremented when a new bid summitted.
    mapping (address => uint[]) public contributorBidIDs; // Map contributor to a list of its bid ID.
    mapping (uint => Bid) public bids;                    // Map bidID to bid.

    /* *** Sale constants *** */
    uint public durationPerSubsale;             // Duration per subsale in seconds.
    uint public numberOfSubsales;               // Number of subsales

    /* *** Sale parameters *** */
    uint public startTime;                      // Starting time of the sale in seconds, UNIX epoch
    uint public endTime;                        // Ending time of the sale in seconds, UNIX epoch
    ERC20 public token;                         // The token which will be sold.
    uint public tokensForSale;                  // Total amount of tokens for sale.

    /* *** Finalization variables *** */
    uint public finalizationTurn = 0;           // Finalization of subsale N requires subsale to be finalized. This counter keeps track of latest finalization.
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
     *  @param _durationPerSubsale Duration per subsale in seconds.
     */
    constructor(address _beneficiary, uint _numberOfSubsales, uint _durationPerSubsale) public {
        owner = msg.sender;
        beneficiary = _beneficiary;
        numberOfSubsales = _numberOfSubsales;
        durationPerSubsale = _durationPerSubsale;

        bids[HEAD] = Bid({
            prev: TAIL,
            next: TAIL,
            maxValuation: 0,
            contrib: 0,
            contributor: address(0),
            redeemed: false,
            subsaleNumber: uint(-1)
        });
        bids[TAIL] = Bid({
            prev: HEAD,
            next: HEAD,
            maxValuation: uint(-1),
            contrib: 0,
            contributor: address(0),
            redeemed: false,
            subsaleNumber: uint(-1)
        });
    }

    /*  @dev Changes beneficiary address.
     *  @param _beneficiary Beneficiary of the raised funds.
     */
    function changeBeneficiary(address _beneficiary) public onlyOwner {
        beneficiary = _beneficiary;
    }

    /*  @dev Starts the sale. Requires token to be set and requires to have a non-zero balance of the token.
     *  @param _delay Delay in seconds from now. Starting time will be delayed by this amount.
     */
    function startSale(uint _delay) public onlyOwner {
        require(address(token) != address(0), "Token address is zero.");
        require(tokensForSale != 0, "Zero token balance for sale.");

        startTime = now + _delay;
        endTime = startTime + (numberOfSubsales * durationPerSubsale);
    }

    /** @dev Set the token. Must only be called after the contract receives the tokens to be sold.
     *  @param _token The token to be sold.
     */
    function setToken(ERC20 _token) public onlyOwner {
        require(address(token) == address(0), "Token address has been set already."); // Make sure the token is not already set.
        require(_token.balanceOf(this) > 0, "Token balance owned by this contract is zero."); // Make sure the contract received the balance.

        token = _token;
        tokensForSale = token.balanceOf(this);
    }

    /** @dev Submit a bid. The caller must give the exact position the bid must be inserted into in the list.
     *  In practice, use searchAndBid to avoid the position being incorrect due to a new bid being inserted and changing the position the bid must be inserted at.
     *  @param _subsaleNumber Target subsale of the bid.
     *  @param _maxValuation The maximum valuation given by the contributor. If the amount raised is higher, the bid is cancelled and the contributor refunded because it prefers a refund instead of this level of dilution. To buy no matter what, use INFINITY.
     *  @param _next The bidID of the next bid in the list.
     */
    function submitBid(uint _subsaleNumber, uint _maxValuation, uint _next) public payable {
        Bid storage nextBid = bids[_next];
        uint prev = nextBid.prev;
        Bid storage prevBid = bids[prev];
        require(_maxValuation >= prevBid.maxValuation && _maxValuation < nextBid.maxValuation, "Invalid position."); // The new bid maxValuation is higher than the previous one and strictly lower than the next one.
        require(now >= startTime + (_subsaleNumber * durationPerSubsale), "This subsale has not started yet."); // Check that the bids are still open.
        require(now < startTime + (_subsaleNumber * durationPerSubsale) + durationPerSubsale, "This subsale has been due."); // Check that the bids are still open.

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

        // Emit event
        emit BidSubmitted(_subsaleNumber, globalLastBidID, now);
    }

    /** @dev Submit a bid to ongoing subsale. The caller must give the exact position the bid must be inserted into in the list.
     *  In practice, use searchAndBid to avoid the position being incorrect due to a new bid being inserted and changing the position the bid must be inserted at.
     *  @param _maxValuation The maximum valuation given by the contributor. If the amount raised is higher, the bid is cancelled and the contributor refunded because it prefers a refund instead of this level of dilution. To buy no matter what, use INFINITY.
     *  @param _next The bidID of the next bid in the list.
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
     *  @param _next The bidID of the next bid in the list.
     */
    function searchAndBid(uint _subsaleNumber, uint _maxValuation, uint _next) public payable {
        submitBid(_subsaleNumber, _maxValuation, search(_maxValuation, _next));
    }

    /** @dev Search for the correct insertion spot and submit a bid to the ongoing subsale.
     *  This function is O(n), where n is the amount of bids between the initial search position and the insertion position.
     *  The UI must first call search to find the best point to start the search such that it consumes the least amount of gas possible.
     *  Using this function instead of calling submitBid directly prevents it from failing in the case where new bids are added before the transaction is executed.
     *  @param _maxValuation The maximum valuation given by the contributor. If the amount raised is higher, the bid is cancelled and the contributor refunded because it prefers a refund instead of this level of dilution. To buy no matter what, use INFINITY.
     *  @param _next The bidID of the next bid in the list.
     */
    function searchAndBidToOngoingSubsale(uint _maxValuation, uint _next) public payable {
        searchAndBid(getOngoingSubsaleNumber(), _maxValuation, search(_maxValuation, _next));
    }

    /** @dev Finalize by finding the cut-off bid.
     *  Since the amount of bids is not bounded, this function may have to be called multiple times.
     *  The function is O(min(n,_maxIt)) where n is the amount of bids. In total it will perform O(n) computations, possibly in multiple calls.
     *  Each call has only a constant amount of storage write operations.
     *  The main loop removes inactive bids on stumbling upon. This avoids future finalizations to iterate over.
     *  Note that not every inactive bid will be removed in this process, only if they are stumbled upon.
     *  @param _maxIt The maximum amount of bids to go through. This value must be set in order to not exceed the gas limit.
     *  @param _subsaleNumber Number of the subsale to finalize. Subsale should be due before calling this. Also all previous subsales should be finalized.
     */
    function finalize(uint _maxIt, uint _subsaleNumber) public {
        require(now >= startTime + (_subsaleNumber * durationPerSubsale) + durationPerSubsale, "This subsale is not due yet.");
        require(finalizationTurn == _subsaleNumber, "You can not finalize this subsale.");

        if(cutOffBidIDs[_subsaleNumber] == 0)
            cutOffBidIDs[_subsaleNumber] = TAIL;

        // Make local copies of the finalization variables in order to avoid modifying storage in order to save gas.
        uint localCutOffBidID = cutOffBidIDs[_subsaleNumber];
        uint localSumAcceptedContrib = sumAcceptedContribs[_subsaleNumber];

        // Search for the cut-off bid while adding the contributions.
        for (uint it = 0; it < _maxIt && (finalizationTurn == _subsaleNumber); ++it) {
            Bid storage bid = bids[localCutOffBidID];

            if( bid.subsaleNumber != _subsaleNumber && localCutOffBidID != TAIL){ // If stumble upon an inactive bid, clear to avoid iterating it in future finalizations.
                if(bid.subsaleNumber < _subsaleNumber)
                {
                    bids[bid.prev].next = bid.next; // Removes nodes from the linked list by bypassing them.
                    bids[bid.next].prev = bid.prev; // A->B ; B->C; becomes A->C
                }
                localCutOffBidID = bid.prev;
            }
            else if (bid.contrib+localSumAcceptedContrib < bid.maxValuation) { // We haven't found the cut-off yet.
                localSumAcceptedContrib += bid.contrib;
                localCutOffBidID = bid.prev; // Go to the previous bid.

            } else { // We found the cut-off. This bid will be taken partially.
                finalizationTurn++; // This subSale is finalized, let the next one to be finalized.
                uint contribCutOff = bid.maxValuation >= localSumAcceptedContrib ? bid.maxValuation - localSumAcceptedContrib : 0; // The amount of the contribution of the cut-off bid that can stay in the sale without spilling over the maxValuation.
                contribCutOff = contribCutOff < bid.contrib ? contribCutOff : bid.contrib; // The amount that stays in the sale should not be more than the original contribution. This line is not required but it is added as an extra security measure.
                bid.contributor.send(bid.contrib-contribCutOff); // Send the non-accepted part. Use send in order to not block if the contributor's fallback reverts.
                bid.contrib = contribCutOff; // Update the contribution value.
                localSumAcceptedContrib += bid.contrib;
                beneficiary.send(localSumAcceptedContrib); // Use send in order to not block if the beneficiary's fallback reverts.
            }
        }

        // Update storage.
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
        require(isBidFinalized(_bidID), "This bid is not finalized yet.");

        bid.redeemed = true;
        if (bid.maxValuation > cutOffBid.maxValuation || (bid.maxValuation == cutOffBid.maxValuation && _bidID >= cutOffBidID)) // Give tokens if the bid is accepted.
            require(token.transfer(bid.contributor, (tokensForSale / numberOfSubsales * bid.contrib) / sumAcceptedContribs[bid.subsaleNumber]), "Failed to redeem.");
        else  // Reimburse ETH otherwise.
            bid.contributor.transfer(bid.contrib);
    }

    /** @dev Fallback. Make a bid if ETH are sent. Redeem all the bids of the contributor otherwise.
     *  Note that the contributor could make this function go out of gas if it has too much bids. This in not a problem as it is still possible to redeem using the redeem function directly.
     *  This allows users to bid and get their tokens back using only send operations.
     */
    function () public payable {
        if (msg.value != 0)                                   // Make a bid with an infinite maxValuation and no expiration deadline if some ETH was sent.
            submitBidToOngoingSubsale(INFINITY, TAIL);      // expiresAfter argument doesn't matter actually as maxValuation is astronomic the bid will be accepted anyway.
        else if (msg.value == 0)                              // Else, redeem all the non redeemed bids if no ETH was sent.
            for (uint i = 0; i < contributorBidIDs[msg.sender].length; ++i)
            {
                uint bidID = contributorBidIDs[msg.sender][i];
                if ((isBidFinalized(bidID)) && !bids[bidID].redeemed) // Select eligible bids to avoid a call that will cause a revert.
                    redeem(bidID);
            }
    }

    /* *** View Functions *** */

    /*  @dev Returns the number of currently ongoing subsale.
     *  note that there will be one and only one active(ongoing) sale between the window of startTime and endTime.
     */
    function getOngoingSubsaleNumber() public view returns(uint) {
        require(now >= startTime, "Sale not started yet.");
        require(now < endTime, "Sale already ended.");
        return (now - startTime) / durationPerSubsale;
    }


    /** @dev Returns if the bid is finalized.
     *  @param _bidID ID of the bid to be queried.
     *  @return True if given bid is finalized, false otherwise.
     */
    function isBidFinalized(uint _bidID) public view returns(bool) {
        return bids[_bidID].subsaleNumber < finalizationTurn;
    }


    /** @dev Search for the correct insertion spot of a bid.
     *  This function is O(n), where n is the amount of bids between the initial search position and the insertion position.
     *  Max valuation decreases from tail to head node.
     *  @param _maxValuation The maximum valuation given by the contributor. Or INFINITY if no maximum valuation is given.
     *  @param _nextStart The bidID of the next bid from the initial position to start the search from.
     *  @return nextInsert The bidID of the next bid from the position the bid must be inserted at.
     */
    function search(uint _maxValuation, uint _nextStart) view public returns(uint nextInsert) {
        uint next = _nextStart;
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
            if(isBidFinalized(bidID)){ // The bid is finalized.
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
     *  @return valuation The current valuation and cut off bid's details.
     *  @return currentCutOffBidID The current cut-off bid.
     *  @return currentCutOffBidMaxValuation The max valuation of the current cut-off bid.
     *  @return currentCutOffBidContrib The contributed amount of current cut-off bid.
     */
    function valuationAndCutOff() public view returns (uint valuation, uint currentCutOffBidID, uint currentCutOffBidMaxValuation, uint currentCutOffBidContrib) {
        currentCutOffBidID = bids[TAIL].prev;
        uint subSaleNumber = getOngoingSubsaleNumber();

        // Loop over all bids or until cut off bid is found
        while (currentCutOffBidID != HEAD) {
            Bid storage bid = bids[currentCutOffBidID];
            if ( bid.subsaleNumber != subSaleNumber){
                currentCutOffBidID = bid.prev;
            }
            else if (bid.contrib + valuation < bid.maxValuation) { // We haven't found the cut-off yet.
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
