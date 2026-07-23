/**
 * Multichain Bridge Configuration
 *
 * This configuration supports CCTP (Cross-Chain Transfer Protocol) bridging
 * between multiple chains via Ethereum as an intermediary to reach Stacks.
 *
 * Flow: Source Chain → Ethereum (CCTP) → Stacks (xReserve)
 */

export type CCTPChainId =
  | 'Ethereum'
  | 'Base'
  | 'Arbitrum'
  | 'Avalanche'
  | 'Optimism'
  | 'Polygon'
  | 'Linea'
  | 'Unichain'
  | 'World_Chain';

const ALCHEMY_API_KEY = import.meta.env.VITE_ALCHEMY_API_KEY;

/**
 * Dedicated Alchemy RPC when a key is configured (reliable CORS + rate
 * limits, unlike official public endpoints such as mainnet.base.org or
 * eth.merkle.io which throttle under real dapp traffic). Falls back to the
 * given public URL as the primary if no key is set, so the app still works
 * without one.
 */
function alchemyRpc(subdomain: string, publicFallback: string): string {
  return ALCHEMY_API_KEY
    ? `https://${subdomain}.g.alchemy.com/v2/${ALCHEMY_API_KEY}`
    : publicFallback;
}

export interface CCTPChainConfig {
  id: CCTPChainId;
  name: string;
  displayName: string;
  chainId: number;
  icon: string;
  rpcUrl: string;
  /**
   * Backup public RPCs tried in order if `rpcUrl` fails or rate-limits a
   * balance read - official chain-foundation endpoints (e.g. mainnet.base.org)
   * are documented as not meant for production dapp traffic and throttle
   * under real usage, which was silently reading back as a zero balance.
   */
  fallbackRpcUrls?: string[];
  blockExplorer: string;
  usdcAddress: `0x${string}`;
  isTestnet: boolean;
  color: string;
  /**
   * Circle CCTP domain ID for this chain (stable across mainnet/testnet).
   * Used for CCTP v2 fee quotes and attestation lookups.
   * https://developers.circle.com/cctp/references/contract-addresses
   */
  domain: number;
}

