import { useCallback, useState } from 'react';
import { useAccount, useBalance, usePublicClient, useWalletClient, useReadContract } from 'wagmi';
import { parseUnits, formatUnits, type Address, type Hex, type PublicClient } from 'viem';
import { mainnet } from 'viem/chains';
import { BRIDGE_CONFIG, ERC20_ABI, X_RESERVE_ABI } from '@/lib/bridge-config';
import { encodeStacksAddress } from '@/lib/stacks-address';
import { calculateBridgeFee, calculateProtocolFee, XRESERVE_FAST_FEE_BPS, type TransferSpeedPreference, type BridgeFeeQuote } from '@/lib/cctp-fees';

/**
 * Wait for a tx receipt, but if the RPC's own timeout fires, keep polling the
 * receipt directly for a grace period rather than assuming failure - the tx
 * was already broadcast (we have its hash) and may still land. Returns the
 * final status, or 'unknown' if it never appeared within the window.
 */
async function confirmTransaction(
  client: PublicClient,
  hash: `0x${string}`,
  timeoutMs = 120_000,
  graceMs = 3 * 60_000,
  pollIntervalMs = 8_000
): Promise<'success' | 'reverted' | 'unknown'> {
  try {
    const receipt = await client.waitForTransactionReceipt({ hash, timeout: timeoutMs });
    return receipt.status === 'success' ? 'success' : 'reverted';
  } catch {
    const start = Date.now();
    while (Date.now() - start < graceMs) {
      try {
        const receipt = await client.getTransactionReceipt({ hash });
        return receipt.status === 'success' ? 'success' : 'reverted';
      } catch {
        // Not mined yet - keep polling.
      }
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
    return 'unknown';
  }
}

export function useBridge() {
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const [lastDepositTx, setLastDepositTx] = useState<string | null>(null);

  // ETH balance
  const { data: ethBalanceData, refetch: refetchEth } = useBalance({
    address,
  });

  // USDC balance using useReadContract
  const { data: usdcBalanceRaw, refetch: refetchUsdc } = useReadContract({
    address: BRIDGE_CONFIG.ETH_USDC_CONTRACT as Address,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: {
      enabled: !!address,
    },
  });

  const ethBalance = ethBalanceData ? formatUnits(ethBalanceData.value, ethBalanceData.decimals) : '0';
  const usdcBalance = usdcBalanceRaw ? formatUnits(usdcBalanceRaw as bigint, 6) : '0';

  const refreshBalances = useCallback(() => {
    refetchEth();
    refetchUsdc();
  }, [refetchEth, refetchUsdc]);

  // Check current USDC allowance for xReserve
  const checkAllowance = useCallback(async (): Promise<bigint> => {
    if (!publicClient || !address) return 0n;
    
    const allowance = await publicClient.readContract({
      address: BRIDGE_CONFIG.ETH_USDC_CONTRACT as Address,
      abi: ERC20_ABI,
      functionName: 'allowance',
      args: [address, BRIDGE_CONFIG.X_RESERVE_CONTRACT as Address],
    });
    
    return allowance as bigint;
  }, [publicClient, address]);

  const approveUSDC = useCallback(async (amount: string): Promise<string | null> => {
    if (!walletClient || !address || !publicClient) {
      throw new Error('Wallet not connected');
    }

    const value = parseUnits(amount, 6);

    const hash = await walletClient.writeContract({
      address: BRIDGE_CONFIG.ETH_USDC_CONTRACT as Address,
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [BRIDGE_CONFIG.X_RESERVE_CONTRACT as Address, value],
      chain: mainnet,
      account: address,
    });

    // Confirm on-chain before returning so the UI only marks "Approve"
    // complete once it actually is - a submitted-but-unmined tx must not
    // read as done.
    const outcome = await confirmTransaction(publicClient, hash);
    if (outcome === 'reverted') {
      throw new Error('USDC approval transaction reverted on-chain.');
    }
    if (outcome === 'unknown') {
      throw new Error(`Could not confirm the USDC approval (tx ${hash.slice(0, 10)}...${hash.slice(-6)}). Check your wallet before retrying.`);
    }

    await refreshBalances();
    return hash;
  }, [walletClient, address, publicClient, refreshBalances]);

  // xReserve's depositToRemote has no fee-recipient parameter (unlike Bridge
  // Kit's customFee on the multichain/CCTP leg), so the Hermes protocol fee
  // on this leg is collected as a separate plain USDC transfer to our
  // treasury, on top of the deposited amount - matching the multichain
  // path's "fee added on top" semantics. Returns null (no tx) if the fee
  // rounds to zero or the recipient isn't configured.
  const payProtocolFee = useCallback(async (amount: string): Promise<string | null> => {
    if (!walletClient || !address || !publicClient) {
      throw new Error('Wallet not connected');
    }
    if (!BRIDGE_CONFIG.PROTOCOL_FEE_RECIPIENT_EVM) {
      return null;
    }

    const { feeUsdc } = calculateProtocolFee(amount);
    if (parseFloat(feeUsdc) <= 0) {
      return null;
    }

    const hash = await walletClient.writeContract({
      address: BRIDGE_CONFIG.ETH_USDC_CONTRACT as Address,
      abi: ERC20_ABI,
      functionName: 'transfer',
      args: [BRIDGE_CONFIG.PROTOCOL_FEE_RECIPIENT_EVM as Address, parseUnits(feeUsdc, 6)],
      chain: mainnet,
      account: address,
    });

    const outcome = await confirmTransaction(publicClient, hash);
    if (outcome === 'reverted') {
      throw new Error('Fee payment transaction reverted on-chain.');
    }
    if (outcome === 'unknown') {
      throw new Error(`Could not confirm the fee payment (tx ${hash.slice(0, 10)}...${hash.slice(-6)}). Check your wallet before retrying.`);
    }

    await refreshBalances();
    return hash;
  }, [walletClient, address, publicClient, refreshBalances]);

  const depositToStacks = useCallback(async (
    amount: string,
    stacksRecipient: string,
    preferredSpeed: TransferSpeedPreference = 'FAST'
  ): Promise<string | null> => {
    if (!walletClient || !address || !publicClient) {
      throw new Error('Wallet not connected');
    }

    const value = parseUnits(amount, 6);

    // xReserve wraps CCTP v2 under the hood; maxFee gates Fast Transfer
    // eligibility the same way TokenMessengerV2's depositForBurn does.
    // https://developers.circle.com/xreserve/tutorials/deposit-usdc-into-xreserve
    const feeQuote: BridgeFeeQuote = await calculateBridgeFee({
      amountUsdc: amount,
      sourceDomain: 0, // Ethereum
      destDomain: BRIDGE_CONFIG.STACKS_DOMAIN,
      preferredSpeed,
      includeProtocolFee: false,
      // Circle's fee API can't quote the Stacks domain (HTTP 400), so without
      // this every Ethereum->Stacks bridge silently degraded to Standard
      // (maxFee 0) and took 10-20 min even with Fast selected. xReserve has no
      // finality-threshold param, so a nonzero maxFee is the only Fast signal.
      fallbackFastFeeBps: XRESERVE_FAST_FEE_BPS,
    });
    const maxFee = parseUnits(feeQuote.circleMaxFeeUsdc, 6);
    const remoteRecipient = encodeStacksAddress(stacksRecipient);
    const hookData = '0x' as Hex;

    // Log for debugging
    console.log('=== Bridge Deposit Debug ===');
    console.log('Amount (raw):', value.toString());
    console.log('Stacks Domain:', BRIDGE_CONFIG.STACKS_DOMAIN);
    console.log('Remote Recipient (encoded):', remoteRecipient);
    console.log('Local Token:', BRIDGE_CONFIG.ETH_USDC_CONTRACT);
    console.log('Fee quote:', feeQuote);
    console.log('Max Fee:', maxFee.toString());
    console.log('xReserve Contract:', BRIDGE_CONFIG.X_RESERVE_CONTRACT);

    const depositArgs = [
      value,
      BRIDGE_CONFIG.STACKS_DOMAIN,
      remoteRecipient,
      BRIDGE_CONFIG.ETH_USDC_CONTRACT as Address,
      maxFee,
      hookData,
    ] as const;

    // depositToRemote is a heavy call - a wallet fee estimate that ends up too
    // low for current network conditions makes the tx silently sit unbroadcast
    // and never mine (no error, no receipt). Estimate gas/fees explicitly with
    // a buffer, falling back to wallet defaults only if estimation fails.
    let gasOverrides: { gas?: bigint; maxFeePerGas?: bigint; maxPriorityFeePerGas?: bigint } = {};
    try {
      const [gasEstimate, feesPerGas] = await Promise.all([
        publicClient.estimateContractGas({
          address: BRIDGE_CONFIG.X_RESERVE_CONTRACT as Address,
          abi: X_RESERVE_ABI,
          functionName: 'depositToRemote',
          args: depositArgs,
          account: address,
        }),
        publicClient.estimateFeesPerGas(),
      ]);
      gasOverrides = {
        gas: (gasEstimate * 130n) / 100n,
        maxFeePerGas: (feesPerGas.maxFeePerGas * 150n) / 100n,
        maxPriorityFeePerGas: (feesPerGas.maxPriorityFeePerGas * 150n) / 100n,
      };
    } catch (estimateError) {
      console.warn('Deposit gas/fee estimation failed, using wallet defaults:', estimateError);
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

    // Confirm the deposit actually landed before handing off to Stacks-side
    // monitoring - otherwise a never-mined deposit would leave monitoring
    // waiting forever (or worse, complete off a stale mint).
    const outcome = await confirmTransaction(publicClient, hash);
    if (outcome === 'reverted') {
      throw new Error('xReserve deposit transaction reverted on-chain.');
    }
    if (outcome === 'unknown') {
      throw new Error(`Could not confirm the xReserve deposit (tx ${hash.slice(0, 10)}...${hash.slice(-6)}). Check your wallet on Etherscan before retrying - do not resubmit if it already confirmed.`);
    }

    await refreshBalances();

    setLastDepositTx(hash);
    console.log('=== Deposit TX Confirmed ===');
    console.log('TX Hash:', hash);
    console.log('View on Etherscan:', `https://etherscan.io/tx/${hash}`);

    return hash;
  }, [walletClient, address, publicClient, refreshBalances]);

  return {
    address: address ?? null,
    isConnected,
    ethBalance,
    usdcBalance,
    refreshBalances,
    checkAllowance,
    approveUSDC,
    payProtocolFee,
    depositToStacks,
    lastDepositTx,
  };
}
