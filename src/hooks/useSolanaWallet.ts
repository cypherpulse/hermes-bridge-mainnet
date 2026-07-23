import { useState, useCallback, useEffect, useMemo } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useBridge } from './useBridge';
import { PublicKey, Connection, clusterApiUrl, VersionedTransaction } from '@solana/web3.js';
import { friendlyErrorMessage } from '@/lib/error-messages';
import { calculateBridgeFee } from '@/lib/cctp-fees';

const SOLANA_CCTP_DOMAIN = 5;
const ETHEREUM_CCTP_DOMAIN = 0;

declare global {
  interface Window {
    solana?: any;
    ethereum?: any;
  }
}

export function useSolanaWallet() {
  const [usdcBalance, setUsdcBalance] = useState<number | null>(null);
  const [solBalance, setSolBalance] = useState<number | null>(null);
  const [solanaAddress, setSolanaAddress] = useState<string | null>(null);
  const {
    publicKey,
    connected,
    wallet,
    connect: connectSolanaWallet,
    disconnect: disconnectSolanaWallet,
    signTransaction,
    signAllTransactions,
    signMessage,
  } = useWallet();
  const { checkAllowance, approveUSDC, depositToStacks } = useBridge();

  // DEVNET USDC MINT ADDRESS
  const USDC_MINT = useMemo(() => 
    new PublicKey(import.meta.env.VITE_SOLANA_USDC_MINT), // Devnet USDC
    []
  );

  // Use devnet connection
  const devnetConnection = useMemo(() => 
    new Connection(clusterApiUrl('devnet'), 'confirmed'),
    []
  );

  useEffect(() => {
    if (connected && publicKey) {
      setSolanaAddress(publicKey.toString());
    } else {
      setSolanaAddress(null);
    }
  }, [connected, publicKey]);

  // Override Connection.simulateTransaction to sign tx if not signed
  useEffect(() => {
    const originalSimulate = Connection.prototype.simulateTransaction;
    Connection.prototype.simulateTransaction = async function(tx, config) {
      if (tx.signatures.some(s => s !== null)) {
        // Already signed
        return originalSimulate.call(this, tx, config);
      } else {
        // Sign first
        console.log('Global simulate: signing tx');
        const signFunction = (window as any).solanaSignFunction;
        if (signFunction) {
          const signedTx = await signFunction(tx);
          return originalSimulate.call(this, signedTx, config);
        } else {
          return originalSimulate.call(this, tx, config);
        }
      }
    };
    return () => {
      Connection.prototype.simulateTransaction = originalSimulate;
    };
  }, []);

  useEffect(() => {
    (window as any).solanaSignFunction = signTransaction;
  }, [signTransaction]);

  const fetchUsdcBalance = useCallback(async () => {
    if (!solanaAddress) return;

    try {
      const ownerPublicKey = new PublicKey(solanaAddress);
      const tokenAccounts = await devnetConnection.getTokenAccountsByOwner(ownerPublicKey, {
        mint: USDC_MINT,
      });

      if (tokenAccounts.value.length > 0) {
        const tokenAccountInfo = await devnetConnection.getTokenAccountBalance(tokenAccounts.value[0].pubkey);
        setUsdcBalance(tokenAccountInfo.value.uiAmount || 0);
      } else {
        setUsdcBalance(0);
      }
    } catch (error) {
      console.error('Failed to fetch USDC balance:', error);
      setUsdcBalance(null);
    }
  }, [solanaAddress, USDC_MINT, devnetConnection]);

  const fetchSolBalance = useCallback(async () => {
    if (!solanaAddress) return;

    try {
      const ownerPublicKey = new PublicKey(solanaAddress);
      const balance = await devnetConnection.getBalance(ownerPublicKey);
      // Convert lamports to SOL (1 SOL = 1e9 lamports)
      setSolBalance(balance / 1e9);
    } catch (error) {
      console.error('Failed to fetch SOL balance:', error);
      setSolBalance(null);
    }
  }, [solanaAddress, devnetConnection]);

  useEffect(() => {
    if (solanaAddress) {
      fetchUsdcBalance();
      fetchSolBalance();
    } else {
      setUsdcBalance(null);
      setSolBalance(null);
    }
  }, [solanaAddress, fetchUsdcBalance, fetchSolBalance]);

  const bridgeToStacks = useCallback(async (amount: string, stacksRecipient: string): Promise<boolean> => {
    console.log('=== Bridge Debug Info ===');
    console.log('Wallet connected:', connected);
    console.log('Solana address:', solanaAddress);
    console.log('Amount:', amount);
    console.log('Stacks recipient:', stacksRecipient);
    console.log('Wallet adapter:', wallet?.adapter.name);

    if (!connected || !solanaAddress || !wallet) {
      throw new Error('Solana wallet must be connected');
    }

    if (!publicKey) {
      throw new Error('Solana public key not found');
    }

    if (!window.ethereum) {
      throw new Error('Ethereum wallet (MetaMask, etc.) is required for the bridge. Please install and connect an Ethereum wallet.');
    }

    // Check if Ethereum wallet is connected
    const accounts = await (window as any).ethereum.request({ method: 'eth_accounts' });
    if (!accounts || accounts.length === 0) {
      throw new Error('Please connect your Ethereum wallet (MetaMask, etc.) to Sepolia testnet');
    }
    console.log('Ethereum wallet connected:', accounts[0]);

    // Validate amount
    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      throw new Error('Please enter a valid amount');
    }

    if (usdcBalance !== null && numAmount > usdcBalance) {
      throw new Error(`Insufficient balance. You have ${usdcBalance} USDC but tried to bridge ${amount} USDC`);
    }

    const [
      { BridgeKit },
      { createSolanaKitAdapterFromProvider },
      { createViemAdapterFromProvider },
    ] = await Promise.all([
      import('@circle-fin/bridge-kit'),
      import('@circle-fin/adapter-solana-kit'),
      import('@circle-fin/adapter-viem-v2'),
    ]);

    console.log('Starting Solana DEVNET to Stacks bridge using Circle Bridge Kit...');

    if (!connected || !publicKey) {
      throw new Error('Solana wallet must be connected');
    }
    if (!signTransaction) {
      throw new Error('This Solana wallet does not support transaction signing');
    }

    // Bridge Kit's Solana adapter (@circle-fin/adapter-solana-kit) calls
    // provider.signTransaction/signAllTransactions with a BASE64-ENCODED WIRE
    // STRING (getBase64EncodedWireTransaction), then reads `.signatures[0]`
    // off whatever comes back. But @solana/wallet-adapter-react's signer
    // expects a VersionedTransaction OBJECT, not a base64 string - so passing
    // the string straight through meant the wallet never received a real
    // transaction to sign, no popup appeared, and the SDK reported "Could not
    // determine this transaction's signature". This wrapper bridges the two:
    // deserialize the wire string -> sign the object via the wallet-adapter
    // connector (the same bound, already-connected signer the rest of the app
    // uses) -> return the signed VersionedTransaction, whose `.signatures[0]`
    // the SDK then extracts.
    const toVersionedTx = (input: unknown): VersionedTransaction => {
      if (input instanceof VersionedTransaction) return input;
      if (input instanceof Uint8Array) return VersionedTransaction.deserialize(input);
      if (typeof input === 'string') {
        return VersionedTransaction.deserialize(Uint8Array.from(atob(input), (c) => c.charCodeAt(0)));
      }
      throw new Error('Unexpected transaction format from Bridge Kit Solana adapter');
    };

    const solanaProvider = {
      isConnected: connected,
      address: publicKey.toString(),
      connect: async () => {
        if (!connected) await connectSolanaWallet();
        return { address: publicKey.toString() };
      },
      disconnect: () => disconnectSolanaWallet(),
      signTransaction: async (transaction: unknown) => {
        const tx = toVersionedTx(transaction);
        return await signTransaction(tx);
      },
      signAllTransactions: signAllTransactions
        ? async (transactions: unknown[]) => {
            const txs = transactions.map(toVersionedTx);
            return await signAllTransactions(txs);
          }
        : undefined,
      signMessage: signMessage
        ? (message: Uint8Array) => signMessage(message)
        : undefined,
    };

    console.log('Creating Solana adapter from wallet-adapter connector...', wallet?.adapter.name);

    const solanaAdapterKit = await createSolanaKitAdapterFromProvider({
      provider: solanaProvider,
      connection: devnetConnection,
    }) as any;

    console.log('Creating EVM adapter...');

    const evmAdapter = await createViemAdapterFromProvider({
      provider: (window as any).ethereum,
    });

    console.log('✅ Adapters created successfully');

    const kit = new BridgeKit({ disableErrorReporting: true });

    console.log('🚀 Bridging from Solana DEVNET to Ethereum Sepolia...');
    console.log('Amount:', amount, 'USDC');
    console.log('From:', solanaAddress);

    // CCTP v2 fee/speed quote: try Fast, fall back to Standard on failure.
    // https://developers.circle.com/cctp/concepts/fees
    const feeQuote = await calculateBridgeFee({
      amountUsdc: amount,
      sourceDomain: SOLANA_CCTP_DOMAIN,
      destDomain: ETHEREUM_CCTP_DOMAIN,
      preferredSpeed: 'FAST',
      includeProtocolFee: false,
    });
    console.log('CCTP fee quote:', feeQuote);

    // Step 1: Bridge from Solana DEVNET to Ethereum SEPOLIA using CCTP
    const cctpResult = await kit.bridge({
      from: { adapter: solanaAdapterKit, chain: 'Solana_Devnet' },
      to: { adapter: evmAdapter, chain: 'Ethereum_Sepolia' },
      amount,
      config: {
        transferSpeed: feeQuote.speed === 'FAST' ? 'FAST' : 'SLOW',
        maxFee: feeQuote.circleMaxFeeUsdc,
      },
    });

    // console.log an object directly rather than JSON.stringify - Bridge Kit
    // results can contain BigInt values, which JSON.stringify cannot
    // serialize and throws on (this previously crashed the whole bridge
    // right after the CCTP step succeeded).
    console.log('CCTP Result:', cctpResult);

    if (!cctpResult || !cctpResult.steps || cctpResult.steps.length === 0) {
      throw new Error('CCTP bridge failed: No result or steps returned');
    }

    const failedSteps = cctpResult.steps.filter((step: any) => step.state === 'error' || step.state === 'failed');
    if (failedSteps.length > 0) {
      console.error('Failed steps:', failedSteps);
      const errorDetails = failedSteps.map((s: any) => `${s.name}: ${s.errorMessage || 'Unknown error'}`).join('\n');
      throw new Error(`CCTP bridge failed:\n${errorDetails}`);
    }

    console.log('✅ All CCTP steps successful! USDC has landed on Ethereum Sepolia.');
    console.log('🚀 Depositing into xReserve to mint USDCx on Stacks...');

    // Step 2: Ethereum -> Stacks via xReserve (NOT a Stacks-to-Stacks
    // transfer - the freshly-bridged USDC needs to be deposited into
    // xReserve to mint new USDCx, same as the direct Ethereum bridge flow).
    const currentAllowance = await checkAllowance();
    const requiredAmount = BigInt(Math.floor(numAmount * 1_000_000));
    if (currentAllowance < requiredAmount) {
      console.log('Approving xReserve to spend USDC...');
      await approveUSDC(amount);
    }

    const depositTxHash = await depositToStacks(amount, stacksRecipient);
    if (!depositTxHash) {
      throw new Error('xReserve deposit failed');
    }

    console.log('✅ Complete Solana Devnet to Stacks bridge successful!');
    console.log('xReserve deposit tx:', depositTxHash);
    return true;
  }, [
    solanaAddress,
    connected,
    wallet,
    publicKey,
    usdcBalance,
    devnetConnection,
    checkAllowance,
    approveUSDC,
    depositToStacks,
    connectSolanaWallet,
    disconnectSolanaWallet,
    signTransaction,
    signAllTransactions,
    signMessage,
  ]);

  return {
    solanaAddress,
    usdcBalance,
    solBalance,
    fetchUsdcBalance,
    fetchSolBalance,
    bridgeToStacks,
  };
}