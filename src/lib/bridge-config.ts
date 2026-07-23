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
  PROTOCOL_FEE_RECIPIENT_EVM: import.meta.env.VITE_PROTOCOL_FEE_RECIPIENT_EVM,
  PROTOCOL_FEE_RECIPIENT_STACKS: import.meta.env.VITE_PROTOCOL_FEE_RECIPIENT_STACKS,
} as const;

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