// Supported CCTP mainnet chains for Bridge Kit.
// Contract addresses cross-verified against @circle-fin/bridge-kit's own
// bundled chain data and live on-chain calls (see plan doc / session notes).
export const CCTP_CHAINS: Record<CCTPChainId, CCTPChainConfig> = {
  Ethereum: {
    id: 'Ethereum',
    name: 'Ethereum',
    displayName: 'Ethereum',
    chainId: 1,
    icon: 'https://res.cloudinary.com/dg5rr4ntw/image/upload/v1768900941/download_6_b0zu0z.png',
    // eth.merkle.io rate-limits aggressively and doesn't send CORS headers
    // on its error responses, which browsers surface as a generic "CORS
    // policy" failure - prefer the dedicated Alchemy endpoint when available.
    rpcUrl: alchemyRpc('eth-mainnet', 'https://ethereum.publicnode.com'),
    fallbackRpcUrls: ['https://ethereum.publicnode.com', 'https://cloudflare-eth.com'],
    blockExplorer: 'https://etherscan.io',
    usdcAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    isTestnet: false,
    color: '#627EEA',
    domain: 0,
  },
  Base: {
    id: 'Base',
    name: 'Base',
    displayName: 'Base',
    chainId: 8453,
    icon: 'https://res.cloudinary.com/dg5rr4ntw/image/upload/v1768900372/download_hfl3h3.png',
    rpcUrl: 'https://mainnet.base.org',
    fallbackRpcUrls: ['https://base.publicnode.com'],
    blockExplorer: 'https://basescan.org',
    usdcAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    isTestnet: false,
    color: '#0052FF',
    domain: 6,
  },
  Arbitrum: {
    id: 'Arbitrum',
    name: 'Arbitrum',
    displayName: 'Arbitrum',
    chainId: 42161,
    icon: 'https://res.cloudinary.com/dg5rr4ntw/image/upload/v1768900371/download_1_a5572s.png',
    rpcUrl: alchemyRpc('arb-mainnet', 'https://arb1.arbitrum.io/rpc'),
    fallbackRpcUrls: ['https://arb1.arbitrum.io/rpc', 'https://arbitrum-one.publicnode.com'],
    blockExplorer: 'https://arbiscan.io',
    usdcAddress: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    isTestnet: false,
    color: '#28A0F0',
    domain: 3,
  },
  Avalanche: {
    id: 'Avalanche',
    name: 'Avalanche',
    displayName: 'Avalanche',
    chainId: 43114,
    icon: 'https://res.cloudinary.com/dg5rr4ntw/image/upload/v1768900372/avalanche-avax-logo_nkju6o.png',
    rpcUrl: 'https://api.avax.network/ext/bc/C/rpc',
    fallbackRpcUrls: ['https://avalanche-c-chain.publicnode.com'],
    blockExplorer: 'https://snowtrace.io',
    usdcAddress: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E',
    isTestnet: false,
    color: '#E84142',
    domain: 1,
  },
  Optimism: {
    id: 'Optimism',
    name: 'OP Mainnet',
    displayName: 'Optimism',
    chainId: 10,
    icon: 'https://res.cloudinary.com/dg5rr4ntw/image/upload/v1768900371/download_2_sv0thd.png',
    rpcUrl: alchemyRpc('opt-mainnet', 'https://mainnet.optimism.io'),
    fallbackRpcUrls: ['https://mainnet.optimism.io', 'https://optimism.publicnode.com'],
    blockExplorer: 'https://optimistic.etherscan.io',
    usdcAddress: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
    isTestnet: false,
    color: '#FF0420',
    domain: 2,
  },
  Polygon: {
    id: 'Polygon',
    name: 'Polygon PoS',
    displayName: 'Polygon',
    chainId: 137,
    icon: 'https://res.cloudinary.com/dg5rr4ntw/image/upload/v1768900372/download_3_pnzwd3.png',
    rpcUrl: alchemyRpc('polygon-mainnet', 'https://polygon-rpc.com'),
    fallbackRpcUrls: ['https://polygon-rpc.com', 'https://polygon-bor.publicnode.com'],
    blockExplorer: 'https://polygonscan.com',
    usdcAddress: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
    isTestnet: false,
    color: '#8247E5',
    domain: 7,
  },
  Linea: {
    id: 'Linea',
    name: 'Linea',
    displayName: 'Linea',
    chainId: 59144,
    icon: 'https://res.cloudinary.com/dg5rr4ntw/image/upload/v1768900372/download_5_fwekae.png',
    rpcUrl: alchemyRpc('linea-mainnet', 'https://rpc.linea.build'),
    fallbackRpcUrls: ['https://rpc.linea.build', 'https://linea.publicnode.com'],
    blockExplorer: 'https://lineascan.build',
    usdcAddress: '0x176211869cA2b568f2A7D4EE941E073a821EE1ff',
    isTestnet: false,
    color: '#61DFFF',
    domain: 11,
  },
  Unichain: {
    id: 'Unichain',
    name: 'Unichain',
    displayName: 'Unichain',
    chainId: 130,
    icon: 'https://res.cloudinary.com/dg5rr4ntw/image/upload/v1768900372/download_ppknwm.jpg',
    rpcUrl: 'https://mainnet.unichain.org',
    fallbackRpcUrls: ['https://unichain.publicnode.com'],
    blockExplorer: 'https://uniscan.xyz',
    usdcAddress: '0x078D782b760474a361dDA0AF3839290b0EF57AD6',
    isTestnet: false,
    color: '#FF007A',
    domain: 10,
  },
  World_Chain: {
    id: 'World_Chain',
    name: 'World Chain',
    displayName: 'World Chain',
    chainId: 480,
    icon: 'https://res.cloudinary.com/dg5rr4ntw/image/upload/v1769169925/worldcoin_mvuyxj.jpg',
    rpcUrl: alchemyRpc('worldchain-mainnet', 'https://worldchain-mainnet.g.alchemy.com/public'),
    fallbackRpcUrls: ['https://worldchain-mainnet.g.alchemy.com/public', 'https://480.rpc.thirdweb.com'],
    blockExplorer: 'https://worldscan.org',
    usdcAddress: '0x79A02482A880bCE3F13e09Da970dC34db4CD24d1',
    isTestnet: false,
    color: '#FF6B35',
    domain: 14,
  },
} as const;

// Get chains excluding Ethereum (for source selection when going TO Stacks)
export const getSourceChains = (): CCTPChainConfig[] => {
  return Object.values(CCTP_CHAINS).filter(chain => chain.id !== 'Ethereum');
};

