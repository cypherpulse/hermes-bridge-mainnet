/**
 * Ground-truth completion check for USDC -> USDCx mints on Stacks.
 *
 * xReserve deposits (Ethereum -> Stacks) are NOT indexed by Circle's CCTP v2
 * message API (`/v2/messages/{domain}`) - that endpoint only covers the
 * standard EVM/Solana CCTP domains, not xReserve's non-EVM "remote" domains
 * (Stacks = 10003). So the only reliable way to confirm an xReserve deposit
 * has minted is to watch the Stacks side directly, via Hiro's API.
 */

import { hiroFetch } from '@/lib/hiro-api';

const USDCX_CONTRACT = import.meta.env.VITE_USDCX_CONTRACT;
const USDCX_V1_CONTRACT = import.meta.env.VITE_USDCX_V1_CONTRACT;

export async function fetchUsdcxBalance(stacksAddress: string): Promise<string> {
  try {
    const response = await hiroFetch(
      `https://api.hiro.so/extended/v1/address/${stacksAddress}/balances`
    );
    const data = await response.json();
    const usdcxKey = `${USDCX_CONTRACT}::usdcx-token`;
    return data.fungible_tokens?.[usdcxKey]?.balance || '0';
  } catch (error) {
    console.error('[stacks-usdcx] Error checking USDCx balance:', error);
    return '0';
  }
}

export interface UsdcxMintTx {
  txId: string;
  /** true once the mint tx is mined and successful, not just seen in mempool. */
  confirmed: boolean;
}

/**
 * Snapshot the tx-ids of USDCx mints/contract-calls already visible for this
 * address. Taken BEFORE a bridge starts so the poller can tell a mint that
 * belongs to THIS bridge from a stale one left over in the address's recent
 * history by an earlier bridge. Without this, any prior successful mint in
 * the last 10 txs makes the poller report "complete" on its very first tick
 * (the "bridge completed in 0:10 but nothing arrived" bug).
 */
export async function fetchUsdcxMintTxIds(stacksAddress: string): Promise<Set<string>> {
  const ids = new Set<string>();
  try {
    const response = await hiroFetch(
      `https://api.hiro.so/extended/v1/address/${stacksAddress}/transactions?limit=20`
    );
    const data = await response.json();
    for (const tx of data.results || []) {
      if (
        tx.tx_type === 'contract_call' &&
        tx.contract_call?.contract_id === USDCX_V1_CONTRACT &&
        tx.contract_call?.function_name === 'mint'
      ) {
        ids.add(tx.tx_id);
      }
    }
  } catch (error) {
    console.error('[stacks-usdcx] Error snapshotting existing mint txs:', error);
  }
  return ids;
}

/**
 * Find a USDCx mint tx for this address, ignoring any whose tx-id is in
 * `excludeTxIds` (mints that already existed before the current bridge - see
 * fetchUsdcxMintTxIds). Returns the newest matching mint, confirmed or pending.
 */
export async function findRecentUsdcxMintTx(
  stacksAddress: string,
  excludeTxIds?: Set<string>
): Promise<UsdcxMintTx | null> {
  try {
    const response = await hiroFetch(
      `https://api.hiro.so/extended/v1/address/${stacksAddress}/transactions?limit=10`
    );
    const data = await response.json();

    for (const tx of data.results || []) {
      if (
        tx.tx_type === 'contract_call' &&
        tx.contract_call?.contract_id === USDCX_V1_CONTRACT &&
        tx.contract_call?.function_name === 'mint'
      ) {
        if (excludeTxIds?.has(tx.tx_id)) continue;
        return { txId: tx.tx_id, confirmed: tx.tx_status === 'success' };
      }
    }

    const pendingResponse = await hiroFetch(
      `https://api.hiro.so/extended/v1/tx/mempool?recipient_address=${stacksAddress}&limit=20`
    );
    const pendingData = await pendingResponse.json();

    for (const tx of pendingData.results || []) {
      if (tx.contract_call?.contract_id === USDCX_V1_CONTRACT) {
        if (excludeTxIds?.has(tx.tx_id)) continue;
        return { txId: tx.tx_id, confirmed: false };
      }
    }

    return null;
  } catch (error) {
    console.error('[stacks-usdcx] Error checking Stacks mint tx:', error);
    return null;
  }
}

