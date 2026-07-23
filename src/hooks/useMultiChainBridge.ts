/**
 * useMultiChainBridge Hook
 * 
 * Handles multi-chain bridging through a 2-step process:
 * 1. Source Chain → Ethereum (via CCTP Bridge Kit)
 * 2. Ethereum → Stacks (via xReserve)
 * 
 * Also supports direct EVM-to-EVM bridging via CCTP.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { useAccount, usePublicClient, useWalletClient, useSwitchChain } from 'wagmi';
import { parseUnits, formatUnits, createPublicClient, http, type Address } from 'viem';
import { mainnet } from 'viem/chains';
import { BridgeKit, type BridgeConfig } from '@circle-fin/bridge-kit';
import { createViemAdapterFromProvider } from '@circle-fin/adapter-viem-v2';
import { createSolanaKitAdapterFromProvider } from '@circle-fin/adapter-solana-kit';
import {
  type CCTPChainId,
  CCTP_CHAINS,
  MULTICHAIN_ERC20_ABI,
  getChainByChainId,
} from '@/lib/multichain-bridge-config';
import { BRIDGE_CONFIG, ERC20_ABI, X_RESERVE_ABI } from '@/lib/bridge-config';
import { encodeStacksAddress, isValidStacksAddress } from '@/lib/stacks-address';
import { calculateBridgeFee, type BridgeFeeQuote, type TransferSpeedPreference } from '@/lib/cctp-fees';
import { pollForUsdcxMint, type UsdcxMintTx } from '@/lib/stacks-usdcx';
import { friendlyErrorMessage } from '@/lib/error-messages';

/**
 * Extract a specific failure reason from a Bridge Kit result, falling back
 * to a generic message when no step-level detail is available (e.g. the
 * SDK's own error-reporting call, unrelated to the bridge itself, failing).
 */
function describeBridgeFailure(result: { steps?: Array<{ name: string; state: string; errorMessage?: string; errorCategory?: string }> }): string {
  const failedStep = result.steps?.find((s) => s.state === 'error');
  if (failedStep?.errorMessage) {
    return `${failedStep.name} step failed: ${failedStep.errorMessage}${failedStep.errorCategory ? ` (${failedStep.errorCategory})` : ''}`;
  }
  return 'Bridge operation was cancelled or failed';
}

/**
 * User-facing status line for the Stacks mint wait. Once a mint tx is
 * detected (even before it's confirmed), reassure the user their funds are
 * on the way with an ETA, rather than a bare "waiting..." ticker that reads
 * as stuck.
 */
function describeMintProgress(elapsedMs: number, mintTx: UsdcxMintTx | null): string {
  const elapsedSeconds = Math.floor(elapsedMs / 1000);
  if (!mintTx) {
    return `Waiting for Circle attestation service... (${elapsedSeconds}s elapsed)`;
  }
  if (elapsedMs > 3 * 60 * 1000) {
    return `Your USDCx has arrived and is finalizing on-chain - this can occasionally take a few extra minutes (${elapsedSeconds}s elapsed).`;
  }
  return `USDCx detected on Stacks! Finalizing - usually done within about a minute (${elapsedSeconds}s elapsed).`;
}

/**
 * Build the CCTP v2 fee/speed config for a Bridge Kit `kit.bridge()` call.
 * Fetches a live Fast Transfer quote and falls back to Standard if it fails,
 * per Circle's fee docs: https://developers.circle.com/cctp/concepts/fees
 */
async function buildCctpBridgeConfig(
  amount: string,
  sourceChainId: CCTPChainId,
  destChainId: CCTPChainId,
  preferredSpeed: TransferSpeedPreference = 'FAST'
): Promise<{ quote: BridgeFeeQuote; config: BridgeConfig }> {
  const sourceDomain = CCTP_CHAINS[sourceChainId].domain;
  const destDomain = CCTP_CHAINS[destChainId].domain;

  const quote = await calculateBridgeFee({
    amountUsdc: amount,
    sourceDomain,
    destDomain,
    preferredSpeed,
    includeProtocolFee: true,
  });

  const config: BridgeConfig = {
    transferSpeed: quote.speed === 'FAST' ? 'FAST' : 'SLOW',
    maxFee: quote.circleMaxFeeUsdc,
  };

  if (parseFloat(quote.protocolFeeUsdc) > 0 && BRIDGE_CONFIG.PROTOCOL_FEE_RECIPIENT_EVM) {
    config.customFee = {
      value: quote.protocolFeeUsdc,
      recipientAddress: BRIDGE_CONFIG.PROTOCOL_FEE_RECIPIENT_EVM,
    };
  }

  return { quote, config };
}

/**
 * Bridge Kit's `cctpResult.wait()` can throw/time out even after the
 * destination mint has actually landed (e.g. delivered by Circle's own relay
 * right around when our wait() gives up). The source-chain burn is already
 * irreversible by that point, so treating a wait() timeout as outright
 * failure is dangerous: the user has no way to "retry" the burn, and
 * retrying just the mint risks a reverted duplicate call ("nonce already
 * used" - the exact symptom that motivated this check) if it actually
 * already succeeded. Poll the destination balance for a grace period before
 * concluding the mint really failed.
 */
async function reconcileMintByBalance(
  fetchBalance: (chainId: CCTPChainId) => Promise<string>,
  destChainId: CCTPChainId,
  balanceBefore: number,
  expectedAmount: number,
  maxWaitMs: number,
  onProgress?: (elapsedMs: number) => void,
  pollIntervalMs = 10_000
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const current = parseFloat(await fetchBalance(destChainId));
    // Allow slack for the CCTP fee deducted from the minted amount.
    if (current >= balanceBefore + expectedAmount * 0.9) {
      return true;
    }
    onProgress?.(Date.now() - start);
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
  return false;
}

