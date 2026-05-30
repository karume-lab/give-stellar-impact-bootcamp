#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, token, Address, Env};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Admin,
    AuctionCount,
    Auction(u32),
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Auction {
    pub id: u32,
    pub creator: Address,
    pub token: Address,
    pub min_bid: i128,
    pub highest_bidder: Option<Address>,
    pub highest_bid: i128,
    pub deadline: u64,
    pub finalized: bool,
}

#[contract]
pub struct NoLossAuctionContract;

#[contractimpl]
impl NoLossAuctionContract {
    pub fn initialize(e: Env, admin: Address) {
        if e.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        e.storage().instance().set(&DataKey::Admin, &admin);
        e.storage().instance().set(&DataKey::AuctionCount, &0_u32);
    }

    pub fn create_auction(
        e: Env,
        creator: Address,
        token: Address,
        min_bid: i128,
        duration: u64,
    ) -> u32 {
        creator.require_auth();

        if min_bid <= 0 {
            panic!("minimum bid must be greater than zero");
        }

        let mut count: u32 = e.storage().instance().get(&DataKey::AuctionCount).unwrap_or(0);
        count += 1;
        e.storage().instance().set(&DataKey::AuctionCount, &count);

        let deadline = e.ledger().timestamp() + duration;

        let auction = Auction {
            id: count,
            creator: creator.clone(),
            token,
            min_bid,
            highest_bidder: None,
            highest_bid: 0,
            deadline,
            finalized: false,
        };

        e.storage().persistent().set(&DataKey::Auction(count), &auction);
        count
    }

    pub fn get_auction(e: Env, auction_id: u32) -> Auction {
        e.storage()
            .persistent()
            .get(&DataKey::Auction(auction_id))
            .expect("auction not found")
    }

    pub fn bid(e: Env, auction_id: u32, bidder: Address, amount: i128) {
        bidder.require_auth();

        let mut auction = Self::get_auction(e.clone(), auction_id);

        if auction.finalized {
            panic!("auction is finalized");
        }

        let now = e.ledger().timestamp();
        if now >= auction.deadline {
            panic!("auction has ended");
        }

        // Validate bid amount
        if auction.highest_bidder.is_none() {
            if amount < auction.min_bid {
                panic!("bid must be at least minimum bid");
            }
        } else {
            if amount <= auction.highest_bid {
                panic!("bid must be higher than current highest bid");
            }
        }

        let token_client = token::Client::new(&e, &auction.token);

        // Refund previous highest bidder if one exists
        if let Some(prev_bidder) = auction.highest_bidder {
            token_client.transfer(
                &e.current_contract_address(),
                &prev_bidder,
                &auction.highest_bid,
            );
        }

        // Transfer new bid to contract
        token_client.transfer(&bidder, &e.current_contract_address(), &amount);

        // Update auction state
        auction.highest_bidder = Some(bidder);
        auction.highest_bid = amount;

        e.storage().persistent().set(&DataKey::Auction(auction_id), &auction);
    }

    pub fn finalize_auction(e: Env, auction_id: u32) {
        let mut auction = Self::get_auction(e.clone(), auction_id);

        if auction.finalized {
            panic!("auction is already finalized");
        }

        let now = e.ledger().timestamp();
        if now < auction.deadline {
            panic!("auction has not ended yet");
        }

        if let Some(_) = auction.highest_bidder {
            let token_client = token::Client::new(&e, &auction.token);
            token_client.transfer(
                &e.current_contract_address(),
                &auction.creator,
                &auction.highest_bid,
            );
        }

        auction.finalized = true;
        e.storage().persistent().set(&DataKey::Auction(auction_id), &auction);
    }

    pub fn cancel_auction(e: Env, auction_id: u32) {
        let mut auction = Self::get_auction(e.clone(), auction_id);

        auction.creator.require_auth();

        if auction.finalized {
            panic!("auction is already finalized");
        }

        if auction.highest_bidder.is_some() {
            panic!("cannot cancel auction with bids");
        }

        auction.finalized = true;
        e.storage().persistent().set(&DataKey::Auction(auction_id), &auction);
    }

    pub fn get_auction_count(e: Env) -> u32 {
        e.storage().instance().get(&DataKey::AuctionCount).unwrap_or(0)
    }
}

mod test;
