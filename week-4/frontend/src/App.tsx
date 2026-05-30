import { useCallback, useEffect, useState } from "react";
import "./App.css";
import type { Auction } from "./soroban";
import {
	approveToken,
	cancelAuction,
	createAuction,
	finalizeAuction,
	getAuction,
	getAuctionCount,
	getConnectedAddress,
	getTokenBalance,
	placeBid,
} from "./soroban";

// A default contract address for the user, which they can also change in the UI
const DEFAULT_CONTRACT_ADDRESS =
	import.meta.env.VITE_CONTRACT_ADDRESS
const DEFAULT_TOKEN_ADDRESS =
	import.meta.env.VITE_TOKEN_ADDRESS

function App() {
	const [contractId, setContractId] = useState<string>(() => {
		return (
			localStorage.getItem("no_loss_auction_contract_id") ||
			DEFAULT_CONTRACT_ADDRESS
		);
	});

	const [tokenAddress, setTokenAddress] = useState<string>(() => {
		return (
			localStorage.getItem("no_loss_auction_token_address") ||
			DEFAULT_TOKEN_ADDRESS
		);
	});

	const [address, setAddress] = useState<string | null>(null);
	const [walletBalance, setWalletBalance] = useState<bigint>(0n);
	const [auctions, setAuctions] = useState<Auction[]>([]);
	const [loading, setLoading] = useState<boolean>(false);
	const [actionLoading, setActionLoading] = useState<string | null>(null);
	const [refreshTrigger, setRefreshTrigger] = useState<number>(0);
	const [currentTime, setCurrentTime] = useState<bigint>(() =>
		BigInt(Math.floor(Date.now() / 1000)),
	);

	// Messages
	const [error, setError] = useState<string | null>(null);
	const [success, setSuccess] = useState<string | null>(null);

	// New Auction Form State
	const [newMinBid, setNewMinBid] = useState<string>("100");
	const [newDuration, setNewDuration] = useState<string>("3600"); // in seconds

	// Bid State per Auction ID
	const [bidAmounts, setBidAmounts] = useState<{ [key: number]: string }>({});

	const triggerRefresh = useCallback(() => {
		setRefreshTrigger((prev) => prev + 1);
	}, []);

	useEffect(() => {
		localStorage.setItem("no_loss_auction_contract_id", contractId);
	}, [contractId]);

	useEffect(() => {
		localStorage.setItem("no_loss_auction_token_address", tokenAddress);
	}, [tokenAddress]);

	// Keep time ticking live
	useEffect(() => {
		const timer = setInterval(() => {
			setCurrentTime(BigInt(Math.floor(Date.now() / 1000)));
		}, 1000);
		return () => clearInterval(timer);
	}, []);

	// Auto-connect wallet on mount
	useEffect(() => {
		let active = true;
		const init = async () => {
			const connectedAddress = await getConnectedAddress();
			if (active && connectedAddress) {
				setAddress(connectedAddress);
			}
		};
		init();
		return () => {
			active = false;
		};
	}, []);

	const refreshData = useCallback(async () => {
		if (!contractId) return;
		setLoading(true);
		setError(null);
		try {
			// 1. Get token balance if wallet connected
			if (address && tokenAddress) {
				const bal = await getTokenBalance(tokenAddress, address);
				setWalletBalance(bal);
			}

			// 2. Fetch auctions
			const count = await getAuctionCount(contractId);
			const fetchedAuctions: Auction[] = [];
			for (let i = 1; i <= count; i++) {
				const auction = await getAuction(contractId, i);
				if (auction) {
					fetchedAuctions.push(auction);
				}
			}
			// Order by newest first
			setAuctions(fetchedAuctions.reverse());
		} catch (e: unknown) {
			console.error(e);
			const msg = e instanceof Error ? e.message : String(e);
			setError(`Failed to fetch data from Stellar network. Details: ${msg}`);
		} finally {
			setLoading(false);
		}
	}, [contractId, address, tokenAddress]);

	// Fetch data when wallet connected or contract changes
	useEffect(() => {
		let active = true;
		if (!contractId) return;

		// Reference refreshTrigger to make it a necessary dependency
		const _trigger = refreshTrigger;

		const load = async () => {
			// Yield execution to avoid synchronous state updates in the render/commit phase
			await Promise.resolve();
			if (active && _trigger !== undefined) {
				refreshData();
			}
		};
		load();

		return () => {
			active = false;
		};
	}, [contractId, refreshTrigger, refreshData]);

	async function connectWallet() {
		setLoading(true);
		setError(null);
		try {
			// Freighter request
			const connectedAddress = await getConnectedAddress();
			if (connectedAddress) {
				setAddress(connectedAddress);
				setSuccess("Wallet connected successfully!");
			} else {
				throw new Error("Freighter wallet connection failed or rejected.");
			}
		} catch (e: unknown) {
			const msg = e instanceof Error ? e.message : String(e);
			setError(msg || "Failed to connect Freighter wallet.");
		} finally {
			setLoading(false);
		}
	}

	async function handleCreateAuction(e: React.FormEvent) {
		e.preventDefault();
		if (!address) {
			setError("Please connect your Freighter wallet first.");
			return;
		}
		setError(null);
		setSuccess(null);
		setActionLoading("create");

		try {
			const minBidBig = BigInt(newMinBid);
			const durationNum = parseInt(newDuration, 10);

			if (minBidBig <= 0n) throw new Error("Minimum bid must be positive.");
			if (durationNum <= 0) throw new Error("Duration must be positive.");

			const txHash = await createAuction(
				contractId,
				address,
				tokenAddress,
				minBidBig,
				durationNum,
			);

			setSuccess(
				`Auction created successfully! Tx Hash: ${txHash.substring(0, 10)}...`,
			);
			triggerRefresh();
		} catch (err: unknown) {
			console.error(err);
			const msg = err instanceof Error ? err.message : String(err);
			setError(msg || "Failed to create auction.");
		} finally {
			setActionLoading(null);
		}
	}

	async function handlePlaceBid(
		auctionId: number,
		minBid: bigint,
		currentHighestBid: bigint,
	) {
		if (!address) {
			setError("Please connect your Freighter wallet first.");
			return;
		}
		setError(null);
		setSuccess(null);
		setActionLoading(`bid-${auctionId}`);

		try {
			const amountStr = bidAmounts[auctionId];
			if (!amountStr) throw new Error("Please enter a bid amount.");

			const amount = BigInt(amountStr);
			const requiredMin =
				currentHighestBid > 0n ? currentHighestBid + 1n : minBid;

			if (amount < requiredMin) {
				throw new Error(
					`Bid must be at least ${requiredMin.toString()} tokens.`,
				);
			}

			// Step 1: Approve token transfer (Stellar Soroban contracts require allowance for tokens)
			setSuccess("Awaiting approval for token spend...");
			const approveTxHash = await approveToken(
				tokenAddress,
				address,
				contractId,
				amount,
				9999999, // high expiration ledger or custom
			);
			console.log("Token approved. Tx:", approveTxHash);

			// Step 2: Place Bid
			setSuccess("Token approved! Placing bid...");
			const txHash = await placeBid(contractId, address, auctionId, amount);

			setSuccess(
				`Bid placed successfully! Tx Hash: ${txHash.substring(0, 10)}...`,
			);
			// Clear bid input
			setBidAmounts((prev) => ({ ...prev, [auctionId]: "" }));
			triggerRefresh();
		} catch (err: unknown) {
			console.error(err);
			const msg = err instanceof Error ? err.message : String(err);
			setError(msg || "Failed to place bid.");
		} finally {
			setActionLoading(null);
		}
	}

	async function handleFinalizeAuction(auctionId: number) {
		if (!address) {
			setError("Please connect your Freighter wallet first.");
			return;
		}
		setError(null);
		setSuccess(null);
		setActionLoading(`finalize-${auctionId}`);

		try {
			const txHash = await finalizeAuction(contractId, address, auctionId);
			setSuccess(
				`Auction finalized successfully! Tx Hash: ${txHash.substring(0, 10)}...`,
			);
			triggerRefresh();
		} catch (err: unknown) {
			console.error(err);
			const msg = err instanceof Error ? err.message : String(err);
			setError(msg || "Failed to finalize auction.");
		} finally {
			setActionLoading(null);
		}
	}

	async function handleCancelAuction(auctionId: number) {
		if (!address) {
			setError("Please connect your Freighter wallet first.");
			return;
		}
		setError(null);
		setSuccess(null);
		setActionLoading(`cancel-${auctionId}`);

		try {
			const txHash = await cancelAuction(contractId, address, auctionId);
			setSuccess(
				`Auction cancelled successfully! Tx Hash: ${txHash.substring(0, 10)}...`,
			);
			triggerRefresh();
		} catch (err: unknown) {
			console.error(err);
			const msg = err instanceof Error ? err.message : String(err);
			setError(msg || "Failed to cancel auction.");
		} finally {
			setActionLoading(null);
		}
	}

	const isExpired = (deadline: bigint) => {
		return currentTime >= deadline;
	};

	const getRemainingTime = (deadline: bigint) => {
		const diff = deadline - currentTime;
		if (diff <= 0n) return "Ended";

		const sec = Number(diff % 60n);
		const min = Number((diff / 60n) % 60n);
		const hr = Number(diff / 3600n);

		return `${hr}h ${min}m ${sec}s`;
	};

	return (
		<div className="App">
			{/* Header */}
			<header className="app-header glass-panel">
				<div className="app-title-container">
					<div className="logo-icon">
						<svg
							width="24"
							height="24"
							viewBox="0 0 24 24"
							fill="none"
							stroke="#fff"
							strokeWidth="2.5"
							strokeLinecap="round"
							strokeLinejoin="round"
						>
							<title>Gavel Logo</title>
							<path d="m15 5 4 4" />
							<path d="M21.5 2.5a2.12 2.12 0 0 1 3 3L7 23H3v-4L18.5 3.5Z" />
							<path d="m9 11 4 4" />
							<path d="m5 15 4 4" />
						</svg>
					</div>
					<div className="logo-text">AETHER AUCTION</div>
				</div>

				{address ? (
					<div className="wallet-badge">
						<svg
							width="18"
							height="18"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2"
							strokeLinecap="round"
							strokeLinejoin="round"
						>
							<title>Wallet Icon</title>
							<rect width="20" height="14" x="2" y="5" rx="2" />
							<line x1="2" x2="22" y1="10" y2="10" />
						</svg>
						<span className="wallet-address">{address}</span>
					</div>
				) : (
					<button
						type="button"
						className="premium-btn btn-primary"
						onClick={connectWallet}
						disabled={loading}
					>
						Connect Wallet
					</button>
				)}
			</header>

			{/* Hero */}
			<section className="hero-section">
				<div className="hero-glow"></div>
				<h1 className="hero-title">
					Soroban <span className="gradient-text">No-Loss</span> Auction
					Protocol
				</h1>
				<p className="hero-subtitle">
					Bid on premium auctions securely. If you are outbid, your tokens are
					automatically refunded instantly. No fees, no risk.
				</p>
			</section>

			{/* Top Banner notifications */}
			{error && (
				<div className="error-message glass-panel">
					<strong>Error:</strong> {error}
				</div>
			)}
			{success && (
				<div className="success-message glass-panel">
					<strong>Success:</strong> {success}
				</div>
			)}

			{/* Global Config Section */}
			<section className="config-bar glass-panel">
				<div className="input-group">
					<label htmlFor="contract-id-input" className="input-label">
						Auction Contract Address (Soroban)
					</label>
					<input
						id="contract-id-input"
						type="text"
						className="premium-input"
						value={contractId}
						onChange={(e) => setContractId(e.target.value)}
						placeholder="Enter smart contract address..."
					/>
				</div>
				<div className="input-group">
					<label htmlFor="token-address-input" className="input-label">
						SEP-41 Token Address
					</label>
					<input
						id="token-address-input"
						type="text"
						className="premium-input"
						value={tokenAddress}
						onChange={(e) => setTokenAddress(e.target.value)}
						placeholder="Enter bidding token address..."
					/>
				</div>
				<div style={{ display: "flex", alignItems: "flex-end", gap: "10px" }}>
					<button
						type="button"
						className="premium-btn btn-secondary"
						onClick={refreshData}
						disabled={loading}
					>
						{loading ? <div className="loading-spinner" /> : "Sync Data"}
					</button>
				</div>
			</section>

			{/* Balance Indicator */}
			{address && (
				<div
					style={{
						display: "flex",
						justifyContent: "flex-end",
						marginBottom: "20px",
						gap: "15px",
					}}
				>
					<span style={{ color: "var(--text-secondary)" }}>
						Wallet Balance:{" "}
						<strong style={{ color: "#fff" }}>
							{walletBalance.toString()} TOKENS
						</strong>
					</span>
				</div>
			)}

			{/* Main Grid */}
			<div className="dashboard-grid">
				{/* Active Auctions */}
				<main className="auction-list-section">
					<div className="section-header">
						<h2 className="section-title">
							<svg
								width="20"
								height="20"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth="2"
								strokeLinecap="round"
								strokeLinejoin="round"
							>
								<title>Clock Icon</title>
								<circle cx="12" cy="12" r="10" />
								<polyline points="12 6 12 12 16 14" />
							</svg>
							Live Auctions
						</h2>
					</div>

					{auctions.length === 0 ? (
						<div className="empty-state glass-panel">
							<svg
								width="48"
								height="48"
								viewBox="0 0 24 24"
								fill="none"
								stroke="var(--text-muted)"
								strokeWidth="1.5"
								strokeLinecap="round"
								strokeLinejoin="round"
							>
								<title>Alert Icon</title>
								<circle cx="12" cy="12" r="10" />
								<line x1="8" x2="16" y1="12" y2="12" />
							</svg>
							<div className="empty-title">No Auctions Found</div>
							<div className="empty-desc">
								There are currently no auctions registered on this contract
								address. Create the first one!
							</div>
						</div>
					) : (
						<div className="auction-grid">
							{auctions.map((auction) => {
								const ended = isExpired(auction.deadline);
								const hasBids = auction.highest_bidder !== null;
								const userIsCreator =
									address &&
									auction.creator.toLowerCase() === address.toLowerCase();

								let statusText = "Active";
								let statusClass = "status-active";

								if (auction.finalized) {
									statusText = "Finalized";
									statusClass = "status-finalized";
								} else if (ended) {
									statusText = "Ended";
									statusClass = "status-ended";
								}

								return (
									<div key={auction.id} className="auction-card glass-panel">
										<div className="auction-card-header">
											<span className="auction-id-badge">
												Auction #{auction.id}
											</span>
											<span className={`auction-status ${statusClass}`}>
												{statusText}
											</span>
										</div>

										<div className="auction-card-body">
											<div className="info-block">
												<span className="info-label">Current Bid</span>
												<span className="info-value info-value-accent">
													{auction.highest_bid > 0n
														? `${auction.highest_bid.toString()} TOKENS`
														: "No bids yet"}
												</span>
											</div>
											<div className="info-block">
												<span className="info-label">Min Bid</span>
												<span className="info-value">
													{auction.min_bid.toString()} TOKENS
												</span>
											</div>
											<div className="info-block">
												<span className="info-label">Highest Bidder</span>
												<span
													className="info-value"
													style={{
														fontSize: "14px",
														fontFamily: "var(--mono)",
													}}
												>
													{auction.highest_bidder
														? `${auction.highest_bidder.substring(0, 8)}...${auction.highest_bidder.substring(50)}`
														: "None"}
												</span>
											</div>
											<div className="info-block">
												<span className="info-label">Time Remaining</span>
												<span
													className="info-value"
													style={{
														color: ended ? "var(--text-muted)" : "#10b981",
													}}
												>
													{getRemainingTime(auction.deadline)}
												</span>
											</div>
										</div>

										<div className="auction-card-footer">
											<div style={{ textAlign: "left" }}>
												<span
													style={{
														fontSize: "11px",
														color: "var(--text-muted)",
														display: "block",
													}}
												>
													Creator:{" "}
													<code style={{ fontSize: "10px" }}>
														{auction.creator.substring(0, 6)}...
														{auction.creator.substring(50)}
													</code>
												</span>
												<span
													style={{
														fontSize: "11px",
														color: "var(--text-muted)",
														display: "block",
													}}
												>
													Token:{" "}
													<code style={{ fontSize: "10px" }}>
														{auction.token.substring(0, 6)}...
														{auction.token.substring(50)}
													</code>
												</span>
											</div>

											{/* Action buttons based on auction state */}
											{!auction.finalized && !ended && (
												<div className="bid-input-container">
													<input
														type="number"
														className="premium-input"
														style={{ flexGrow: 1 }}
														placeholder={`Min ${auction.highest_bid > 0n ? (auction.highest_bid + 1n).toString() : auction.min_bid.toString()}`}
														value={bidAmounts[auction.id] || ""}
														onChange={(e) =>
															setBidAmounts({
																...bidAmounts,
																[auction.id]: e.target.value,
															})
														}
														disabled={actionLoading !== null}
													/>
													<button
														type="button"
														className="premium-btn btn-primary"
														onClick={() =>
															handlePlaceBid(
																auction.id,
																auction.min_bid,
																auction.highest_bid,
															)
														}
														disabled={actionLoading !== null}
													>
														{actionLoading === `bid-${auction.id}` ? (
															<div className="loading-spinner" />
														) : (
															"Bid"
														)}
													</button>
												</div>
											)}

											{!auction.finalized && ended && (
												<button
													type="button"
													className="premium-btn btn-success"
													onClick={() => handleFinalizeAuction(auction.id)}
													disabled={actionLoading !== null}
												>
													{actionLoading === `finalize-${auction.id}` ? (
														<div className="loading-spinner" />
													) : (
														"Finalize Auction"
													)}
												</button>
											)}

											{!auction.finalized && !hasBids && userIsCreator && (
												<button
													type="button"
													className="premium-btn btn-danger"
													onClick={() => handleCancelAuction(auction.id)}
													disabled={actionLoading !== null}
												>
													{actionLoading === `cancel-${auction.id}` ? (
														<div className="loading-spinner" />
													) : (
														"Cancel Auction"
													)}
												</button>
											)}
										</div>
									</div>
								);
							})}
						</div>
					)}
				</main>

				{/* Sidebar Creation Panel */}
				<aside className="sidebar-panel glass-panel">
					<h2 className="form-title">Create Auction</h2>

					<form
						onSubmit={handleCreateAuction}
						style={{ display: "flex", flexDirection: "column", gap: "20px" }}
					>
						<div className="form-group">
							<label htmlFor="min-bid-input" className="input-label">
								Minimum Bid (TOKENS)
							</label>
							<input
								id="min-bid-input"
								type="number"
								className="premium-input"
								value={newMinBid}
								onChange={(e) => setNewMinBid(e.target.value)}
								required
								disabled={actionLoading !== null}
							/>
						</div>

						<div className="form-group">
							<label htmlFor="duration-select" className="input-label">
								Duration
							</label>
							<div className="select-container">
								<select
									id="duration-select"
									className="premium-select"
									value={newDuration}
									onChange={(e) => setNewDuration(e.target.value)}
									disabled={actionLoading !== null}
								>
									<option value="60">1 Minute (Testing)</option>
									<option value="300">5 Minutes (Testing)</option>
									<option value="3600">1 Hour</option>
									<option value="86400">1 Day</option>
									<option value="604800">1 Week</option>
								</select>
							</div>
						</div>

						<button
							type="submit"
							className="premium-btn btn-primary"
							style={{ width: "100%" }}
							disabled={actionLoading !== null || !address}
						>
							{actionLoading === "create" ? (
								<div className="loading-spinner" />
							) : (
								"Launch Auction"
							)}
						</button>
						{!address && (
							<span
								style={{
									fontSize: "12px",
									color: "var(--text-muted)",
									textAlign: "center",
								}}
							>
								Connect wallet to launch auctions
							</span>
						)}
					</form>
				</aside>
			</div>
		</div>
	);
}

export default App;
