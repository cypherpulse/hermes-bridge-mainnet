import { createAppKit } from '@reown/appkit/react'
import { WagmiAdapter } from '@reown/appkit-adapter-wagmi'
import {
  mainnet,
  base,
  arbitrum,
  optimism,
  polygon,
  avalanche,
  linea,
} from '@reown/appkit/networks'
import { defineChain } from 'viem'

// Define Unichain mainnet (not in @reown/appkit/networks yet)
const unichain = defineChain({
  id: 130,
  name: 'Unichain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://mainnet.unichain.org'] } },
  blockExplorers: { default: { name: 'Uniscan', url: 'https://uniscan.xyz' } },
  testnet: false,
});

// Define World Chain mainnet (not in @reown/appkit/networks yet)
const worldChain = defineChain({
  id: 480,
  name: 'World Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://worldchain-mainnet.g.alchemy.com/public'] } },
  blockExplorers: { default: { name: 'World Chain Explorer', url: 'https://worldscan.org' } },
  testnet: false,
});


const projectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID

if (!projectId) {
  throw new Error('VITE_WALLETCONNECT_PROJECT_ID is not set in environment variables')
}

// Create the Wagmi adapter
const metadata = {
  name: 'Hermes Bridge',
  description: 'Cross-chain USDC bridge between Ethereum and Stacks',
  url: typeof window !== 'undefined' ? window.location.origin : 'https://hermes-bridge.vercel.app',
  icons: [
    typeof window !== 'undefined'
      ? `${window.location.origin}/logo.png`
      : 'https://hermes-bridge.vercel.app/logo.png'
  ]
}

// Define all supported mainnet chains
const networks = [
  mainnet,
  base,
  arbitrum,
  avalanche,
  optimism,
  polygon,
  linea,
  unichain,
  worldChain,
];

export const wagmiAdapter = new WagmiAdapter({
  ssr: false,
  projectId,
  networks,
})

export const appKit = createAppKit({
  adapters: [wagmiAdapter],
  networks: [
    mainnet,
    base,
    arbitrum,
    avalanche,
    optimism,
    polygon,
    linea,
    unichain,
    worldChain,
  ],
  defaultNetwork: mainnet,
  projectId,
  metadata,
  themeMode: 'dark',
  themeVariables: {
    '--apkt-font-family': '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  },
  features: {
    analytics: false,
    email: false,
    socials: false,
  },
  allowUnsupportedChain: false,
})

export type AppKit = typeof appKit