/**
 * One-shot check for whether a confirmed USDCx mint has landed for this
 * address since a given timestamp - used to self-heal a tracked
 * transaction's status client-side (e.g. on Hermes Trail) when the browser
 * that started the bridge closed before it could report completion itself.
 * Unlike findRecentUsdcxMintTx (which excludes a snapshot of pre-existing
 * tx-ids captured at bridge start), this compares against an absolute
 * timestamp - the tracked transaction's own createdAt - so it works without
 * having been present for the whole bridge.
 */
export async function findUsdcxMintSince(
  stacksAddress: string,
  sinceIso: string
): Promise<UsdcxMintTx | null> {
  try {
    const response = await hiroFetch(
      `https://api.hiro.so/extended/v1/address/${stacksAddress}/transactions?limit=30`
    );
    const data = await response.json();
    const since = new Date(sinceIso).getTime();

    for (const tx of data.results || []) {
      if (
        tx.tx_type === 'contract_call' &&
        tx.tx_status === 'success' &&
        tx.contract_call?.contract_id === USDCX_V1_CONTRACT &&
        tx.contract_call?.function_name === 'mint'
      ) {
        const minedAt = new Date(tx.burn_block_time_iso ?? tx.receipt_time_iso ?? 0).getTime();
        if (minedAt >= since) return { txId: tx.tx_id, confirmed: true };
      }
    }
    return null;
  } catch (error) {
    console.error('[stacks-usdcx] Error checking mint since timestamp:', error);
    return null;
  }
}

export interface UsdcxMintPollResult {
  status: 'complete' | 'timeout';
  txHash?: string;
}

/**
 * Poll the Stacks recipient for a USDCx mint. A confirmed (on-chain success)
 * mint tx is treated as authoritative completion on its own - don't wait on
 * the balance endpoint, which can lag/cache and leave callers stuck
 * "confirming" indefinitely even after funds have actually arrived. Balance
 * increase remains a fallback in case the mint used a function/contract this
 * check doesn't recognize.
 *
 * Default timeout matches the ~5-30 minute attestation window called out in
 * the README's manual testing checklist.
 */
export async function pollForUsdcxMint(
  stacksAddress: string,
  options: {
    maxWaitMs?: number;
    pollIntervalMs?: number;
    onUpdate?: (info: { elapsedMs: number; mintTx: UsdcxMintTx | null }) => void;
  } = {}
): Promise<UsdcxMintPollResult> {
  const { maxWaitMs = 20 * 60 * 1000, pollIntervalMs = 10_000, onUpdate } = options;
  const startTime = Date.now();
  // Snapshot balance AND pre-existing mint tx-ids up front so neither a stale
  // mint from a previous bridge nor a cached balance can be mistaken for this
  // bridge completing.
  const [initialBalance, existingMintTxIds] = await Promise.all([
    fetchUsdcxBalance(stacksAddress),
    fetchUsdcxMintTxIds(stacksAddress),
  ]);

  while (Date.now() - startTime < maxWaitMs) {
    const [mintTx, currentBalance] = await Promise.all([
      findRecentUsdcxMintTx(stacksAddress, existingMintTxIds),
      fetchUsdcxBalance(stacksAddress),
    ]);

    onUpdate?.({ elapsedMs: Date.now() - startTime, mintTx });

    if (mintTx?.confirmed || BigInt(currentBalance) > BigInt(initialBalance)) {
      return { status: 'complete', txHash: mintTx?.txId };
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  return { status: 'timeout' };
}