/**
 * How long to keep polling the destination balance for a CCTP mint after
 * Bridge Kit stops waiting. A Fast Transfer mints in seconds-to-minutes; a
 * Standard transfer waits for source-chain finality and can take 15-30 min,
 * so giving up at 90s (as we used to) wrongly failed Standard transfers whose
 * funds were still legitimately in flight.
 */
function reconcileWindowMs(speed: TransferSpeedPreference): number {
  return speed === 'FAST' ? 5 * 60_000 : 30 * 60_000;
}

function formatMinutesSeconds(ms: number): string {
  const total = Math.floor(ms / 1000);
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * `waitForTransactionReceipt`'s own timeout (used for the xReserve deposit
 * tx) can fire even though the transaction was already broadcast and may
 * still land seconds later - unlike the CCTP mint step, we already have the
 * real tx hash here, so instead of assuming failure we keep polling for the
 * receipt directly with getTransactionReceipt over a longer grace period.
 */
async function waitForReceiptWithGracePeriod(
  client: ReturnType<typeof createPublicClient>,
  hash: `0x${string}`,
  maxWaitMs = 5 * 60_000,
  pollIntervalMs = 10_000
): Promise<'success' | 'reverted' | 'unknown'> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    try {
      const receipt = await client.getTransactionReceipt({ hash });
      return receipt.status === 'success' ? 'success' : 'reverted';
    } catch {
      // Not mined yet (or a transient RPC hiccup) - keep polling.
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
  return 'unknown';
}

export type BridgeMode = 'to-stacks' | 'evm-to-evm';

export interface BridgeStep {
  id: string;
  name: string;
  description: string;
  status: 'pending' | 'in-progress' | 'completed' | 'failed';
  txHash?: string;
  explorerUrl?: string;
  error?: string;
}

export interface MultichainBridgeState {
  isLoading: boolean;
  currentStepIndex: number;
  steps: BridgeStep[];
  error: string | null;
  isCompleted: boolean;
}

