/* THIS IS A WORK IN PROGRESS, DO NOT TRUST THIS CONTRACT! */


pragma solidity ^0.4.24;

import "openzeppelin-solidity/contracts/token/ERC20/ERC20.sol";
import "openzeppelin-solidity/contracts/token/ERC20/ERC20Mintable.sol"; // For Truffle, to create artifacts required for the test file.


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
    // They are sorted in ascending order by (maxValuation,bidID) where bidID is the ID and key of the bid in the mapping.
    // The list contains two artificial bids HEAD and TAIL having respectively the minimum and maximum bidID and maxValuation.
    struct Bid {
        /* *** Linked List Members *** */
        uint prev;            // bidID of the previous element.
        uint next;            // bidID of the next element.
        /* ***     Bid Members     *** */
        uint maxValuation;    // Maximum valuation in wei beyond which the contributor prefers refund.
        uint contrib;         // Contribution in wei.
        address contributor;  // The contributor who placed the bid.
        bool redeemed;        // True if the ETH or tokens have been redeemed.
        uint subSaleNumber;
    }
    mapping (uint => Bid) public bids; // Map bidID to bid.
    mapping (address => uint[]) public contributorBidIDs; // Map contributor to a list of its bid ID.
    uint public lastBidID = 0; // The last bidID not accounting TAIL.

    /* *** Sale constants *** */
    uint durationPerSubSale = 86400; // Each sale lasts 86400 seconds (24 hours)
    uint public numberOfSubSales = 365; // This will be a year long sale (365 days)

    /* *** Sale parameters *** */
    uint public startTime;                      // When the sale starts.
    ERC20 public token;                         // The token which is sold.
    uint public tokensForSale;
    /* *** Finalization variables *** */
    bool[] public finalized;                 // True when the cutting bid has been found. The following variables are final only after finalized==true.
    uint[] public cutOffBidIDs;        // The first accepted bid. All bids after it are accepted.
    uint[] public sumAcceptedContribs;        // The sum of accepted contributions.

    /* *** Events *** */
    event BidSubmitted(address indexed contributor, uint indexed bidID, uint indexed time);

    /* *** Modifiers *** */
    modifier onlyOwner{ require(owner == msg.sender); _; }

    /* *** Functions Modifying the state *** */

    /** @dev Constructor. First contract set up (tokens will also need to be transferred to the contract and then setToken needs to be called to finish the setup).
     *  @param _beneficiary The party which will get the funds of the token sale.
     */
    constructor(address _beneficiary) public {
        owner = msg.sender;
        beneficiary = _beneficiary;

        for (uint i = 0; i < numberOfSubSales; i++){
          cutOffBidIDs[i] = TAIL;

          // Add the virtual bids. This simplifies other functions.
          bids[HEAD] = Bid({
              prev: TAIL,
              next: TAIL,
              maxValuation: HEAD,
              contrib: 0,
              contributor: address(0),
              redeemed: false,
              subSaleNumber:i
          });
          bids[TAIL] = Bid({
              prev: HEAD,
              next: HEAD,
              maxValuation: TAIL,
              contrib: 0,
              contributor: address(0),
              redeemed: false,
              subSaleNumber: i
          });
        }


    }

    function startTimeOfSubSale(uint _day) view returns (uint){
      return startTime + (_day * durationPerSubSale);
    }

    function endTimeOfSubSale(uint _day) view returns(uint){
      return startTimeOfSubSale(_day) + durationPerSubSale;
    }

    function tokensPerSubSale() view returns(uint){
      return tokensForSale / numberOfSubSales;
    }

    function endTimeOfSale() view returns(uint){
      require(startTime != 0);
      return startTime + (numberOfSubSales * durationPerSubSale);
    }

    function startSale(uint _startTime) {
      require(address(token) != address(0));
      require(tokensForSale != 0);
      require(startTime > now);

      startTime = _startTime;
    }

    /** @dev Set the token. Must only be called after the IICO contract receives the tokens to be sold.
     *  @param _token The token to be sold.
     */
    function setToken(ERC20 _token) public onlyOwner {
        require(address(token) == address(0)); // Make sure the token is not already set.

        token = _token;
        tokensForSale = token.balanceOf(this);
    }

    function getOngoingSubSaleNumber() view returns(uint){
      return (now - startTime) / durationPerSubSale;
    }

    /** @dev Submit a bid. The caller must give the exact position the bid must be inserted into in the list.
     *  In practice, use searchAndBid to avoid the position being incorrect due to a new bid being inserted and changing the position the bid must be inserted at.
     *  @param _maxValuation The maximum valuation given by the contributor. If the amount raised is higher, the bid is cancelled and the contributor refunded because it prefers a refund instead of this level of dilution. To buy no matter what, use INFINITY.
     *  @param _next The bidID of the next bid in the list.
     */
    function submitBid(uint _maxValuation, uint _next) public payable {
        uint currentSaleNumber = getOngoingSubSaleNumber();

        Bid storage nextBid = bids[_next];

        require(nextBid.subSaleNumber == currentSaleNumber);

        uint prev = nextBid.prev;
        Bid storage prevBid = bids[prev];
        require(_maxValuation >= prevBid.maxValuation && _maxValuation < nextBid.maxValuation); // The new bid maxValuation is higher than the previous one and strictly lower than the next one.
        require(now >= startTime && now < endTimeOfSale()); // Check that the bids are still open.

        ++lastBidID; // Increment the lastBidID. It will be the new bid's ID.
        // Update the pointers of neighboring bids.
        prevBid.next = lastBidID;
        nextBid.prev = lastBidID;

        // Insert the bid.
        bids[lastBidID] = Bid({
            prev: prev,
            next: _next,
            maxValuation: _maxValuation,
            contrib: msg.value,
            contributor: msg.sender,
            redeemed: false,
            subSaleNumber: currentSaleNumber
        });

        // Add the bid to the list of bids by this contributor.
        contributorBidIDs[msg.sender].push(lastBidID);

        // Emit event
        emit BidSubmitted(msg.sender, lastBidID, now);
    }


    /** @dev Search for the correct insertion spot and submit a bid.
     *  This function is O(n), where n is the amount of bids between the initial search position and the insertion position.
     *  The UI must first call search to find the best point to start the search such that it consumes the least amount of gas possible.
     *  Using this function instead of calling submitBid directly prevents it from failing in the case where new bids are added before the transaction is executed.
     *  @param _maxValuation The maximum valuation given by the contributor. If the amount raised is higher, the bid is cancelled and the contributor refunded because it prefers a refund instead of this level of dilution. To buy no matter what, use INFINITY.
     *  @param _next The bidID of the next bid in the list.
     */
    function searchAndBid(uint _maxValuation, uint _next) public payable {
        submitBid(_maxValuation, search(_maxValuation,_next));
    }

    /** @dev Finalize by finding the cut-off bid.
     *  Since the amount of bids is not bounded, this function may have to be called multiple times.
     *  The function is O(min(n,_maxIt)) where n is the amount of bids. In total it will perform O(n) computations, possibly in multiple calls.
     *  Each call only has a O(1) storage write operations.
     *  @param _maxIt The maximum amount of bids to go through. This value must be set in order to not exceed the gas limit.
     */
    function finalize(uint _maxIt, uint _subSaleNumber) public {
        require(now >= endTimeOfSubSale(_subSaleNumber));
        require(!finalized[_subSaleNumber]);

        // Make local copies of the finalization variables in order to avoid modifying storage in order to save gas.
        uint localCutOffBidID = cutOffBidIDs[_subSaleNumber];
        uint localSumAcceptedContrib = sumAcceptedContribs[_subSaleNumber];

        // Search for the cut-off bid while adding the contributions.
        for (uint it = 0; it < _maxIt && !finalized[_subSaleNumber]; ++it) {
            Bid storage bid = bids[localCutOffBidID];
            if (bid.contrib+localSumAcceptedContrib < bid.maxValuation) { // We haven't found the cut-off yet.
                localSumAcceptedContrib        += bid.contrib;
                localCutOffBidID = bid.prev; // Go to the previous bid.
            } else { // We found the cut-off. This bid will be taken partially.
                finalized[_subSaleNumber] = true;
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

    /** @dev Redeem a bid. If the bid is accepted, send the tokens, otherwise refund the ETH.
     *  Note that anyone can call this function, not only the party which made the bid.
     *  @param _bidID ID of the bid to withdraw.
     */
    function redeem(uint _bidID, uint _subSaleNumber) public {

        Bid storage bid = bids[_bidID];
        Bid storage cutOffBid = bids[cutOffBidIDs[_subSaleNumber]];
        require(finalized[_subSaleNumber]);
        require(!bid.redeemed);

        bid.redeemed=true;
        if (bid.maxValuation > cutOffBid.maxValuation || (bid.maxValuation == cutOffBid.maxValuation && _bidID >= cutOffBidIDs[_subSaleNumber])) // Give tokens if the bid is accepted.
            require(token.transfer(bid.contributor, (tokensPerSubSale() * (bid.contrib) / sumAcceptedContribs[_subSaleNumber])));
        else                                                                                            // Reimburse ETH otherwise.
            bid.contributor.transfer(bid.contrib);
    }

    /** @dev Fallback. Make a bid if ETH are sent. Redeem all the bids of the contributor otherwise.
     *  Note that the contributor could make this function go out of gas if it has too much bids. This in not a problem as it is still possible to redeem using the redeem function directly.
     *  This allows users to bid and get their tokens back using only send operations.
     */
    function () public payable {
        if (msg.value != 0 && now >= startTime && now < endTimeOfSale()) // Make a bid with an infinite maxValuation if some ETH was sent.
            submitBid(INFINITY, TAIL);
        else if (msg.value == 0)                    // Else, redeem all the non redeemed bids if no ETH was sent.
            for (uint i = 0; i < contributorBidIDs[msg.sender].length; ++i)
            {
              uint bidID = contributorBidIDs[msg.sender][i];
                if (finalized[bids[bidID].subSaleNumber] && !bids[bidID].redeemed)
                    redeem(bidID, bids[bidID].subSaleNumber);
            }
        else                                                     // Otherwise, no actions are possible.
            revert();
    }

    /* *** View Functions *** */

    /** @dev Search for the correct insertion spot of a bid.
     *  This function is O(n), where n is the amount of bids between the initial search position and the insertion position.
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
            else                                // We found the insertion point.
                found = true;
        }

        return next;
    }

    /** @dev Get the total contribution of an address.
     *  This can be used for a KYC threshold.
     *  This function is O(n) where n is the amount of bids made by the contributor.
     *  This means that the contributor can make totalContrib(contributor) revert due to an out of gas error on purpose.
     *  @param _contributor The contributor whose contribution will be returned.
     *  @return contribution The total contribution of the contributor.
     */
    function totalContrib(address _contributor, uint _subSaleNumber) public view returns (uint contribution) {
        for (uint i = 0; i < contributorBidIDs[_contributor].length; ++i)
            contribution += bids[contributorBidIDs[_contributor][i]].contrib;
    }


}