// Get all chains for EVM-to-EVM bridging
export const getAllChains = (): CCTPChainConfig[] => {
  return Object.values(CCTP_CHAINS);
};

// Get chain by ID
export const getChainById = (id: CCTPChainId): CCTPChainConfig | undefined => {
  return CCTP_CHAINS[id];
};

// Get chain by chainId (numeric)
export const getChainByChainId = (chainId: number): CCTPChainConfig | undefined => {
  return Object.values(CCTP_CHAINS).find(chain => chain.chainId === chainId);
};

// Bridge Kit chain name mapping (matches Bridge Kit's expected format)
export const BRIDGE_KIT_CHAIN_NAMES: Record<CCTPChainId, string> = {
  Ethereum: 'Ethereum',
  Base: 'Base',
  Arbitrum: 'Arbitrum',
  Avalanche: 'Avalanche',
  Optimism: 'Optimism',
  Polygon: 'Polygon',
  Linea: 'Linea',
  Unichain: 'Unichain',
  World_Chain: 'World Chain',
};

// Bridge step types
export type BridgeStepType = 'cctp' | 'xreserve';

export interface MultichainBridgeStep {
  type: BridgeStepType;
  fromChain: CCTPChainId;
  toChain: CCTPChainId | 'Stacks';
  status: 'pending' | 'in-progress' | 'completed' | 'failed';
  txHash?: string;
  explorerUrl?: string;
}

export interface MultichainBridgeResult {
  success: boolean;
  steps: MultichainBridgeStep[];
  totalSteps: number;
  currentStep: number;
  error?: string;
}

// Wagmi chain configurations
export const WAGMI_CHAIN_CONFIG = {
  Base: {
    id: 8453,
    name: 'Base',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: ['https://mainnet.base.org'] } },
    blockExplorers: { default: { name: 'BaseScan', url: 'https://basescan.org' } },
    testnet: false,
  },
  Arbitrum: {
    id: 42161,
    name: 'Arbitrum One',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: ['https://arb1.arbitrum.io/rpc'] } },
    blockExplorers: { default: { name: 'Arbiscan', url: 'https://arbiscan.io' } },
    testnet: false,
  },
  Avalanche: {
    id: 43114,
    name: 'Avalanche',
    nativeCurrency: { name: 'Avalanche', symbol: 'AVAX', decimals: 18 },
    rpcUrls: { default: { http: ['https://api.avax.network/ext/bc/C/rpc'] } },
    blockExplorers: { default: { name: 'Snowtrace', url: 'https://snowtrace.io' } },
    testnet: false,
  },
  Optimism: {
    id: 10,
    name: 'OP Mainnet',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: ['https://mainnet.optimism.io'] } },
    blockExplorers: { default: { name: 'Etherscan', url: 'https://optimistic.etherscan.io' } },
    testnet: false,
  },
  Polygon: {
    id: 137,
    name: 'Polygon',
    nativeCurrency: { name: 'POL', symbol: 'POL', decimals: 18 },
    rpcUrls: { default: { http: ['https://polygon-rpc.com'] } },
    blockExplorers: { default: { name: 'Polygonscan', url: 'https://polygonscan.com' } },
    testnet: false,
  },
  Linea: {
    id: 59144,
    name: 'Linea',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: ['https://rpc.linea.build'] } },
    blockExplorers: { default: { name: 'Lineascan', url: 'https://lineascan.build' } },
    testnet: false,
  },
  Unichain: {
    id: 130,
    name: 'Unichain',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: ['https://mainnet.unichain.org'] } },
    blockExplorers: { default: { name: 'Uniscan', url: 'https://uniscan.xyz' } },
    testnet: false,
  },
  World_Chain: {
    id: 480,
    name: 'World Chain',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: ['https://worldchain-mainnet.g.alchemy.com/public'] } },
    blockExplorers: { default: { name: 'World Chain Explorer', url: 'https://worldscan.org' } },
    testnet: false,
  },
} as const;

// ERC20 ABI for USDC balance/allowance
export const MULTICHAIN_ERC20_ABI = [
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: 'balance', type: 'uint256' }],
  },
  {
    name: 'allowance',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ name: 'remaining', type: 'uint256' }],
  },
  {
    name: 'approve',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: 'success', type: 'bool' }],
  },
  {
    name: 'decimals',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: 'decimals', type: 'uint8' }],
  },
] as const;
