/**
 * Block explorer URLs for legs reported to hermes-server. Keyed by the same
 * chain identifiers used throughout this app (CCTPChainId, e.g. "World_Chain"
 * with an underscore) - not the human display name - since that's exactly
 * what gets stored in a leg's fromChain/toChain.
 */
const EVM_EXPLORERS: Record<string, string> = {
  Ethereum: 'https://etherscan.io',
  Base: 'https://basescan.org',
  Arbitrum: 'https://arbiscan.io',
  Avalanche: 'https://snowtrace.io',
  Optimism: 'https://optimistic.etherscan.io',
  Polygon: 'https://polygonscan.com',
  Linea: 'https://lineascan.build',
  Unichain: 'https://uniscan.xyz',
  World_Chain: 'https://worldscan.org',
};

const STACKS_EXPLORER = 'https://explorer.hiro.so';

export function explorerUrl(chain: string, txHash: string | null | undefined): string | null {
  if (!txHash) return null;
  if (chain === 'Stacks') return `${STACKS_EXPLORER}/txid/${txHash}`;
  const base = EVM_EXPLORERS[chain];
  return base ? `${base}/tx/${txHash}` : null;
}

export function legExplorerUrl(leg: {
  legType: string;
  fromChain: string;
  toChain: string;
  txHash: string | null;
}): string | null {
  if (!leg.txHash) return null;
  if (leg.legType === 'stacks_mint') return explorerUrl('Stacks', leg.txHash);
  const chain = leg.fromChain !== 'Stacks' ? leg.fromChain : leg.toChain;
  return explorerUrl(chain, leg.txHash);
}
