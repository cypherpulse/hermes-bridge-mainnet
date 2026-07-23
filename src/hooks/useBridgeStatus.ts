import { useState, useCallback, useRef, useEffect } from 'react';
import { hiroFetch } from '@/lib/hiro-api';

export type BridgeStatus = 
  | 'idle'
  | 'depositing'        // Ethereum tx pending
  | 'eth_confirmed'     // Ethereum tx confirmed, waiting for attestation
  | 'attesting'         // Attestation in progress
  | 'minting'           // Stacks mint tx detected
  | 'completed'         // USDCx received
  | 'error';

interface BridgeStatusState {
  status: BridgeStatus;
  ethTxHash: string | null;
  stacksTxHash: string | null;
  errorMessage: string | null;
  startTime: number | null;
  elapsedTime: number;
}

// USDCx contract on mainnet
const USDCX_CONTRACT = import.meta.env.VITE_USDCX_CONTRACT;
const USDCX_V1_CONTRACT = import.meta.env.VITE_USDCX_V1_CONTRACT;

export function useBridgeStatus() {
  const [state, setState] = useState<BridgeStatusState>({
    status: 'idle',
    ethTxHash: null,
    stacksTxHash: null,
    errorMessage: null,
    startTime: null,
    elapsedTime: 0,
  });

  const pollingRef = useRef<NodeJS.Timeout | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const initialBalanceRef = useRef<string | null>(null);
  // Mint tx-ids that already existed when monitoring started - used to ignore
  // a stale mint from a previous bridge, which would otherwise make the very
  // first poll report "completed" even though nothing minted this time.
  const existingMintTxIdsRef = useRef<Set<string>>(new Set());

  // Update elapsed time every second
  useEffect(() => {
    if (state.startTime && state.status !== 'completed' && state.status !== 'error' && state.status !== 'idle') {
      timerRef.current = setInterval(() => {
        setState(prev => ({
          ...prev,
          elapsedTime: Math.floor((Date.now() - (prev.startTime || Date.now())) / 1000)
        }));
      }, 1000);
    }

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [state.startTime, state.status]);

  // Check if USDCx balance has increased for a specific address
  const checkUsdcxBalance = useCallback(async (stacksAddress: string): Promise<string> => {
    try {
      const response = await hiroFetch(
        `https://api.hiro.so/extended/v1/address/${stacksAddress}/balances`
      );
      const data = await response.json();
      
      const usdcxKey = `${USDCX_CONTRACT}::usdcx-token`;
      const balance = data.fungible_tokens?.[usdcxKey]?.balance || '0';
      return balance;
    } catch (error) {
      console.error('Error checking USDCx balance:', error);
      return '0';
    }
  }, []);

  // Check recent transactions on Stacks for mint events. Returns whether the
  // found tx is confirmed on-chain (success) - that's a more reliable, more
  // immediate completion signal than the balance endpoint below, which can
  // lag or cache and leave the UI stuck on "minting" after funds arrived.
  // Snapshot mint tx-ids already visible for this address (before a bridge
  // starts), so we can distinguish this bridge's mint from a stale one.
  const snapshotMintTxIds = useCallback(async (stacksAddress: string): Promise<Set<string>> => {
    const ids = new Set<string>();
    try {
      const response = await hiroFetch(
        `https://api.hiro.so/extended/v1/address/${stacksAddress}/transactions?limit=20`
      );
      const data = await response.json();
      for (const tx of data.results || []) {
        if (tx.tx_type === 'contract_call' &&
            tx.contract_call?.contract_id === USDCX_V1_CONTRACT &&
            tx.contract_call?.function_name === 'mint') {
          ids.add(tx.tx_id);
        }
      }
    } catch (error) {
      console.error('Error snapshotting existing mint txs:', error);
    }
    return ids;
  }, []);

  const checkStacksMintTx = useCallback(async (
    stacksAddress: string
  ): Promise<{ txId: string; confirmed: boolean } | null> => {
    try {
      const exclude = existingMintTxIdsRef.current;
      // Check recent transactions to the usdcx-v1 contract
      const response = await hiroFetch(
        `https://api.hiro.so/extended/v1/address/${stacksAddress}/transactions?limit=10`
      );
      const data = await response.json();

      // Look for recent mint transactions that did NOT already exist when
      // monitoring began - a pre-existing one belongs to an earlier bridge.
      for (const tx of data.results || []) {
        if (tx.tx_type === 'contract_call' &&
            tx.contract_call?.contract_id === USDCX_V1_CONTRACT &&
            tx.contract_call?.function_name === 'mint') {
          if (exclude.has(tx.tx_id)) continue;
          return { txId: tx.tx_id, confirmed: tx.tx_status === 'success' };
        }
      }

      // Also check pending transactions
      const pendingResponse = await hiroFetch(
        `https://api.hiro.so/extended/v1/tx/mempool?recipient_address=${stacksAddress}&limit=20`
      );
      const pendingData = await pendingResponse.json();

      for (const tx of pendingData.results || []) {
        if (tx.contract_call?.contract_id === USDCX_V1_CONTRACT) {
          if (exclude.has(tx.tx_id)) continue;
          return { txId: tx.tx_id, confirmed: false };
        }
      }

      return null;
    } catch (error) {
      console.error('Error checking Stacks mint tx:', error);
      return null;
    }
  }, []);

  // Start monitoring bridge status
  const startMonitoring = useCallback(async (
    ethTxHash: string,
    stacksAddress: string,
    expectedAmount: string
  ) => {
    // Clear any existing polling
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
    }

    // Snapshot initial balance AND existing mint tx-ids so neither a cached
    // balance nor a stale mint from a previous bridge is mistaken for this
    // bridge completing.
    const [initialBalance, existingMintTxIds] = await Promise.all([
      checkUsdcxBalance(stacksAddress),
      snapshotMintTxIds(stacksAddress),
    ]);
    initialBalanceRef.current = initialBalance;
    existingMintTxIdsRef.current = existingMintTxIds;

    setState({
      status: 'eth_confirmed',
      ethTxHash,
      stacksTxHash: null,
      errorMessage: null,
      startTime: Date.now(),
      elapsedTime: 0,
    });

    // Start polling for Stacks transaction/balance
    let pollCount = 0;
    const maxPolls = 120; // Poll for up to 20 minutes (10 second intervals)
    
    pollingRef.current = setInterval(async () => {
      pollCount++;

      // Check for mint transaction. A confirmed (on-chain success) mint is
      // authoritative on its own - don't wait on the balance endpoint below,
      // which can lag/cache and leave the UI stuck on "minting" indefinitely
      // even after the funds have actually arrived.
      const mintTx = await checkStacksMintTx(stacksAddress);
      if (mintTx?.confirmed) {
        setState(prev => ({
          ...prev,
          status: 'completed',
          stacksTxHash: mintTx.txId,
        }));

        if (pollingRef.current) {
          clearInterval(pollingRef.current);
          pollingRef.current = null;
        }
        return;
      }

      if (mintTx) {
        setState(prev => ({
          ...prev,
          status: 'minting',
          stacksTxHash: mintTx.txId,
        }));
      }

      // Fallback: check if balance increased, in case the mint was made by
      // a function/contract this check doesn't recognize.
      const currentBalance = await checkUsdcxBalance(stacksAddress);
      const initialBalance = initialBalanceRef.current || '0';

      if (BigInt(currentBalance) > BigInt(initialBalance)) {
        // Bridge completed!
        setState(prev => ({
          ...prev,
          status: 'completed',
          stacksTxHash: mintTx?.txId || prev.stacksTxHash,
        }));

        if (pollingRef.current) {
          clearInterval(pollingRef.current);
          pollingRef.current = null;
        }
        return;
      }
      
      // xReserve deposits aren't indexed by Circle's CCTP v2 message API
      // (that only covers standard EVM/Solana CCTP domains, not xReserve's
      // non-EVM "remote" domains like Stacks). There's no reliable
      // "attestation in progress" signal to poll for this leg, so this is
      // a cosmetic elapsed-time label only - the balance/mint check above
      // is the real completion signal.
      setState(prev => {
        if (prev.status === 'eth_confirmed' && prev.elapsedTime > 30) {
          return { ...prev, status: 'attesting' };
        }
        return prev;
      });
      
      // Stop polling after max attempts
      if (pollCount >= maxPolls) {
        setState(prev => ({
          ...prev,
          status: 'error',
          errorMessage: 'Bridge timeout - please check Stacks explorer manually',
        }));
        
        if (pollingRef.current) {
          clearInterval(pollingRef.current);
          pollingRef.current = null;
        }
      }
    }, 10000); // Poll every 10 seconds
    
  }, [checkUsdcxBalance, checkStacksMintTx, snapshotMintTxIds]);

  // Stop monitoring
  const stopMonitoring = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // Reset status
  const reset = useCallback(() => {
    stopMonitoring();
    setState({
      status: 'idle',
      ethTxHash: null,
      stacksTxHash: null,
      errorMessage: null,
      startTime: null,
      elapsedTime: 0,
    });
    initialBalanceRef.current = null;
  }, [stopMonitoring]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopMonitoring();
    };
  }, [stopMonitoring]);

  // Format elapsed time
  const formatElapsedTime = useCallback((seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }, []);

  return {
    ...state,
    formatElapsedTime,
    startMonitoring,
    stopMonitoring,
    reset,
  };
}
