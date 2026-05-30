# Week 4: No-Loss Auction Protocol

A decentralized, no-loss auction system built on Stellar using Soroban smart contracts, featuring a fully integrated React + TypeScript frontend.

## Deployed Contract Info (Stellar Testnet)

- **No-Loss Auction Contract ID**: `CBOQWYTGUX6F2SWE5QXIFIMHTX7TQ4OFT2ZLSWBGYY5JSCXWALGFBA7D`
- **Mock Bidding SEP-41 Token ID**: `CDYOVO7YULJ3R5ABLMKYPDO2FG2IILWHTCFFLHOTOGCVFV734T26DX3R`

## Features

1. **Create Auction**: Anyone can set up an auction by specifying a minimum bid and duration.
2. **Place Bids**: Bidders place bids using the designated SEP-41 token. The smart contract acts as an escrow.
3. **Refunding Bidders**: If a bidder is outbid, their tokens are automatically refunded to them instantly.
4. **Finalize Auction**: Once the auction deadline passes, anyone can finalize the auction, causing the winning bid amount to be transferred to the creator.
5. **Cancel Auction**: The creator can cancel the auction, but only if no bids have been placed yet.

## Folder Structure

- `contracts/no-loss-auction/`: Soroban smart contract source code and unit tests.
- `frontend/`: React + Vite + TypeScript frontend.

## Getting Started

### Smart Contract

To run unit tests:
```bash
cargo test
```

To build the contract WASM:
```bash
stellar contract build
```

### Frontend

To run the frontend locally:
```bash
cd frontend
npm install
npm run dev
```

Ensure you have the [Freighter Wallet](https://www.freighter.app/) extension installed and switched to the **Testnet** network.
You can mint mock tokens using the deployer account or approve them directly on the frontend.
