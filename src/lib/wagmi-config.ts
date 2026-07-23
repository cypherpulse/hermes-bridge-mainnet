import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { http, fallback } from 'viem';
import {
  mainnet,
  base,
  arbitrum,
  optimism,
  polygon,
  avalanche,
  linea,
  unichain,
} from 'wagmi/chains';
import { defineChain } from 'viem';
import { CCTP_CHAINS } from './multichain-bridge-config';

// WalletConnect Project ID - get yours at https://cloud.walletconnect.com
const projectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || 'YOUR_PROJECT_ID';

// Define World Chain mainnet (not in wagmi/chains yet)
const worldChain = defineChain({
  id: 480,
  name: 'World Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: [CCTP_CHAINS.World_Chain.rpcUrl] },
  },
  blockExplorers: {
    default: { name: 'World Chain Explorer', url: 'https://worldscan.org' },
  },
  testnet: false,
});

// Some default chain RPCs bundled by wagmi/chains (e.g. mainnet's default
// resolves to eth.merkle.io) rate-limit and drop CORS headers under real
// traffic. Point every chain explicitly at our vetted RPC + fallbacks
// (see CCTP_CHAINS in multichain-bridge-config.ts) instead of relying on
// library defaults.
function chainTransport(chainId: keyof typeof CCTP_CHAINS) {
  const chain = CCTP_CHAINS[chainId];
  return fallback([chain.rpcUrl, ...(chain.fallbackRpcUrls ?? [])].map((url) => http(url)));
}

export const config = getDefaultConfig({
  appName: 'Hermes Bridge',
  projectId,
  chains: [
    mainnet,
    base,
    arbitrum,
    optimism,
    polygon,
    avalanche,
    linea,
    unichain,
    worldChain,
  ],
  transports: {
    [mainnet.id]: chainTransport('Ethereum'),
    [base.id]: chainTransport('Base'),
    [arbitrum.id]: chainTransport('Arbitrum'),
    [optimism.id]: chainTransport('Optimism'),
    [polygon.id]: chainTransport('Polygon'),
    [avalanche.id]: chainTransport('Avalanche'),
    [linea.id]: chainTransport('Linea'),
    [unichain.id]: chainTransport('Unichain'),
    [worldChain.id]: chainTransport('World_Chain'),
  },
  ssr: false,
});
