const ALCHEMY_API_KEY = import.meta.env.VITE_ALCHEMY_API_KEY;

// Bridge Configuration Constants
export const BRIDGE_CONFIG = {
  // Contract addresses on Ethereum mainnet
  X_RESERVE_CONTRACT: import.meta.env.VITE_X_RESERVE_CONTRACT,
  ETH_USDC_CONTRACT: import.meta.env.VITE_ETH_USDC_CONTRACT,

  // Stacks domain ID (constant for all networks)
  STACKS_DOMAIN: 10003,

  // Default RPC. Prefer the dedicated Alchemy endpoint when a key is
  // configured - eth.merkle.io rate-limits aggressively and doesn't send
  // CORS headers on its error responses (browsers report that as a generic
  // "CORS policy" failure), and public.node-style endpoints can still
  // throttle under real traffic. Falls back to publicnode if no key is set.
  ETH_RPC_URL: ALCHEMY_API_KEY
    ? `https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`
    : "https://ethereum.publicnode.com",

  // Chain info
  CHAIN_ID: 1, // Ethereum mainnet

  // Hermes protocol fee (CCTP v2 EVM leg only). See src/lib/cctp-fees.ts.
  // NOTE: this address is shared by BOTH EVM fee paths - the multichain leg
  // (customFee inside the burn) and the Ethereum->Stacks leg (separate
  // transfer). Clearing it disables fee collection on both.
  PROTOCOL_FEE_RECIPIENT_EVM: import.meta.env.VITE_PROTOCOL_FEE_RECIPIENT_EVM,
  PROTOCOL_FEE_RECIPIENT_STACKS: import.meta.env.VITE_PROTOCOL_FEE_RECIPIENT_STACKS,

  /**
   * Charge the Hermes fee on the Ethereum->Stacks leg?
   *
   * This leg is the odd one out. xReserve's `depositToRemote` has no
   * fee-recipient parameter, so unlike the multichain leg - where the fee
   * rides inside the burn for no extra gas - it needs a standalone USDC
   * transfer. On mainnet that transfer costs the user roughly $2-5 in gas to
   * collect a fee that is often a few cents, so it can cost far more than it
   * earns.
   *
   * Defaults to ENABLED, preserving existing behaviour - a deploy should not
   * silently stop collecting revenue. Set VITE_COLLECT_FEE_ETH_TO_STACKS=false
   * to drop the step. This flag affects ONLY this leg; multichain fee
   * collection is governed by PROTOCOL_FEE_RECIPIENT_EVM above and is
   * unaffected either way.
   */
  COLLECT_FEE_ETH_TO_STACKS:
    String(import.meta.env.VITE_COLLECT_FEE_ETH_TO_STACKS ?? "true").toLowerCase() !== "false",
} as const;

/**
 * Single source of truth for whether the Ethereum->Stacks leg charges the
 * Hermes fee. Both the payment (useBridge.payProtocolFee) and the UI - the
 * progress step, the quote preview and the balance check in BridgeForm - must
 * agree; if they drift, the form either bills for a step that never runs or
 * demands a balance the user does not need.
 */
export function shouldChargeEthToStacksFee(): boolean {
  return Boolean(
    BRIDGE_CONFIG.COLLECT_FEE_ETH_TO_STACKS && BRIDGE_CONFIG.PROTOCOL_FEE_RECIPIENT_EVM,
  );
}

// Contract ABIs
export const X_RESERVE_ABI = [
  {
    name: "depositToRemote",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "value", type: "uint256" },
      { name: "remoteDomain", type: "uint32" },
      { name: "remoteRecipient", type: "bytes32" },
      { name: "localToken", type: "address" },
      { name: "maxFee", type: "uint256" },
      { name: "hookData", type: "bytes" },
    ],
    outputs: [],
  },
] as const;

export const ERC20_ABI = [
  {
    name: "transfer",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "success", type: "bool" }],
  },
  {
    name: "approve",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "success", type: "bool" }],
  },
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "balance", type: "uint256" }],
  },
  {
    name: "allowance",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "remaining", type: "uint256" }],
  },
  {
    name: "decimals",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "decimals", type: "uint8" }],
  },
  {
    name: "symbol",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "symbol", type: "string" }],
  },
] as const;
