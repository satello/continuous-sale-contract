/* THIS IS A WORK IN PROGRESS, DO NOT TRUST THIS CONTRACT! */

pragma solidity ^0.4.24;

import "openzeppelin-solidity/contracts/token/ERC20/ERC20.sol";

contract ContinuousIICO {

    /* *** General *** */
    address public owner;       // The one setting up the contract.
    address public beneficiary; // The address which will get the funds.

    /* *** Bid *** */
    uint constant HEAD = 0;            // Minimum value used for both the maxValuation and bidID of the head of the linked list.
    uint constant TAIL = uint(-1);     // Maximum value used for both the maxValuation and bidID of the tail of the linked list.
    uint constant INFINITY = uint(-2); // A value so high that a bid using it is guaranteed to succeed. Still lower than TAIL to be placed before TAIL.
    // A bid to buy tokens as long as the personal maximum valuation is not exceeded.
    // Bids are in a sorted doubly linked list.
    // They are sorted in ascending order by (maxValuation, expiresAfter).
    // The list contains two artificial bids HEAD and TAIL having respectively the minimum and maximum bidID and maxValuation.
    struct Bid {
        /* *** Linked List Members *** */
        uint prev;                              // bidID of the previous element.
        uint next;                              // bidID of the next element.
        /* ***     Bid Members     *** */
        uint maxValuation;                      // Maximum valuation in wei beyond which the contributor prefers refund.
        uint contrib;                           // Contribution in wei.
        address contributor;                    // The contributor who placed the bid.
        bool redeemed;                          // True if the ETH or tokens have been redeemed.
        uint expiresAfter;                      // Expires after given subsale
        uint acceptedAt;                        // Mark as accepted in a particular subsale
    }
    uint public globalLastBidID = 0;            // Global ID counter
    mapping (address => uint[]) public contributorBidIDs; // Map contributor to a list of its bid ID.
    mapping (uint => Bid) public bids;          // Map bidID to bid.

    /* *** Sale constants *** */
    uint public durationPerSubSale;     // Each sale lasts 86400 seconds (24 hours)
    uint public numberOfSubSales;         // This will be a year long sale (365 days)
    uint public tokensPerSubSale;               // Will be initialized when sale gets started.

    /* *** Sale parameters *** */
    uint public startTime;                      // When the sale starts.
    uint public endTime;                        // When the sale ends.
    ERC20 public token;                         // The token which is sold.
    uint public tokensForSale;                  // Total amount of tokens for sale

    /* *** Finalization variables *** */
    uint public finalizationTurn = 0;                     // Number of subSale which should be finalized before others.
    uint[365] public cutOffBidIDs;                 // Cutoff point for a given subsale
    uint[365] public sumAcceptedContribs;          // The sum of accepted contributions for a given subsale.

    /* *** Events *** */
    event BidSubmitted(address contributor, uint expiresAfter, uint bidID, uint time);

    /* *** Debugging Events *** */
    event CutOffBidIDInit(uint subsaleNumber);

    /* *** Modifiers *** */
    modifier onlyOwner{require(owner == msg.sender, "Only the owner is authorized to execute this."); _;}

    /* *** Functions Modifying the state *** */

    /** @dev Constructor. First contract set up (tokens will also need to be transferred to the contract and then setToken needs to be called to finish the setup).
     */
    constructor(address _beneficiary, uint _numberOfSubsales, uint _durationPerSubsale) public {
        owner = msg.sender;
        beneficiary = _beneficiary;
        numberOfSubSales = _numberOfSubsales;
        durationPerSubSale = _durationPerSubsale;

        bids[HEAD] = Bid({
            prev: TAIL,
            next: TAIL,
            maxValuation: 0,
            contrib: 0,
            contributor: address(0),
            redeemed: false,
            acceptedAt: uint(-1),
            expiresAfter: uint(-1)
        });
        bids[TAIL] = Bid({
            prev: HEAD,
            next: HEAD,
            maxValuation: uint(-1),
            contrib: 0,
            contributor: address(0),
            redeemed: false,
            acceptedAt: uint(-1),
            expiresAfter: 0
        });
    }

    function changeBeneficiary(address _beneficiary) public onlyOwner {
      beneficiary = _beneficiary;
    }



    function startSale(uint _delay) public onlyOwner {
        require(address(token) != address(0), "Token address is zero.");
        require(tokensForSale != 0, "Zero token balance for sale.");

        startTime = now + _delay;
        endTime = startTime + (numberOfSubSales * durationPerSubSale);
        tokensPerSubSale = tokensForSale / numberOfSubSales;
    }




    /** @dev Set the token. Must only be called after the IICO contract receives the tokens to be sold.
     *  @param _token The token to be sold.
     */
    function setToken(ERC20 _token) public onlyOwner {
        require(address(token) == address(0), "Token address has been set already."); // Make sure the token is not already set.
        require(_token.balanceOf(this) > 0, "Token balance owned by this contract is zero."); // Make sure the contract received the balance.
        token = _token;
        tokensForSale = token.balanceOf(this);
    }

    function getOngoingSubSaleNumber() public view returns(uint) {
        require(now >= startTime, "Sale not started yet.");
        require(now < endTime, "Sale already ended.");
        return (now - startTime) / durationPerSubSale;
    }

    /** @dev Submit a bid. The caller must give the exact position the bid must be inserted into in the list.
     *  In practice, use searchAndBid to avoid the position being incorrect due to a new bid being inserted and changing the position the bid must be inserted at.
     *  @param _maxValuation The maximum valuation given by the contributor. If the amount raised is higher, the bid is cancelled and the contributor refunded because it prefers a refund instead of this level of dilution. To buy no matter what, use INFINITY.
     *  @param _next The bidID of the next bid in the list.
     */
    function submitBid(uint _maxValuation, uint _next, uint _expiresAfter) public payable {
        Bid storage nextBid = bids[_next];
        uint prev = nextBid.prev;
        Bid storage prevBid = bids[prev];
        require(_maxValuation >= prevBid.maxValuation && _maxValuation < nextBid.maxValuation, "Invalid position."); // The new bid maxValuation is higher than the previous one and strictly lower than the next one.
        require(now >= startTime && now < endTime, "Sale hasn't started yet or already ended."); // Check that the bids are still open.

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
            expiresAfter: _expiresAfter,
            acceptedAt: uint(-1)
        });

        // Add the bid to the list of bids by this contributor.
        contributorBidIDs[msg.sender].push(globalLastBidID);

        // Emit event
        emit BidSubmitted(msg.sender, _expiresAfter, globalLastBidID, now);
    }


    /** @dev Search for the correct insertion spot and submit a bid.
     *  This function is O(n), where n is the amount of bids between the initial search position and the insertion position.
     *  The UI must first call search to find the best point to start the search such that it consumes the least amount of gas possible.
     *  Using this function instead of calling submitBid directly prevents it from failing in the case where new bids are added before the transaction is executed.
     *  @param _maxValuation The maximum valuation given by the contributor. If the amount raised is higher, the bid is cancelled and the contributor refunded because it prefers a refund instead of this level of dilution. To buy no matter what, use INFINITY.
     *  @param _next The bidID of the next bid in the list.
     */
    function searchAndBid(uint _maxValuation, uint _next, uint _expiresAfter) public payable {
        submitBid(_maxValuation, search(_maxValuation, _expiresAfter, _next), _expiresAfter);
    }


    /** @dev Finalize by finding the cut-off bid.
     *  Since the amount of bids is not bounded, this function may have to be called multiple times.
     *  The function is O(min(n,_maxIt)) where n is the amount of bids. In total it will perform O(n) computations, possibly in multiple calls.
     *  Each call only has a O(1) storage write operations.
     *  @param _maxIt The maximum amount of bids to go through. This value must be set in order to not exceed the gas limit.
     */
    function finalize(uint _maxIt, uint _subSaleNumber) public {
        require(now >= endTimeOfSubSale(_subSaleNumber), "This subsale is not due yet.");
        require(finalizationTurn == _subSaleNumber, "There are previous subsales which are not finalized yet. Please finalize them first.");

        // Make local copies of the finalization variables in order to avoid modifying storage in order to save gas.

        if(cutOffBidIDs[_subSaleNumber] == 0) // If it's zero, it's not initalized before. (First call to finalize function)
        {
          cutOffBidIDs[_subSaleNumber] = TAIL; // Initialize
          emit CutOffBidIDInit(_subSaleNumber);
        }
        uint localCutOffBidID = cutOffBidIDs[_subSaleNumber];
        uint localSumAcceptedContrib = sumAcceptedContribs[_subSaleNumber];

        // Search for the cut-off bid while adding the contributions.
        for (uint it = 0; it < _maxIt && (finalizationTurn == _subSaleNumber); ++it) {
            Bid storage bid = bids[localCutOffBidID];
            if(bid.expiresAfter < _subSaleNumber || bid.acceptedAt < numberOfSubSales){ // This bid is expired or accepted already, we will remove it from the linked list
                bids[bid.prev].next = bid.next;
                bids[bid.next].prev = bid.prev;
            }
            else if (bid.contrib+localSumAcceptedContrib < bid.maxValuation) { // We haven't found the cut-off yet.
                bid.acceptedAt = _subSaleNumber;
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
        cutOffBidIDs[_subSaleNumber] = localCutOffBidID;
        sumAcceptedContribs[_subSaleNumber] = localSumAcceptedContrib;
    }


    /** @dev Redeem a bid. If the bid is accepted, send the tokens. Otherwise refund ETH contribution.
     *  Note that anyone can call this function, not only the party which made the bid.
     *  @param _bidID ID of the bid to redeem.
     */
    function redeem(uint _bidID) public {
        Bid storage bid = bids[_bidID];
        require(!bid.redeemed, "This bid is already redeemed.");

        bid.redeemed = true;
        if(isBidExpired(_bidID)){
            bid.contributor.transfer(bid.contrib);
        }
        else if(isBidAccepted(_bidID))
        {
            require(token.transfer(bid.contributor, (tokensPerSubSale * (bid.contrib) / sumAcceptedContribs[bid.acceptedAt])), "Failed to transfer Pinakions.");
        }
        // Else the bid is still valid, either will be accepted or get expired in following subsales.
        else {
            revert("This bid is neither accepted nor expired.");
        }

    }

    /** @dev Fallback. Make a bid if ETH are sent. Redeem all the bids of the contributor otherwise.
     *  Note that the contributor could make this function go out of gas if it has too much bids. This in not a problem as it is still possible to redeem using the redeem function directly.
     *  This allows users to bid and get their tokens back using only send operations.
     */
    function () public payable {
        if (msg.value != 0 && now >= startTime && now < endTime) // Make a bid with an infinite maxValuation to current subsale if some ETH was sent.
            submitBid(INFINITY, TAIL, numberOfSubSales-1); // Autobid flag doesn't matter as max valuation is astronomic.
        else if (msg.value == 0)                    // Else, redeem all the non redeemed bids if no ETH was sent.
            for (uint i = 0; i < contributorBidIDs[msg.sender].length; ++i)
            {
                uint bidID = contributorBidIDs[msg.sender][i];
                if ((isBidAccepted(bidID) || isBidExpired(bidID)) && !bids[bidID].redeemed)
                    redeem(bidID);
            }
        else                                                     // Otherwise, no actions are possible.
            revert("Invalid arguments.");
    }

    /* *** View Functions *** */

    /** @dev Returns the time when a particular subsale is due.
     *  @param _subSaleNumber Number of subsale: [0, numberOfSubSales-1]
     *  @return End time of given subsale.
     */
    function endTimeOfSubSale(uint _subSaleNumber) public view returns(uint) {
        return startTime + (_subSaleNumber * durationPerSubSale) + durationPerSubSale;
    }

    /** @dev Returns if the bid is in accepted state or not. Accepted means bid is processed by finalization,
     *  and the contribution (fully or partially if cutten off) is eligible to be redeemed with the sale token.
     *  @param _bidID ID of the bid to be queried.
     *  @return True if given bid is accepted, false otherwise.
     */
    function isBidAccepted(uint _bidID) public view returns(bool) {
        return bids[_bidID].acceptedAt < numberOfSubSales;
    }

    /** @dev Returns if the bid is in expired state or not. Expired means bid is NOT processed by finalization,
     *  and expiration deadline is passed. Contribution is ready to be refunded.
     *  @param _bidID ID of the bid to be queried.
     *  @return True if given bid is expired, false otherwise.
     */
    function isBidExpired(uint _bidID) public view returns(bool) {
        Bid storage bid = bids[_bidID];
        return !isBidAccepted(_bidID) && bid.expiresAfter < finalizationTurn;
    }

    /** @dev Search for the correct insertion spot of a bid.
     *  This function is O(n), where n is the amount of bids between the initial search position and the insertion position.
     *  @param _maxValuation The maximum valuation given by the contributor. Or INFINITY if no maximum valuation is given. Primary key for sorting.
     *  @param _expiresAfter Expiration deadline of the bid. Secondary key for sorting.
     *  @param _nextStart The bidID of the next bid from the initial position to start the search from.
     *  @return nextInsert The bidID of the next bid from the position the bid must be inserted at.
     */
    function search(uint _maxValuation, uint _expiresAfter, uint _nextStart) public view returns(uint nextInsert) {
        uint next = _nextStart;
        bool found;

        while(!found) { // While we aren't at the insertion point.
            Bid storage nextBid = bids[next];
            uint prev = nextBid.prev;
            Bid storage prevBid = bids[prev];

            if (_maxValuation < prevBid.maxValuation)
            {       // It should be inserted before.
                next = prev;
            }
            else if (_maxValuation > nextBid.maxValuation) // It should be inserted after. The second value we sort by is bidID. Those are increasing, thus if the next bid is of the same maxValuation, we should insert after it.
            {
                next = nextBid.next;
            }

            else if (_maxValuation == nextBid.maxValuation) // It should be inserted after. The second value we sort by is bidID. Those are increasing, thus if the next bid is of the same maxValuation, we should insert after it.
            {
                // If bids have the same max valuation, prioritize the bid with closest expiration deadline.
                if(_expiresAfter > prevBid.expiresAfter)
                {
                    next = prev;
                }
                else if (_expiresAfter < nextBid.expiresAfter)
                {
                    next = nextBid.next;
                }
                else {
                    found = true; // We found the insertion point.
                }
            }

            else {
                found = true; // We found the insertion point.
            }

        }

        return next;
    }

    /** @dev Get the total contribution of an address. Doesn't count expired bids.
     *  This can be used for a KYC threshold.
     *  This function is O(n) where n is the amount of bids made by the contributor.
     *  This means that the contributor can make totalContrib(contributor) revert due to an out of gas error on purpose.
     *  @param _contributor The contributor whose contribution will be returned.
     *  @return contribution The total contribution of the contributor.
     */
    function totalContrib(address _contributor) public view returns (uint contribution) {
        for (uint i = 0; i < contributorBidIDs[_contributor].length; ++i)
            uint bidID = contributorBidIDs[_contributor][i];
            if(!isBidExpired(contributorBidIDs[_contributor][i]))
              contribution += bids[bidID].contrib;
    }


}
