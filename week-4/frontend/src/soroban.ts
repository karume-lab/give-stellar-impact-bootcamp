import { getAddress, signTransaction } from '@stellar/freighter-api';
import * as StellarSdk from '@stellar/stellar-sdk';

const RPC_URL = 'https://soroban-testnet.stellar.org';
export const server = new StellarSdk.rpc.Server(RPC_URL);
export const NETWORK_PASSPHRASE = 'Test SDF Network ; September 2015';

export interface Auction {
  id: number;
  creator: string;
  token: string;
  min_bid: bigint;
  highest_bidder: string | null;
  highest_bid: bigint;
  deadline: bigint;
  finalized: boolean;
}

// Convert address to ScVal
function addressToScVal(address: string): StellarSdk.xdr.ScVal {
  return StellarSdk.Address.fromString(address).toScVal();
}

// Get the connected wallet's address safely
export async function getConnectedAddress(): Promise<string | null> {
  try {
    const res = await getAddress();
    if (typeof res === 'string') {
      return res;
    }
    if (res?.address) {
      return res.address;
    }
    return null;
  } catch (error) {
    console.error('Error getting address from Freighter:', error);
    return null;
  }
}

// Read-only calls using simulateTransaction
async function simulateCall(
  contractId: string,
  method: string,
  args: StellarSdk.xdr.ScVal[] = []
): Promise<StellarSdk.xdr.ScVal | null> {
  const contract = new StellarSdk.Contract(contractId);
  
  // Create a dummy account to construct transaction
  const dummyAccount = new StellarSdk.Account('GANBGRJ6RHYW4HNF2M6C3T2XNW236Z6XFS2ZJQY2N3Q3P5R7Z7GTRV7N', '0');
  
  const tx = new StellarSdk.TransactionBuilder(dummyAccount, {
    fee: '100',
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(30)
    .build();

  const sim = await server.simulateTransaction(tx);
  
  if (StellarSdk.rpc.Api.isSimulationSuccess(sim)) {
    return sim.result?.retval || null;
  }
  
  console.error(`Simulation failed for ${method}:`, sim);
  return null;
}

export async function getAuctionCount(contractId: string): Promise<number> {
  try {
    const val = await simulateCall(contractId, 'get_auction_count');
    if (val) {
      const count = StellarSdk.scValToNative(val);
      return Number(count);
    }
  } catch (e) {
    console.error('Error fetching auction count:', e);
  }
  return 0;
}

export async function getAuction(contractId: string, id: number): Promise<Auction | null> {
  try {
    const arg = StellarSdk.nativeToScVal(id, { type: 'u32' });
    const val = await simulateCall(contractId, 'get_auction', [arg]);
    if (val) {
      const native = StellarSdk.scValToNative(val);
      return {
        id: Number(native.id),
        creator: native.creator,
        token: native.token,
        min_bid: native.min_bid,
        highest_bidder: native.highest_bidder || null,
        highest_bid: native.highest_bid,
        deadline: native.deadline,
        finalized: native.finalized,
      };
    }
  } catch (e) {
    console.error(`Error fetching auction ${id}:`, e);
  }
  return null;
}

// State-changing transactions
async function executeTransaction(
  contractId: string,
  sender: string,
  method: string,
  args: StellarSdk.xdr.ScVal[]
): Promise<string> {
  const contract = new StellarSdk.Contract(contractId);
  
  // 1. Fetch current sequence of sender account
  let account: StellarSdk.Account;
  try {
    const acc = await server.getAccount(sender);
    account = new StellarSdk.Account(sender, acc.sequenceNumber());
  } catch (_err) {
    const horizonUrl = 'https://horizon-testnet.stellar.org';
    const res = await fetch(`${horizonUrl}/accounts/${sender}`);
    if (!res.ok) {
      throw new Error(`Account ${sender} not found. Please fund it first.`, { cause: _err });
    }
    const data = await res.json();
    account = new StellarSdk.Account(sender, data.sequence);
  }

  // 2. Build tx
  let tx = new StellarSdk.TransactionBuilder(account, {
    fee: '100', // temporary fee, will be updated by assembleTransaction
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(180)
    .build();

  // 3. Simulate to get footprint & updated fee
  const sim = await server.simulateTransaction(tx);
  if (!StellarSdk.rpc.Api.isSimulationSuccess(sim)) {
    throw new Error(`Transaction simulation failed for ${method}: ${JSON.stringify(sim)}`);
  }

  // 4. Assemble tx
  tx = StellarSdk.rpc.assembleTransaction(tx, sim).build();

  // 5. Sign with Freighter
  const signResult = await signTransaction(tx.toXDR(), {
    networkPassphrase: NETWORK_PASSPHRASE,
  });
  const signedXdr = typeof signResult === 'string' ? signResult : signResult.signedTxXdr;

  // 6. Submit tx
  const signedTx = StellarSdk.TransactionBuilder.fromXDR(signedXdr, NETWORK_PASSPHRASE);
  const sendResponse = await server.sendTransaction(signedTx);
  
  if (sendResponse.status === 'ERROR') {
    throw new Error(`Send transaction failed: ${JSON.stringify(sendResponse.errorResult)}`);
  }

  // 7. Poll status
  let status: string = sendResponse.status;
  const txHash = sendResponse.hash;
  let attempts = 0;
  
  while (status === 'PENDING' && attempts < 10) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const txResult = await server.getTransaction(txHash);
    status = txResult.status;
    if (status === 'SUCCESS') {
      return txHash;
    }
    if (status === 'FAILED') {
      throw new Error(`Transaction failed: ${JSON.stringify(txResult)}`);
    }
    attempts++;
  }
  
  if (status === 'PENDING') {
    throw new Error('Transaction execution timed out.');
  }
  
  return txHash;
}

export async function createAuction(
  contractId: string,
  sender: string,
  token: string,
  minBid: bigint,
  durationSeconds: number
): Promise<string> {
  const args = [
    addressToScVal(sender),
    addressToScVal(token),
    StellarSdk.nativeToScVal(minBid, { type: 'i128' }),
    StellarSdk.nativeToScVal(durationSeconds, { type: 'u64' }),
  ];
  return executeTransaction(contractId, sender, 'create_auction', args);
}

export async function placeBid(
  contractId: string,
  sender: string,
  auctionId: number,
  amount: bigint
): Promise<string> {
  const args = [
    StellarSdk.nativeToScVal(auctionId, { type: 'u32' }),
    addressToScVal(sender),
    StellarSdk.nativeToScVal(amount, { type: 'i128' }),
  ];
  return executeTransaction(contractId, sender, 'bid', args);
}

export async function finalizeAuction(
  contractId: string,
  sender: string,
  auctionId: number
): Promise<string> {
  const args = [
    StellarSdk.nativeToScVal(auctionId, { type: 'u32' }),
  ];
  return executeTransaction(contractId, sender, 'finalize_auction', args);
}

export async function cancelAuction(
  contractId: string,
  sender: string,
  auctionId: number
): Promise<string> {
  const args = [
    StellarSdk.nativeToScVal(auctionId, { type: 'u32' }),
  ];
  return executeTransaction(contractId, sender, 'cancel_auction', args);
}

// Token Helper functions for testing
export async function getTokenBalance(tokenContractId: string, userAddress: string): Promise<bigint> {
  try {
    const val = await simulateCall(tokenContractId, 'balance', [addressToScVal(userAddress)]);
    if (val) {
      return BigInt(StellarSdk.scValToNative(val));
    }
  } catch (e) {
    console.error('Error fetching token balance:', e);
  }
  return 0n;
}

export async function approveToken(
  tokenContractId: string,
  sender: string,
  spender: string,
  amount: bigint,
  expirationLedger: number
): Promise<string> {
  const args = [
    addressToScVal(sender),
    addressToScVal(spender),
    StellarSdk.nativeToScVal(amount, { type: 'i128' }),
    StellarSdk.nativeToScVal(expirationLedger, { type: 'u32' }),
  ];
  return executeTransaction(tokenContractId, sender, 'approve', args);
}
