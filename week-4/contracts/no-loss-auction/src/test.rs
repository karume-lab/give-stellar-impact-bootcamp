#![cfg(test)]
extern crate std;

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    Address, Env,
};

// Mock token contract that matches the SDK's token client interface
#[contract]
pub struct MockToken;

#[contractimpl]
impl MockToken {
    pub fn transfer(e: Env, from: Address, to: Address, amount: i128) {
        from.require_auth();
        
        let mut balance_from: i128 = e.storage().persistent().get(&from).unwrap_or(0);
        let mut balance_to: i128 = e.storage().persistent().get(&to).unwrap_or(0);
        
        if balance_from < amount {
            panic!("insufficient balance");
        }
        
        balance_from -= amount;
        balance_to += amount;
        
        e.storage().persistent().set(&from, &balance_from);
        e.storage().persistent().set(&to, &balance_to);
    }

    pub fn mint(e: Env, to: Address, amount: i128) {
        let mut balance: i128 = e.storage().persistent().get(&to).unwrap_or(0);
        balance += amount;
        e.storage().persistent().set(&to, &balance);
    }

    pub fn balance(e: Env, id: Address) -> i128 {
        e.storage().persistent().get(&id).unwrap_or(0)
    }
}

struct TestContext<'a> {
    env: Env,
    _admin: Address,
    creator: Address,
    bidder1: Address,
    bidder2: Address,
    token_address: Address,
    token_client: MockTokenClient<'a>,
    contract_client: NoLossAuctionContractClient<'a>,
}

fn setup() -> TestContext<'static> {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let creator = Address::generate(&env);
    let bidder1 = Address::generate(&env);
    let bidder2 = Address::generate(&env);

    // Register mock token
    let token_address = env.register(MockToken, ());
    let token_client = MockTokenClient::new(&env, &token_address);

    // Mint tokens
    token_client.mint(&bidder1, &1000);
    token_client.mint(&bidder2, &1000);

    // Register auction contract
    let contract_address = env.register(NoLossAuctionContract, ());
    let contract_client = NoLossAuctionContractClient::new(&env, &contract_address);
    contract_client.initialize(&admin);

    TestContext {
        env,
        _admin: admin,
        creator,
        bidder1,
        bidder2,
        token_address,
        token_client,
        contract_client,
    }
}

#[test]
fn test_initialize() {
    let ctx = setup();
    assert_eq!(ctx.contract_client.get_auction_count(), 0);
}

#[test]
fn test_create_auction() {
    let ctx = setup();
    let min_bid = 100_i128;
    let duration = 3600_u64;

    let auction_id = ctx.contract_client.create_auction(
        &ctx.creator,
        &ctx.token_address,
        &min_bid,
        &duration,
    );

    assert_eq!(auction_id, 1);
    assert_eq!(ctx.contract_client.get_auction_count(), 1);

    let auction = ctx.contract_client.get_auction(&auction_id);
    assert_eq!(auction.id, 1);
    assert_eq!(auction.creator, ctx.creator);
    assert_eq!(auction.token, ctx.token_address);
    assert_eq!(auction.min_bid, min_bid);
    assert_eq!(auction.highest_bidder, None);
    assert_eq!(auction.highest_bid, 0);
    assert_eq!(auction.finalized, false);
    assert_eq!(auction.deadline, ctx.env.ledger().timestamp() + duration);
}

#[test]
fn test_bidding_and_refunds() {
    let ctx = setup();
    let min_bid = 100_i128;
    let duration = 3600_u64;

    let auction_id = ctx.contract_client.create_auction(
        &ctx.creator,
        &ctx.token_address,
        &min_bid,
        &duration,
    );

    // Bidder 1 places bid of 100
    ctx.contract_client.bid(&auction_id, &ctx.bidder1, &100);
    
    // Check state
    let auction = ctx.contract_client.get_auction(&auction_id);
    assert_eq!(auction.highest_bidder, Some(ctx.bidder1.clone()));
    assert_eq!(auction.highest_bid, 100);
    assert_eq!(ctx.token_client.balance(&ctx.bidder1), 900);
    assert_eq!(ctx.token_client.balance(&ctx.contract_client.address), 100);

    // Bidder 2 outbids with 150
    ctx.contract_client.bid(&auction_id, &ctx.bidder2, &150);

    // Check state: bidder 1 refunded, bidder 2 is highest
    let auction = ctx.contract_client.get_auction(&auction_id);
    assert_eq!(auction.highest_bidder, Some(ctx.bidder2.clone()));
    assert_eq!(auction.highest_bid, 150);
    
    assert_eq!(ctx.token_client.balance(&ctx.bidder1), 1000); // Refunded!
    assert_eq!(ctx.token_client.balance(&ctx.bidder2), 850);
    assert_eq!(ctx.token_client.balance(&ctx.contract_client.address), 150);
}

#[test]
fn test_finalize_auction() {
    let ctx = setup();
    let min_bid = 100_i128;
    let duration = 3600_u64;

    let auction_id = ctx.contract_client.create_auction(
        &ctx.creator,
        &ctx.token_address,
        &min_bid,
        &duration,
    );

    ctx.contract_client.bid(&auction_id, &ctx.bidder1, &200);

    // Fast forward ledger time past deadline
    ctx.env.ledger().set_timestamp(ctx.env.ledger().timestamp() + duration + 1);

    ctx.contract_client.finalize_auction(&auction_id);

    // Check state
    let auction = ctx.contract_client.get_auction(&auction_id);
    assert!(auction.finalized);
    assert_eq!(ctx.token_client.balance(&ctx.creator), 200); // Creator gets bid
    assert_eq!(ctx.token_client.balance(&ctx.contract_client.address), 0);
}

#[test]
fn test_cancel_auction() {
    let ctx = setup();
    let min_bid = 100_i128;
    let duration = 3600_u64;

    let auction_id = ctx.contract_client.create_auction(
        &ctx.creator,
        &ctx.token_address,
        &min_bid,
        &duration,
    );

    // Cancel auction before any bids
    ctx.contract_client.cancel_auction(&auction_id);

    let auction = ctx.contract_client.get_auction(&auction_id);
    assert!(auction.finalized);
}

#[test]
#[should_panic(expected = "cannot cancel auction with bids")]
fn test_cancel_fails_with_bids() {
    let ctx = setup();
    let min_bid = 100_i128;
    let duration = 3600_u64;

    let auction_id = ctx.contract_client.create_auction(
        &ctx.creator,
        &ctx.token_address,
        &min_bid,
        &duration,
    );

    ctx.contract_client.bid(&auction_id, &ctx.bidder1, &100);

    // This should panic
    ctx.contract_client.cancel_auction(&auction_id);
}
