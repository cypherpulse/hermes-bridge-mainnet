import { useState, useCallback, useRef, useEffect } from 'react';
import { createPublicClient, http, formatUnits, type Address } from 'viem';
import { mainnet } from 'viem/chains';
import { BRIDGE_CONFIG, ERC20_ABI } from '@/lib/bridge-config';
import { hiroFetch } from '@/lib/hiro-api';

export type WithdrawStatus =
  | 'idle'
  | 'burning'          // Stacks burn tx pending
  | 'burn_confirmed'    // Stacks burn tx confirmed, waiting for USDC release
  | 'releasing'         // Circle is processing the release
  | 'completed'         // USDC arrived on Ethereum
  | 'error';

interface WithdrawStatusState {
  status: WithdrawStatus;
  stacksTxId: string | null;
  errorMessage: string | null;
  releasedAmountUsdc: string | null;
  startTime: number | null;
  elapsedTime: number;
}

const mainnetClient = createPublicClient({ chain: mainnet, transport: http(BRIDGE_CONFIG.ETH_RPC_URL) });

export function useWithdrawStatus() {
  const [state, setState] = useState<WithdrawStatusState>({
    status: 'idle',
    stacksTxId: null,
    errorMessage: null,
    releasedAmountUsdc: null,
    startTime: null,
    elapsedTime: 0,
  });

  const pollingRef = useRef<NodeJS.Timeout | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const initialUsdcBalanceRef = useRef<bigint | null>(null);

  useEffect(() => {
    if (state.startTime && state.status !== 'completed' && state.status !== 'error' && state.status !== 'idle') {
      timerRef.current = setInterval(() => {
        setState(prev => ({
          ...prev,
          elapsedTime: Math.floor((Date.now() - (prev.startTime || Date.now())) / 1000),
        }));
      }, 1000);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [state.startTime, state.status]);

  const fetchEthUsdcBalance = useCallback(async (ethereumAddress: string): Promise<bigint> => {
    try {
      const balance = await mainnetClient.readContract({
        address: BRIDGE_CONFIG.ETH_USDC_CONTRACT as Address,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [ethereumAddress as Address],
      });
      return balance as bigint;
    } catch (error) {
      console.error('[useWithdrawStatus] Error checking Ethereum USDC balance:', error);
      return 0n;
    }
  }, []);

  const checkStacksBurnStatus = useCallback(async (
    txId: string
  ): Promise<{ status: 'pending' | 'success' | 'failed'; vmError?: string }> => {
    try {
      const response = await hiroFetch(`https://api.hiro.so/extended/v1/tx/${txId}`);
      if (!response.ok) return { status: 'pending' };
      const data = await response.json();
      if (data.tx_status === 'success') return { status: 'success' };
      if (typeof data.tx_status === 'string' && data.tx_status.startsWith('abort')) {
        return { status: 'failed', vmError: data.vm_error };
      }
      return { status: 'pending' };
    } catch (error) {
      console.error('[useWithdrawStatus] Error checking Stacks burn tx:', error);
      return { status: 'pending' };
    }
  }, []);

  const startMonitoring = useCallback(async (stacksTxId: string, ethereumAddress: string) => {
    if (pollingRef.current) clearInterval(pollingRef.current);

    initialUsdcBalanceRef.current = await fetchEthUsdcBalance(ethereumAddress);

    setState({
      status: 'burning',
      stacksTxId,
      errorMessage: null,
      releasedAmountUsdc: null,
      startTime: Date.now(),
      elapsedTime: 0,
    });

    let pollCount = 0;
    const maxPolls = 180; // 30 minutes at 10s intervals - release can lag burn confirmation
    let burnConfirmed = false;

    pollingRef.current = setInterval(async () => {
      pollCount++;

      if (!burnConfirmed) {
        const burnStatus = await checkStacksBurnStatus(stacksTxId);
        if (burnStatus.status === 'failed') {
          setState(prev => ({
            ...prev,
            status: 'error',
            errorMessage: burnStatus.vmError
              ? `Burn transaction failed on Stacks: ${burnStatus.vmError}`
              : 'Burn transaction failed on Stacks.',
          }));
          if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null; }
          return;
        }
        if (burnStatus.status === 'success') {
          burnConfirmed = true;
          setState(prev => ({ ...prev, status: 'burn_confirmed' }));
        }
      }

      if (burnConfirmed) {
        const currentBalance = await fetchEthUsdcBalance(ethereumAddress);
        const initialBalance = initialUsdcBalanceRef.current ?? 0n;

        if (currentBalance > initialBalance) {
          const releasedAmountUsdc = formatUnits(currentBalance - initialBalance, 6);
          setState(prev => ({ ...prev, status: 'completed', releasedAmountUsdc }));
          if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null; }
          return;
        }

        setState(prev => (prev.status === 'burn_confirmed' ? { ...prev, status: 'releasing' } : prev));
      }

      if (pollCount >= maxPolls) {
        setState(prev => ({
          ...prev,
          status: 'error',
          errorMessage: burnConfirmed
            ? 'USDC release is taking longer than expected - check your Ethereum wallet manually. Circle attestation can occasionally be delayed.'
            : 'Burn transaction did not confirm in time - check the Stacks explorer manually.',
        }));
        if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null; }
      }
    }, 10_000);
  }, [fetchEthUsdcBalance, checkStacksBurnStatus]);

  const stopMonitoring = useCallback(() => {
    if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null; }
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  }, []);

  const reset = useCallback(() => {
    stopMonitoring();
    setState({
      status: 'idle',
      stacksTxId: null,
      errorMessage: null,
      releasedAmountUsdc: null,
      startTime: null,
      elapsedTime: 0,
    });
    initialUsdcBalanceRef.current = null;
  }, [stopMonitoring]);

  useEffect(() => () => stopMonitoring(), [stopMonitoring]);

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