export function useMultiChainBridge() {
  const { address, isConnected, chainId: connectedChainId } = useAccount();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const { switchChainAsync } = useSwitchChain();

  // Balances state
  const [sourceBalance, setSourceBalance] = useState<string>('0');
  const [ethBalance, setEthBalance] = useState<string>('0');
  const [isLoadingBalance, setIsLoadingBalance] = useState(false);

  // Bridge state
  const [bridgeState, setBridgeState] = useState<MultichainBridgeState>({
    isLoading: false,
    currentStepIndex: 0,
    steps: [],
    error: null,
    isCompleted: false,
  });

  // bridgeState.currentStepIndex is a stale snapshot inside an in-flight
  // async bridge function - setBridgeState calls made earlier in that same
  // execution don't update the closure's local `bridgeState`, so a catch
  // block reading it would always attribute the error to whichever step was
  // current when the function *started* (step 0), not the step that
  // actually failed. This ref is updated synchronously alongside every
  // currentStepIndex change so error handling always sees the live value.
  const currentStepIndexRef = useRef(0);

  // Get supported chains from Bridge Kit
  const [supportedChains, setSupportedChains] = useState<string[]>([]);

  // Initialize supported chains on mount
  useEffect(() => {
    const chains = getSupportedChains();
    // Filter out Solana since we have a dedicated Solana bridge
    const filteredChains = chains.filter(c => c.chain !== 'Solana_Devnet');
    setSupportedChains(filteredChains.map(c => c.chain));
  }, []);

  // Fetch USDC balance for a specific chain. Official public RPCs (e.g.
  // mainnet.base.org) are documented as not meant for production dapp
  // traffic and can rate-limit or time out under real usage - previously
  // that silently read back as a zero balance, wrongly triggering
  // "Insufficient Balance". Try the primary RPC then each fallback in order
  // before giving up.
  const fetchBalance = useCallback(async (chainId: CCTPChainId): Promise<string> => {
    if (!address) return '0';

    const chain = CCTP_CHAINS[chainId];
    if (!chain) return '0';

    const rpcUrls = [chain.rpcUrl, ...(chain.fallbackRpcUrls ?? [])];

    for (let i = 0; i < rpcUrls.length; i++) {
      try {
        const client = createPublicClient({
          transport: http(rpcUrls[i]),
        });

        const balance = await client.readContract({
          address: chain.usdcAddress,
          abi: MULTICHAIN_ERC20_ABI,
          functionName: 'balanceOf',
          args: [address],
        });

        return formatUnits(balance as bigint, 6);
      } catch (error) {
        console.error(`Error fetching balance for ${chainId} via ${rpcUrls[i]}:`, error);
      }
    }

    return '0';
  }, [address]);

  // Refresh balances for selected chains
  const refreshBalances = useCallback(async (sourceChainId: CCTPChainId) => {
    if (!address) return;

    setIsLoadingBalance(true);
    try {
      const [sourceBal, ethBal] = await Promise.all([
        fetchBalance(sourceChainId),
        fetchBalance('Ethereum'),
      ]);
      setSourceBalance(sourceBal);
      setEthBalance(ethBal);
    } catch (error) {
      console.error('Error refreshing balances:', error);
    } finally {
      setIsLoadingBalance(false);
    }
  }, [address, fetchBalance]);

  // Wait for wallet permissions to be resolved
  const waitForWalletReady = useCallback(async (maxWaitMs = 5000): Promise<boolean> => {
    const startTime = Date.now();
    
    while (Date.now() - startTime < maxWaitMs) {
      try {
        // Try to get accounts to check if wallet is ready
        const accounts = await window.ethereum.request({ method: 'eth_accounts' });
        if (accounts && accounts.length > 0) {
          return true;
        }
      } catch (error) {
        // If we get an error about pending requests, wait and retry
        if (error.message && error.message.includes('already pending')) {
          await new Promise(resolve => setTimeout(resolve, 500));
          continue;
        }
        // Other errors might mean wallet is not ready
        console.log('Wallet not ready yet:', error.message);
      }
      
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    return false;
  }, []);

  // Initialize Bridge Kit with retry logic
  const initializeBridgeKitAdapter = useCallback(async (maxRetries = 3): Promise<any> => {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`Initializing Bridge Kit adapter (attempt ${attempt}/${maxRetries})`);
        
        // Wait for wallet to be ready
        const walletReady = await waitForWalletReady();
        if (!walletReady) {
          throw new Error('Wallet not ready after waiting');
        }

        const adapter = await createViemAdapterFromProvider({
          provider: window.ethereum as any,
        });
        
        console.log('Bridge Kit adapter initialized successfully');
        return adapter;
      } catch (error) {
        console.error(`Bridge Kit adapter initialization attempt ${attempt} failed:`, error);
        
        if (attempt === maxRetries) {
          throw error;
        }
        
        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  }, [waitForWalletReady]);

  // Debug: Get supported chains from Bridge Kit
  const getSupportedChains = useCallback(() => {
    try {
      const kit = new BridgeKit({ disableErrorReporting: true });
      const chains = kit.getSupportedChains();
      console.log('Bridge Kit supported chains:', chains.map(c => c.chain));
      return chains;
    } catch (error) {
      console.error('Error getting supported chains:', error);
      return [];
    }
  }, []);

  // Update step status
  const updateStep = useCallback((index: number, updates: Partial<BridgeStep>) => {
    setBridgeState(prev => ({
      ...prev,
      steps: prev.steps.map((step, i) => 
        i === index ? { ...step, ...updates } : step
      ),
    }));
  }, []);

  // Helper to get current chain ID directly from provider (not stale React state)
  const getCurrentChainId = useCallback(async (): Promise<number | null> => {
    try {
      if (typeof window !== 'undefined' && (window as any).ethereum) {
        const chainIdHex = await (window as any).ethereum.request({ method: 'eth_chainId' });
        return parseInt(chainIdHex, 16);
      }
      return connectedChainId || null;
    } catch {
      return connectedChainId || null;
    }
  }, [connectedChainId]);

  // Switch to the required chain with proper verification
  const ensureCorrectChain = useCallback(async (targetChainId: number, maxRetries = 3): Promise<boolean> => {
    // Check current chain directly from provider
    const currentChain = await getCurrentChainId();
    if (currentChain === targetChainId) {
      console.log(`Already on chain ${targetChainId}`);
      return true;
    }

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`Attempting to switch to chain ${targetChainId} (attempt ${attempt}/${maxRetries})`);

        // Switch chain
        await switchChainAsync({ chainId: targetChainId });

        // Wait for chain switch to complete
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Verify by checking provider directly (not React state which may be stale)
        for (let check = 0; check < 5; check++) {
          const actualChainId = await getCurrentChainId();
          if (actualChainId === targetChainId) {
            console.log(`Successfully switched to chain ${targetChainId}`);
            return true;
          }
          await new Promise(resolve => setTimeout(resolve, 1000));
        }

        console.log(`Chain switch verification failed on attempt ${attempt}`);
      } catch (error: any) {
        console.error(`Chain switch attempt ${attempt} failed:`, error);

        // If user rejected, don't retry
        if (error?.code === 4001 || error?.message?.includes('rejected')) {
          console.log('User rejected network switch');
          return false;
        }

        if (attempt === maxRetries) {
          return false;
        }

        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, 1500));
      }
    }

    return false;
  }, [getCurrentChainId, switchChainAsync]);

  /**
   * Bridge from any CCTP chain to Stacks (2-step process)
   */
  const bridgeToStacks = useCallback(async (
    sourceChainId: CCTPChainId,
    amount: string,
    stacksRecipient: string,
    preferredSpeed: TransferSpeedPreference = 'FAST'
  ): Promise<boolean> => {
    if (!address || !walletClient || !publicClient) {
      setBridgeState(prev => ({ ...prev, error: 'Wallet not connected' }));
      return false;
    }

    // Validate the Stacks recipient before burning/moving any funds - a bad
    // address (typo, or two addresses accidentally concatenated) must never
    // be discovered only after the CCTP burn and Ethereum mint have already
    // consumed real gas and funds.
    if (!isValidStacksAddress(stacksRecipient)) {
      setBridgeState(prev => ({ ...prev, error: 'Invalid Stacks recipient address' }));
      return false;
    }

    // If source is Ethereum, just do xReserve directly
    if (sourceChainId === 'Ethereum') {
      return bridgeEthToStacks(amount, stacksRecipient, preferredSpeed);
    }

    const sourceChain = CCTP_CHAINS[sourceChainId];
    if (!sourceChain) {
      setBridgeState(prev => ({ ...prev, error: 'Invalid source chain' }));
      return false;
    }

    // Initialize steps with network switch step
    const steps: BridgeStep[] = [
      {
        id: 'cctp-bridge',
        name: 'USDC Crosschain Transfer',
        description: 'Transfer USDC',
        status: 'pending',
      },
      {
        id: 'switch-network',
        name: 'Switch Network',
        description: 'Switch to Ethereum network',
        status: 'pending',
      },
      {
        id: 'approve-usdc',
        name: 'Approve USDC',
        description: 'Approve spending USDC for transfer',
        status: 'pending',
      },
      {
        id: 'xreserve-deposit',
        name: 'Deposit to Bridge',
        description: 'Deposit USDC to circle protocol',
        status: 'pending',
      },
      {
        id: 'xreserve-attestation',
        name: 'Attestation & Minting',
        description: 'Waiting for Circle attestation service',
        status: 'pending',
      },
    ];

    currentStepIndexRef.current = 0;
    setBridgeState({
      isLoading: true,
      currentStepIndex: 0,
      steps,
      error: null,
      isCompleted: false,
    });

    try {
      // Step 1: CCTP Bridge (Source → Ethereum)
      updateStep(0, { status: 'in-progress' });

      // Ensure we're on the source chain
      const onCorrectChain = await ensureCorrectChain(sourceChain.chainId);
      if (!onCorrectChain) {
        throw new Error(`Please switch to ${sourceChain.displayName} network`);
      }

      // Get fresh wallet client after chain switch
      const provider = await walletClient.transport;
      
      // Initialize Bridge Kit with retry logic
      const kit = new BridgeKit({ disableErrorReporting: true });
      const adapter = await initializeBridgeKitAdapter();

      console.log('=== CCTP Bridge Step 1 ===');
      console.log('From:', sourceChainId);
      console.log('To: Ethereum');
      console.log('Amount:', amount);

      // Snapshot the Ethereum balance before the burn so a wait() timeout
      // can be reconciled against reality instead of assumed as a failure.
      const ethBalanceBeforeCctp = parseFloat(await fetchBalance('Ethereum'));

      // CCTP v2 fee/speed quote: try Fast, fall back to Standard on failure.
      // https://developers.circle.com/cctp/concepts/fees
      const { quote: cctpQuote, config: cctpConfig } = await buildCctpBridgeConfig(
        amount,
        sourceChainId,
        'Ethereum',
        preferredSpeed
      );
      console.log('CCTP fee quote:', cctpQuote);
      updateStep(0, {
        description: cctpQuote.usedFallback
          ? 'Fast transfer unavailable - using Standard transfer'
          : cctpQuote.speed === 'FAST'
            ? `Fast transfer (Circle fee ~${cctpQuote.estimatedCircleFeeUsdc} USDC)`
            : 'Standard transfer',
      });

      // Execute CCTP bridge and wait for completion
      const cctpResult = await kit.bridge({
        from: { adapter, chain: sourceChainId },
        to: { adapter, chain: 'Ethereum' },
        amount,
        config: cctpConfig,
      });

      console.log('CCTP Result:', cctpResult);

      // Bridge Kit can report failure - including via kit.bridge() itself
      // resolving with state:'error' after an internal timeout, not just
      // via a later cctpResult.wait() throw - even after the destination
      // mint has actually landed (e.g. delivered by Circle's own relay
      // right around when Bridge Kit gives up waiting). The source-chain
      // burn is already irreversible by this point, so every failure signal
      // below is reconciled against the real Ethereum balance before we
      // treat it as a genuine failure (see reconcileMintByBalance's comment).
      let bridgeFailed = cctpResult.state === 'error' || !cctpResult.steps || cctpResult.steps.length === 0;
      let failureReason = bridgeFailed ? describeBridgeFailure(cctpResult) : '';

      if (!bridgeFailed && cctpResult.wait) {
        console.log('Waiting for CCTP bridge to complete...');
        try {
          await cctpResult.wait();
          console.log('CCTP bridge completed successfully');
          if (cctpResult.state === 'error') {
            bridgeFailed = true;
            failureReason = 'Bridge operation failed during execution';
          }
        } catch (waitError) {
          bridgeFailed = true;
          failureReason = waitError instanceof Error ? waitError.message : String(waitError);
        }
      }

      if (bridgeFailed) {
        console.warn('CCTP bridge reported failure - checking Ethereum balance before giving up:', failureReason);
        const window = reconcileWindowMs(cctpQuote.speed);
        const mintConfirmed = await reconcileMintByBalance(
          fetchBalance,
          'Ethereum',
          ethBalanceBeforeCctp,
          parseFloat(amount),
          window,
          (elapsedMs) => {
            const label = cctpQuote.speed === 'FAST'
              ? 'Confirming mint on Ethereum'
              : 'Standard transfer - waiting for source-chain finality (this can take 15-30 min)';
            updateStep(0, { description: `${label}... (${formatMinutesSeconds(elapsedMs)})` });
          }
        );
        if (!mintConfirmed) {
          throw new Error(
            'Your USDC was burned on the source chain, but we could not confirm it arrived on Ethereum yet. ' +
            'Check your Ethereum balance before retrying - do not resubmit, as that can fail with "nonce already used" if the funds already arrived.'
          );
        }
        console.log('Mint confirmed via Ethereum balance check despite Bridge Kit reporting failure:', failureReason);
      }

      // Bridge Kit's `steps` array typically ends with the destination-chain
      // 'mint' step, not the source-chain 'burn' step - grabbing "the last
      // step" would attach a destination-chain tx hash to a source-chain
      // explorer link. Find the burn step explicitly for the source-chain tx.
      const burnStep = cctpResult.steps?.find((s) => s.name === 'burn');
      const mintStep = cctpResult.steps?.find((s) => s.name === 'mint');
      const cctpTxHash = burnStep?.txHash ?? cctpResult.steps?.[cctpResult.steps.length - 1]?.txHash;

      // Verify the transaction was actually successful
      if (!cctpTxHash) {
        throw new Error('No transaction hash found - bridge may have been cancelled');
      }

      updateStep(0, {
        status: 'completed',
        txHash: cctpTxHash,
        explorerUrl: burnStep?.explorerUrl || `${sourceChain.blockExplorer}/tx/${cctpTxHash}`,
        description: mintStep?.txHash
          ? `Minted on Ethereum: ${mintStep.txHash.slice(0, 10)}...${mintStep.txHash.slice(-6)}`
          : undefined,
      });

      currentStepIndexRef.current = 1;
      setBridgeState(prev => ({ ...prev, currentStepIndex: 1 }));

      // Step 2: Switch to Ethereum Network
      updateStep(1, { status: 'in-progress' });

      // Wait a bit for wallet state to settle after CCTP bridge
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Check if we're already on Ethereum (Bridge Kit may have switched us)
      const currentChain = await getCurrentChainId();
      console.log(`Current chain after CCTP: ${currentChain}, target: ${mainnet.id}`);

      if (currentChain === mainnet.id) {
        console.log('Already on Ethereum after CCTP bridge');
      } else {
        console.log('Switching to Ethereum network...');
        const onEthereum = await ensureCorrectChain(mainnet.id);
        if (!onEthereum) {
          updateStep(1, { status: 'failed', error: 'Failed to switch to Ethereum network' });
          throw new Error('Please switch to Ethereum network manually');
        }
      }

      updateStep(1, { status: 'completed' });
      currentStepIndexRef.current = 2;
      setBridgeState(prev => ({ ...prev, currentStepIndex: 2 }));

      // Step 3: Approve USDC
      updateStep(2, { status: 'in-progress' });

      const value = parseUnits(amount, 6);

      // Check current allowance using mainnet client
      const mainnetClient = createPublicClient({
        chain: mainnet,
        transport: http(BRIDGE_CONFIG.ETH_RPC_URL),
      });
      
      const allowance = await mainnetClient.readContract({
        address: BRIDGE_CONFIG.ETH_USDC_CONTRACT as Address,
        abi: ERC20_ABI,
        functionName: 'allowance',
        args: [address, BRIDGE_CONFIG.X_RESERVE_CONTRACT as Address],
      }) as bigint;

      if (allowance < value) {
        const approveHash = await walletClient.writeContract({
          address: BRIDGE_CONFIG.ETH_USDC_CONTRACT as Address,
          abi: ERC20_ABI,
          functionName: 'approve',
          args: [BRIDGE_CONFIG.X_RESERVE_CONTRACT as Address, value],
          chain: mainnet,
          account: address,
        });

        await mainnetClient.waitForTransactionReceipt({ 
          hash: approveHash,
          timeout: 120000, // 2 minutes timeout
        });
        
        updateStep(2, { 
          status: 'completed', 
          txHash: approveHash,
          explorerUrl: `https://etherscan.io/tx/${approveHash}`,
        });
      } else {
        updateStep(2, { status: 'completed' });
      }

      currentStepIndexRef.current = 3;
      setBridgeState(prev => ({ ...prev, currentStepIndex: 3 }));

      // Step 4: xReserve Deposit
      updateStep(3, { status: 'in-progress' });

      console.log('Proceeding with xReserve deposit...');

      // Execute xReserve deposit
      const depositResult = await executeXReserveDeposit(amount, stacksRecipient, preferredSpeed);

      if (!depositResult.success) {
        updateStep(3, { status: 'failed', error: depositResult.error });
        throw new Error(depositResult.error || 'xReserve deposit failed');
      }

      updateStep(3, { 
        status: 'completed', 
        txHash: depositResult.txHash,
        explorerUrl: `https://etherscan.io/tx/${depositResult.txHash}`,
      });

      currentStepIndexRef.current = 4;
      setBridgeState(prev => ({ ...prev, currentStepIndex: 4 }));

      // Step 5: Attestation (includes minting)
      updateStep(4, { status: 'in-progress' });

      console.log('Waiting for Circle attestation and minting...');

      // Poll for attestation completion
      const attestationComplete = await pollForAttestation(stacksRecipient, 4);

      if (!attestationComplete) {
        updateStep(4, { status: 'failed', error: 'Attestation timeout' });
        throw new Error('Attestation did not complete within timeout');
      }

      // Wait a bit for minting to complete
      await new Promise(resolve => setTimeout(resolve, 5000));

      updateStep(4, { status: 'completed' });

      setBridgeState(prev => ({ 
        ...prev, 
        isLoading: false, 
        isCompleted: true,
      }));

      return true;
    } catch (error: any) {
      console.error('Bridge to Stacks failed:', error);

      const currentIndex = currentStepIndexRef.current;
      updateStep(currentIndex, {
        status: 'failed',
        error: friendlyErrorMessage(error, 'Bridge failed'),
      });

      setBridgeState(prev => ({
        ...prev,
        isLoading: false,
        error: friendlyErrorMessage(error, 'Bridge failed'),
      }));

      return false;
    }
  }, [address, walletClient, ensureCorrectChain, getCurrentChainId, updateStep, fetchBalance]);

  /**
   * Bridge directly from Ethereum to Stacks via xReserve
   */
  const bridgeEthToStacks = useCallback(async (
    amount: string,
    stacksRecipient: string,
    preferredSpeed: TransferSpeedPreference = 'FAST'
  ): Promise<boolean> => {
    if (!address || !walletClient || !publicClient) {
      setBridgeState(prev => ({ ...prev, error: 'Wallet not connected' }));
      return false;
    }

    if (!isValidStacksAddress(stacksRecipient)) {
      setBridgeState(prev => ({ ...prev, error: 'Invalid Stacks recipient address' }));
      return false;
    }

    const steps: BridgeStep[] = [
      {
        id: 'approve',
        name: 'Approve USDC',
        description: 'Approve xReserve to spend USDC',
        status: 'pending',
      },
      {
        id: 'xreserve-deposit',
        name: 'Deposit to xReserve',
        description: 'Deposit USDC to xReserve contract',
        status: 'pending',
      },
      {
        id: 'xreserve-attestation',
        name: 'Attestation & Minting',
        description: 'Waiting for Circle attestation service',
        status: 'pending',
      },
    ];

    currentStepIndexRef.current = 0;
    setBridgeState({
      isLoading: true,
      currentStepIndex: 0,
      steps,
      error: null,
      isCompleted: false,
    });

    try {
      // Ensure we're on Ethereum
      const onEthereum = await ensureCorrectChain(mainnet.id);
      if (!onEthereum) {
        throw new Error('Please switch to Ethereum network');
      }

      const value = parseUnits(amount, 6);

      // Step 1: Approve
      updateStep(0, { status: 'in-progress' });

      // Check current allowance using mainnet client
      const mainnetClient = createPublicClient({
        chain: mainnet,
        transport: http(BRIDGE_CONFIG.ETH_RPC_URL),
      });
      
      const allowance = await mainnetClient.readContract({
        address: BRIDGE_CONFIG.ETH_USDC_CONTRACT as Address,
        abi: ERC20_ABI,
        functionName: 'allowance',
        args: [address, BRIDGE_CONFIG.X_RESERVE_CONTRACT as Address],
      }) as bigint;

      if (allowance < value) {
        const approveHash = await walletClient.writeContract({
          address: BRIDGE_CONFIG.ETH_USDC_CONTRACT as Address,
          abi: ERC20_ABI,
          functionName: 'approve',
          args: [BRIDGE_CONFIG.X_RESERVE_CONTRACT as Address, value],
          chain: mainnet,
          account: address,
        });

        await mainnetClient.waitForTransactionReceipt({ 
          hash: approveHash,
          timeout: 120000, // 2 minutes timeout
        });
        
        updateStep(0, { 
          status: 'completed', 
          txHash: approveHash,
          explorerUrl: `https://etherscan.io/tx/${approveHash}`,
        });
      } else {
        updateStep(0, { status: 'completed' });
      }

      currentStepIndexRef.current = 1;
      setBridgeState(prev => ({ ...prev, currentStepIndex: 1 }));

      // Step 2: xReserve Deposit
      updateStep(1, { status: 'in-progress' });

      const depositResult = await executeXReserveDeposit(amount, stacksRecipient, preferredSpeed);

      if (!depositResult.success) {
        updateStep(1, { status: 'failed', error: depositResult.error });
        throw new Error(depositResult.error || 'xReserve deposit failed');
      }

      updateStep(1, { 
        status: 'completed', 
        txHash: depositResult.txHash,
        explorerUrl: `https://etherscan.io/tx/${depositResult.txHash}`,
      });

      currentStepIndexRef.current = 2;
      setBridgeState(prev => ({ ...prev, currentStepIndex: 2 }));

      // Step 3: Attestation (includes minting)
      updateStep(2, { status: 'in-progress' });

      console.log('Waiting for Circle attestation and minting...');

      // Poll for attestation completion
      const attestationComplete = await pollForAttestation(stacksRecipient, 2);

      if (!attestationComplete) {
        updateStep(2, { status: 'failed', error: 'Attestation timeout' });
        throw new Error('Attestation did not complete within timeout');
      }

      // Wait a bit for minting to complete
      await new Promise(resolve => setTimeout(resolve, 5000));

      updateStep(2, { status: 'completed' });

      setBridgeState(prev => ({ 
        ...prev, 
        isLoading: false, 
        isCompleted: true,
      }));

      return true;
    } catch (error: any) {
      console.error('Ethereum to Stacks bridge failed:', error);

      const currentIndex = currentStepIndexRef.current;
      updateStep(currentIndex, {
        status: 'failed',
        error: friendlyErrorMessage(error, 'Bridge failed'),
      });

      setBridgeState(prev => ({
        ...prev,
        isLoading: false,
        error: friendlyErrorMessage(error, 'Bridge failed'),
      }));

      return false;
    }
  }, [address, walletClient, publicClient, ensureCorrectChain, updateStep]);

  /**
   * Execute xReserve bridge to Stacks
   */
  const executeXReserveDeposit = useCallback(async (
    amount: string,
    stacksRecipient: string,
    preferredSpeed: TransferSpeedPreference = 'FAST'
  ): Promise<{ success: boolean; txHash?: string; error?: string; feeQuote?: BridgeFeeQuote }> => {
    if (!walletClient || !address || !publicClient) {
      return { success: false, error: 'Wallet not connected' };
    }

    try {
      const mainnetClient = createPublicClient({
        chain: mainnet,
        transport: http(BRIDGE_CONFIG.ETH_RPC_URL),
      });

      const value = parseUnits(amount, 6);

      // xReserve wraps CCTP v2 under the hood, so maxFee gates Fast Transfer
      // eligibility the same way TokenMessengerV2's depositForBurn does.
      // No Hermes protocol fee here yet - xReserve's ABI has no fee-recipient
      // param, so includeProtocolFee is false (see plan doc).
      // https://developers.circle.com/xreserve/tutorials/deposit-usdc-into-xreserve
      const feeQuote = await calculateBridgeFee({
        amountUsdc: amount,
        sourceDomain: 0, // Ethereum
        destDomain: BRIDGE_CONFIG.STACKS_DOMAIN,
        preferredSpeed,
        includeProtocolFee: false,
      });
      const maxFee = parseUnits(feeQuote.circleMaxFeeUsdc, 6);
      const remoteRecipient = encodeStacksAddress(stacksRecipient);
      const hookData = '0x' as `0x${string}`;

      console.log('=== xReserve Bridge ===');
      console.log('Amount:', value.toString());
      console.log('Stacks Recipient:', remoteRecipient);
      console.log('Fee quote:', feeQuote);

      const depositArgs = [
        value,
        BRIDGE_CONFIG.STACKS_DOMAIN,
        remoteRecipient,
        BRIDGE_CONFIG.ETH_USDC_CONTRACT as Address,
        maxFee,
        hookData,
      ] as const;

      // A transaction whose gas/fee params end up too low for current
      // network conditions doesn't error or revert - it just sits
      // unbroadcast/unmined and eventually vanishes with no receipt ever
      // appearing, which is exactly the failure pattern this call has hit
      // repeatedly. depositToRemote is a heavier call than a plain approve,
      // so don't leave gas/fee estimation entirely to the wallet's
      // defaults - estimate explicitly with a healthy buffer, falling back
      // to wallet defaults only if our own estimate call fails.
      let gasOverrides: { gas?: bigint; maxFeePerGas?: bigint; maxPriorityFeePerGas?: bigint } = {};
      try {
        const [gasEstimate, feesPerGas] = await Promise.all([
          mainnetClient.estimateContractGas({
            address: BRIDGE_CONFIG.X_RESERVE_CONTRACT as Address,
            abi: X_RESERVE_ABI,
            functionName: 'depositToRemote',
            args: depositArgs,
            account: address,
          }),
          mainnetClient.estimateFeesPerGas(),
        ]);
        gasOverrides = {
          gas: (gasEstimate * 130n) / 100n,
          maxFeePerGas: (feesPerGas.maxFeePerGas * 150n) / 100n,
          maxPriorityFeePerGas: (feesPerGas.maxPriorityFeePerGas * 150n) / 100n,
        };
        console.log('xReserve gas/fee overrides:', gasOverrides);
      } catch (estimateError) {
        console.warn('xReserve gas/fee estimation failed, falling back to wallet defaults:', estimateError);
      }

      const hash = await walletClient.writeContract({
        address: BRIDGE_CONFIG.X_RESERVE_CONTRACT as Address,
        abi: X_RESERVE_ABI,
        functionName: 'depositToRemote',
        args: depositArgs,
        chain: mainnet,
        account: address,
        ...gasOverrides,
      });

      try {
        await mainnetClient.waitForTransactionReceipt({
          hash,
          timeout: 120000, // 2 minutes timeout
        });
      } catch (waitError) {
        // The deposit tx was already broadcast (we have a real hash) - a
        // timeout here just means our RPC read gave up, not that the
        // transaction failed. Keep polling directly before concluding it
        // really didn't land, so we don't tell the user to retry a deposit
        // that's still in flight.
        console.warn('xReserve waitForTransactionReceipt timed out - polling for receipt directly:', waitError);
        const outcome = await waitForReceiptWithGracePeriod(mainnetClient, hash);
        if (outcome === 'reverted') {
          return {
            success: false,
            error: `The xReserve deposit transaction reverted on-chain (${hash.slice(0, 10)}...${hash.slice(-6)}).`,
            txHash: hash,
          };
        }
        if (outcome === 'unknown') {
          return {
            success: false,
            error: `We could not confirm your xReserve deposit yet. Check transaction ${hash.slice(0, 10)}...${hash.slice(-6)} on Etherscan before retrying - do not resubmit if it already confirmed.`,
            txHash: hash,
          };
        }
        console.log('xReserve deposit confirmed via direct receipt poll despite waitForTransactionReceipt timing out');
      }

      console.log('xReserve TX Hash:', hash);
      return { success: true, txHash: hash, feeQuote };
    } catch (error: any) {
      console.error('xReserve bridge error:', error);
      return { success: false, error: friendlyErrorMessage(error, 'xReserve bridge failed') };
    }
  }, [walletClient, address, publicClient]);

  /**
   * Poll for the xReserve deposit's USDCx mint on Stacks.
   *
   * xReserve deposits are NOT indexed by Circle's CCTP v2 message API
   * (`/v2/messages/{domain}`) - that only covers standard EVM/Solana CCTP
   * domains, not xReserve's non-EVM "remote" domains like Stacks (10003).
   * So completion is confirmed by watching the Stacks side directly
   * (see src/lib/stacks-usdcx.ts), the same ground truth useBridgeStatus.ts
   * uses for the direct Ethereum-only bridge flow.
   *
   * `stepIndex` lets both the 5-step (bridgeToStacks) and 3-step
   * (bridgeEthToStacks) flows report progress on their own attestation step.
   * Default timeout matches useBridgeStatus.ts's 20-minute allowance.
   */
  const pollForAttestation = useCallback(async (
    stacksRecipient: string,
    stepIndex: number,
    maxWaitMs = 20 * 60 * 1000
  ): Promise<boolean> => {
    const result = await pollForUsdcxMint(stacksRecipient, {
      maxWaitMs,
      pollIntervalMs: 10_000,
      onUpdate: ({ elapsedMs, mintTx }) => {
        updateStep(stepIndex, { description: describeMintProgress(elapsedMs, mintTx) });
      },
    });

    return result.status === 'complete';
  }, [updateStep]);

  /**
   * Bridge between EVM chains (CCTP only, no Stacks)
   */
  const bridgeEvmToEvm = useCallback(async (
    sourceChainId: CCTPChainId,
    destChainId: CCTPChainId,
    amount: string,
    preferredSpeed: TransferSpeedPreference = 'FAST'
  ): Promise<boolean> => {
    if (!address || !walletClient) {
      setBridgeState(prev => ({ ...prev, error: 'Wallet not connected' }));
      return false;
    }

    if (sourceChainId === destChainId) {
      setBridgeState(prev => ({ ...prev, error: 'Source and destination must be different' }));
      return false;
    }

    const sourceChain = CCTP_CHAINS[sourceChainId];
    const destChain = CCTP_CHAINS[destChainId];

    const steps: BridgeStep[] = [
      {
        id: 'cctp-bridge',
        name: 'Cross-Chain Transfer',
        description: `Transfer USDC from ${sourceChain.displayName} to ${destChain.displayName}`,
        status: 'pending',
      },
    ];

    currentStepIndexRef.current = 0;
    setBridgeState({
      isLoading: true,
      currentStepIndex: 0,
      steps,
      error: null,
      isCompleted: false,
    });

    try {
      updateStep(0, { status: 'in-progress' });

      // Ensure we're on the source chain
      const onCorrectChain = await ensureCorrectChain(sourceChain.chainId);
      if (!onCorrectChain) {
        throw new Error(`Please switch to ${sourceChain.displayName} network`);
      }

      // Initialize Bridge Kit
      const kit = new BridgeKit({ disableErrorReporting: true });
      const adapter = await createViemAdapterFromProvider({
        provider: window.ethereum as any,
      });

      console.log('=== CCTP EVM-to-EVM Bridge ===');
      console.log('From:', sourceChainId);
      console.log('To:', destChainId);
      console.log('Amount:', amount);

      // Snapshot the destination balance before the burn so a wait()
      // timeout can be reconciled against reality instead of assumed failed.
      const destBalanceBeforeCctp = parseFloat(await fetchBalance(destChainId));

      // CCTP v2 fee/speed quote: try Fast, fall back to Standard on failure.
      const { quote: cctpQuote, config: cctpConfig } = await buildCctpBridgeConfig(
        amount,
        sourceChainId,
        destChainId,
        preferredSpeed
      );
      console.log('CCTP fee quote:', cctpQuote);
      updateStep(0, {
        description: cctpQuote.usedFallback
          ? `Standard transfer from ${sourceChain.displayName} to ${destChain.displayName} (Fast unavailable)`
          : `${cctpQuote.speed === 'FAST' ? 'Fast' : 'Standard'} transfer from ${sourceChain.displayName} to ${destChain.displayName}`,
      });

      // Execute CCTP bridge and wait for completion
      const result = await kit.bridge({
        from: { adapter, chain: sourceChainId },
        to: { adapter, chain: destChainId },
        amount,
        config: cctpConfig,
      });

      console.log('CCTP Result:', result);

      // See the matching comment in bridgeToStacks: Bridge Kit can report
      // failure - including kit.bridge() itself resolving with
      // state:'error' after an internal timeout, not just via a later
      // result.wait() throw - even after the destination mint actually
      // landed. Reconcile every failure signal against the real destination
      // balance before treating it as genuine.
      let bridgeFailed = result.state === 'error' || !result.steps || result.steps.length === 0;
      let failureReason = bridgeFailed ? describeBridgeFailure(result) : '';

      if (!bridgeFailed && result.wait) {
        console.log('Waiting for CCTP bridge to complete...');
        try {
          await result.wait();
          console.log('CCTP bridge completed successfully');
          if (result.state === 'error') {
            bridgeFailed = true;
            failureReason = 'Bridge operation failed during execution';
          }
        } catch (waitError) {
          bridgeFailed = true;
          failureReason = waitError instanceof Error ? waitError.message : String(waitError);
        }
      }

      if (bridgeFailed) {
        console.warn('CCTP bridge reported failure - checking destination balance before giving up:', failureReason);
        const window = reconcileWindowMs(cctpQuote.speed);
        const mintConfirmed = await reconcileMintByBalance(
          fetchBalance,
          destChainId,
          destBalanceBeforeCctp,
          parseFloat(amount),
          window,
          (elapsedMs) => {
            const label = cctpQuote.speed === 'FAST'
              ? `Confirming mint on ${destChain.displayName}`
              : `Standard transfer - waiting for source-chain finality (this can take 15-30 min)`;
            updateStep(0, { description: `${label}... (${formatMinutesSeconds(elapsedMs)})` });
          }
        );
        if (!mintConfirmed) {
          throw new Error(
            `Your USDC was burned on ${sourceChain.displayName}, but we could not confirm it arrived on ${destChain.displayName} yet. ` +
            `Check your ${destChain.displayName} balance before retrying - do not resubmit, as that can fail with "nonce already used" if the funds already arrived.`
          );
        }
        console.log('Mint confirmed via destination balance check despite Bridge Kit reporting failure:', failureReason);
      }

      // See the matching comment in bridgeToStacks: the last step is
      // typically the destination-chain 'mint' step, not the source-chain
      // 'burn' step, so grab the burn step explicitly for the source tx link.
      const burnStep = result.steps?.find((s) => s.name === 'burn');
      const mintStep = result.steps?.find((s) => s.name === 'mint');
      const txHash = burnStep?.txHash ?? result.steps?.[result.steps.length - 1]?.txHash;

      // Verify the transaction was actually successful
      if (!txHash) {
        throw new Error('No transaction hash found - bridge may have been cancelled');
      }

      // kit.bridge() only resolves once the full transfer (including
      // attestation and mint) has completed, so by this point it's already done.
      updateStep(0, {
        status: 'completed',
        txHash,
        explorerUrl: burnStep?.explorerUrl || `${sourceChain.blockExplorer}/tx/${txHash}`,
        description: mintStep?.txHash
          ? `Minted on ${destChain.displayName}: ${mintStep.txHash.slice(0, 10)}...${mintStep.txHash.slice(-6)}`
          : `Transfer complete.`,
      });

      setBridgeState(prev => ({
        ...prev,
        isLoading: false,
        isCompleted: true,
      }));

      return true;
    } catch (error: any) {
      console.error('EVM-to-EVM bridge failed:', error);
      
      updateStep(0, { 
        status: 'failed', 
        error: friendlyErrorMessage(error, 'Bridge failed'),
      });

      setBridgeState(prev => ({ 
        ...prev, 
        isLoading: false, 
        error: friendlyErrorMessage(error, 'Bridge failed'),
      }));

      return false;
    }
  }, [address, walletClient, ensureCorrectChain, updateStep, fetchBalance]);

  // Reset bridge state
  const resetBridgeState = useCallback(() => {
    currentStepIndexRef.current = 0;
    setBridgeState({
      isLoading: false,
      currentStepIndex: 0,
      steps: [],
      error: null,
      isCompleted: false,
    });
  }, []);

  // Get current connected chain info
  const currentChain = connectedChainId ? getChainByChainId(connectedChainId) : null;

  return {
    // Connection state
    address,
    isConnected,
    currentChain,
    connectedChainId,

    // Balances
    sourceBalance,
    ethBalance,
    isLoadingBalance,
    refreshBalances,
    fetchBalance,

    // Bridge operations
    bridgeToStacks,
    bridgeEvmToEvm,
    bridgeEthToStacks,
    
    // Bridge state
    bridgeState,
    resetBridgeState,

    // Chain switching
    ensureCorrectChain,

    // Supported chains
    supportedChains,
  };
}
