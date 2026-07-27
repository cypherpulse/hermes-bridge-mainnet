import { useState, useCallback, useEffect } from 'react';
import {
  connect,
  disconnect,
  isConnected as checkIsConnected,
  getLocalStorage,
  request
} from '@stacks/connect';
import { Cl, Pc } from '@stacks/transactions';
import { hiroFetch } from '@/lib/hiro-api';
import { createTrackedTransaction, reportLeg, updateTrackedStatus } from '@/lib/tracking-client';

// USDCx contract details on mainnet
const USDCX_CONTRACT = {
  address: import.meta.env.VITE_USDCX_ADDRESS,
  name: import.meta.env.VITE_USDCX_NAME,
  assetName: import.meta.env.VITE_USDCX_ASSET_NAME,
};

// USDCx v1 contract for minting/burning
const USDCX_V1_CONTRACT = {
  address: import.meta.env.VITE_USDCX_V1_ADDRESS || 'SP120SBRBQJ00MCWS7TM5R8WJNTTKD5K0HFRC2CNE', // Default mainnet address
  name: 'usdcx-v1',
};

/**
 * Reads the connected mainnet Stacks address directly from wallet storage,
 * fresh, rather than trusting a value cached in React state from whenever
 * connectWallet last ran. usdcx's transfer function asserts on-chain that
 * tx-sender equals the `sender` argument we pass it - if the wallet's
 * actual active account has since diverged from our cached `stacksAddress`
 * (e.g. the user switched accounts inside the extension), signing with the
 * real active account while asserting a stale one as `sender` aborts with
 * `(err u4)`. Re-deriving this immediately before building each contract
 * call keeps the two in sync.
 */
function getCurrentMainnetStacksAddress(): string | null {
  const storage = getLocalStorage();
  const stxAddresses = storage?.addresses?.stx;
  if (!stxAddresses || stxAddresses.length === 0) return null;
  const mainnetAddr = stxAddresses.find((a: { address: string }) => a.address.startsWith('SP'));
  return mainnetAddr?.address || stxAddresses[0]?.address || null;
}

/**
 * Poll a Stacks tx until it confirms (success/abort) or the window elapses,
 * in the background - never awaited by the caller, since a transfer already
 * returns its txid to the user immediately (matching TransferForm's
 * existing "Transfer Submitted!" UX). This is what turns that submission
 * into a real "completed"/"failed" tracked status once it actually confirms
 * on-chain, mirroring useWithdrawStatus's checkStacksBurnStatus.
 */
async function pollTransferConfirmation(
  trackedId: string | null,
  txId: string,
  maxWaitMs = 5 * 60_000,
  pollIntervalMs = 10_000
): Promise<void> {
  if (!trackedId) return;
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    try {
      const res = await hiroFetch(`https://api.hiro.so/extended/v1/tx/${txId}`);
      const data = await res.json();
      if (data.tx_status === 'success') {
        reportLeg(trackedId, {
          legType: 'stacks_transfer',
          fromChain: 'Stacks',
          toChain: 'Stacks',
          txHash: txId,
          status: 'confirmed',
        });
        updateTrackedStatus(trackedId, { status: 'completed' });
        return;
      }
      if (typeof data.tx_status === 'string' && data.tx_status.startsWith('abort')) {
        reportLeg(trackedId, {
          legType: 'stacks_transfer',
          fromChain: 'Stacks',
          toChain: 'Stacks',
          txHash: txId,
          status: 'failed',
          errorMessage: data.vm_error ?? 'Transfer transaction aborted on-chain',
        });
        updateTrackedStatus(trackedId, { status: 'failed', errorMessage: data.vm_error ?? 'Transfer aborted on-chain' });
        return;
      }
    } catch (error) {
      console.warn('[useStacksWallet] Error polling transfer confirmation:', error);
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
  // Timed out without a definitive on-chain result - leave it for the
  // backend's own on-chain audit to reconcile later rather than guessing.
  reportLeg(trackedId, {
    legType: 'stacks_transfer',
    fromChain: 'Stacks',
    toChain: 'Stacks',
    txHash: txId,
    status: 'unknown',
  });
}

export function useStacksWallet() {
  const [stacksAddress, setStacksAddress] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [usdcxBalance, setUsdcxBalance] = useState<string>('0');
  const [minWithdrawalAmount, setMinWithdrawalAmount] = useState<string>('5');
  const [isLoading, setIsLoading] = useState(false);

  const fetchUsdcxBalance = async (address: string) => {
    try {
      const response = await hiroFetch(
        `https://api.hiro.so/extended/v1/address/${address}/balances`
      );
      const data = await response.json();

      // Look for USDCx token balance
      const usdcxKey = `${USDCX_CONTRACT.address}.${USDCX_CONTRACT.name}::${USDCX_CONTRACT.assetName}`;
      const balance = data.fungible_tokens?.[usdcxKey]?.balance || '0';

      // Convert from micro-units (6 decimals)
      const formatted = (parseInt(balance) / 1_000_000).toFixed(6);
      setUsdcxBalance(formatted);
    } catch (error) {
      console.error('Error fetching USDCx balance:', error);
      setUsdcxBalance('0');
    }
  };

  const fetchMinWithdrawalAmount = async () => {
    try {
      const response = await hiroFetch(
        `https://api.hiro.so/v2/contracts/call-read/${USDCX_V1_CONTRACT.address}/${USDCX_V1_CONTRACT.name}/get-min-withdrawal-amount`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            sender: USDCX_V1_CONTRACT.address,
            arguments: []
          })
        }
      );

      if (response.ok) {
        const data = await response.json();
        // Parse the Clarity response - assuming it returns a uint
        const amount = data.result?.value?.value || '5000000'; // Default to 5 USDCx in micro-units
        const formatted = (parseInt(amount) / 1_000_000).toFixed(6);
        setMinWithdrawalAmount(formatted);
      }
    } catch (error) {
      console.error('Error fetching min withdrawal amount:', error);
      // Keep default value
    }
  };

  // Check if already connected on mount
  useEffect(() => {
    const checkConnection = () => {
      if (checkIsConnected()) {
        const address = getCurrentMainnetStacksAddress();
        if (address) {
          setStacksAddress(address);
          setIsConnected(true);
          fetchUsdcxBalance(address);
        }
      }
    };
    checkConnection();
    fetchMinWithdrawalAmount(); // Fetch min withdrawal amount on mount
  }, []);

  const connectWallet = useCallback(async () => {
    try {
      setIsLoading(true);

      await connect({
        forceWalletSelect: true,
        approvedProviderIds: ['LeatherProvider', 'XverseProviders.BitcoinProvider'],
      });

      const address = getCurrentMainnetStacksAddress();
      if (address) {
        setStacksAddress(address);
        setIsConnected(true);
        fetchUsdcxBalance(address);
      }
      setIsLoading(false);
    } catch (error) {
      console.error('Error connecting wallet:', error);
      setIsLoading(false);
    }
  }, []);

  const disconnectWallet = useCallback(() => {
    disconnect();
    setStacksAddress(null);
    setIsConnected(false);
    setUsdcxBalance('0');
  }, []);

  const refreshBalance = useCallback(() => {
    if (stacksAddress) {
      fetchUsdcxBalance(stacksAddress);
    }
    fetchMinWithdrawalAmount();
  }, [stacksAddress]);

  const transferUsdcx = useCallback(async (
    recipient: string,
    amount: string
  ): Promise<string | null> => {
    console.log('transferUsdcx called with:', { recipient, amount });
    console.log('amount type:', typeof amount, 'amount value:', amount);

    if (!stacksAddress) {
      throw new Error('Wallet not connected');
    }

    setIsLoading(true);

    // Fired now (not awaited) so it runs in the background while the actual
    // transfer proceeds - reportLeg/updateTrackedStatus accept this promise
    // directly, so nothing here ever blocks on tracking.
    const trackedTxPromise = createTrackedTransaction({
      stacksAddress,
      recipientAddress: recipient,
      bridgeType: 'stacks_transfer',
      sourceChain: 'Stacks',
      destinationChain: 'Stacks',
      amount,
      speed: 'FAST',
    });

    try {
      // Convert amount to micro-units (6 decimals)
      const parsedAmount = parseFloat(amount);
      console.log('parsed amount:', parsedAmount, 'isNaN:', isNaN(parsedAmount));

      if (isNaN(parsedAmount) || parsedAmount <= 0) {
        throw new Error('Invalid amount: ' + amount);
      }

      const microAmount = BigInt(Math.floor(parsedAmount * 1_000_000));
      console.log('micro amount:', microAmount);

      // usdcx's `transfer` (confirmed against the deployed contract source)
      // is `(amount, sender, recipient, memo)`, asserting
      // `(is-eq tx-sender sender)` - err u4 (ERR_NOT_OWNER) if not.
      //
      // stx_callContract is what reliably opens the wallet signing prompt
      // (Leather/Xverse don't implement the newer stx_transferSip10Ft
      // helper, so that one silently never triggers). The one thing we must
      // get right is that the account the wallet signs with (tx-sender)
      // equals the `sender` argument we pass. Pin BOTH to the same connected
      // account: pass `address` so the wallet is asked to sign with that
      // exact account, and use it as the `sender` arg too. `stacksAddress`
      // is the account the user actually connected with (what they see in
      // the UI), so this is the correct signer.
      const senderAddress = stacksAddress;

      const functionArgs = [
        Cl.uint(microAmount),
        Cl.principal(senderAddress),
        Cl.principal(recipient),
        Cl.none(),
      ];

      // A fungible post-condition makes Stacks itself guarantee this tx moves
      // EXACTLY this much USDCx from the sender and nothing more. With 'deny'
      // mode, any unexpected asset movement aborts the transaction on-chain.
      //
      // SELF-TRANSFER CAVEAT (learned the hard way on mainnet): Stacks
      // post-conditions evaluate the NET asset movement for a principal. When
      // sender === recipient the address sends X and receives X, so its net
      // movement is 0, and `willSendEq(X)` aborts with:
      //   "...owned by SP...: 10000 SentEq 0"
      // even though the contract call itself succeeded. So for a self-transfer
      // we skip the post-condition (there is no net outflow to constrain) and
      // fall back to 'allow' - 'deny' with an empty list would block every
      // asset movement and abort just the same. Real transfers to a different
      // address keep full post-condition protection.
      const isSelfTransfer = recipient === senderAddress;

      // Pass the amount as a decimal STRING, not the BigInt. The post-condition
      // is serialized to JSON to reach the wallet extension, and JSON.stringify
      // throws on BigInt ("Do not know how to serialize a BigInt"), which the
      // wallet surfaces as an opaque `JsonRpcError: Internal error`.
      const postConditions = isSelfTransfer
        ? []
        : [
            Pc.principal(senderAddress)
              .willSendEq(microAmount.toString())
              .ft(`${USDCX_CONTRACT.address}.${USDCX_CONTRACT.name}`, USDCX_CONTRACT.assetName),
          ];

      const response = await request('stx_callContract', {
        contract: `${USDCX_CONTRACT.address}.${USDCX_CONTRACT.name}`,
        functionName: 'transfer',
        functionArgs,
        postConditions,
        postConditionMode: isSelfTransfer ? 'allow' : 'deny',
        network: 'mainnet',
        address: senderAddress,
      });

      console.log('Transfer TX:', response.txid);
      setIsLoading(false);

      reportLeg(trackedTxPromise, {
        legType: 'stacks_transfer',
        fromChain: 'Stacks',
        toChain: 'Stacks',
        txHash: response.txid,
        status: 'submitted',
      });
      updateTrackedStatus(trackedTxPromise, { status: 'in_progress' });
      // Confirmation is polled in the background - the transfer already
      // returns its txid to the user immediately, matching TransferForm's
      // existing "Transfer Submitted!" UX (no monitoring wait here).
      trackedTxPromise.then((id) => void pollTransferConfirmation(id, response.txid));

      // Refresh balance after a delay
      setTimeout(() => refreshBalance(), 5000);

      return response.txid;
    } catch (error) {
      setIsLoading(false);
      console.error('Transfer error:', error);
      const message = error instanceof Error ? error.message : String(error);
      updateTrackedStatus(trackedTxPromise, { status: 'failed', errorMessage: message });
      throw error;
    }
  }, [stacksAddress, refreshBalance]);

  const burnUsdcx = useCallback(async (
    amount: string,
    ethereumAddress: string
  ): Promise<string | null> => {
    console.log('burnUsdcx called with:', { amount, ethereumAddress });

    if (!stacksAddress) {
      throw new Error('Wallet not connected');
    }

    setIsLoading(true);

    try {
      // Convert amount to micro-units (6 decimals)
      const parsedAmount = parseFloat(amount);
      console.log('parsed amount:', parsedAmount, 'isNaN:', isNaN(parsedAmount));

      if (isNaN(parsedAmount) || parsedAmount <= 0) {
        throw new Error('Invalid amount: ' + amount);
      }

      // Check minimum withdrawal amount
      const minAmount = parseFloat(minWithdrawalAmount);
      if (parsedAmount < minAmount) {
        throw new Error(`Amount must be at least ${minAmount} USDCx`);
      }

      const microAmount = BigInt(Math.floor(parsedAmount * 1_000_000));
      console.log('micro amount:', microAmount);

      // Convert Ethereum address to 32-byte buffer
      // Remove 0x prefix if present
      const cleanAddress = ethereumAddress.startsWith('0x') ? ethereumAddress.slice(2) : ethereumAddress;

      // Pad to 32 bytes (64 hex chars)
      const paddedAddress = cleanAddress.padStart(64, '0');
      const addressBuffer = Buffer.from(paddedAddress, 'hex');

      console.log('Calling burn with args:', {
        amount: microAmount.toString(),
        domain: 0, // Ethereum domain
        recipient: addressBuffer.toString('hex')
      });

      // Build function arguments using Cl helpers
      const functionArgs = [
        Cl.uint(microAmount), // amount
        Cl.uint(0), // native-domain (0 for Ethereum)
        Cl.buffer(addressBuffer), // native-recipient as 32-byte buffer
      ];

      console.log('Contract call:', {
        contract: `${USDCX_V1_CONTRACT.address}.${USDCX_V1_CONTRACT.name}`,
        functionName: 'burn',
        functionArgs: functionArgs.map(arg => arg.toString()),
      });

      // usdcx-v1.burn destroys the tokens via `ft-burn?` internally
      // (contract-call? .usdcx protocol-burn amount tx-sender), burning from
      // whichever address the connected wallet actually signs with - which
      // is not guaranteed to match our cached `stacksAddress` app state (the
      // wallet extension's active account can differ). A post-condition
      // asserting a specific principal sent the tokens was failing because
      // it named the wrong principal. Stacks' default postConditionMode is
      // 'deny', which aborts on ANY asset movement not covered by a
      // post-condition - so with no post-conditions we must explicitly use
      // 'allow' here; the contract's own mint-role/caller checks (see
      // usdcx-v1's protocol-burn) are what actually guard this operation.
      const response = await request('stx_callContract', {
        contract: `${USDCX_V1_CONTRACT.address}.${USDCX_V1_CONTRACT.name}`,
        functionName: 'burn',
        functionArgs,
        postConditions: [],
        postConditionMode: 'allow',
        network: 'mainnet',
        address: getCurrentMainnetStacksAddress() ?? stacksAddress,
      });

      console.log('Burn TX:', response.txid);
      setIsLoading(false);

      // Refresh balance after a delay
      setTimeout(() => refreshBalance(), 5000);

      return response.txid;
    } catch (error) {
      setIsLoading(false);
      console.error('Burn error:', error);
      throw error;
    }
  }, [stacksAddress, refreshBalance]);

  const approveUsdcx = useCallback(async (spender: string, amount: string): Promise<string | null> => {
    if (!stacksAddress) {
      throw new Error('Wallet not connected');
    }

    setIsLoading(true);

    try {
      const parsedAmount = parseFloat(amount);
      console.log('approve parsed amount:', parsedAmount, 'isNaN:', isNaN(parsedAmount));

      if (isNaN(parsedAmount) || parsedAmount <= 0) {
        throw new Error('Invalid amount: ' + amount);
      }

      const microAmount = BigInt(Math.floor(parsedAmount * 1_000_000));
      console.log('approve micro amount:', microAmount);

      // Build function arguments using Cl helpers
      const functionArgs = [
        Cl.principal(spender),
        Cl.uint(microAmount),
      ];

      // Use the new request API for contract calls
      const response = await request('stx_callContract', {
        contract: `${USDCX_CONTRACT.address}.${USDCX_CONTRACT.name}`,
        functionName: 'approve',
        functionArgs,
        postConditions: [],
        network: 'mainnet',
        address: getCurrentMainnetStacksAddress() ?? stacksAddress,
      });

      console.log('Approve TX:', response.txid);
      setIsLoading(false);

      // Refresh balance after a delay
      setTimeout(() => refreshBalance(), 5000);

      return response.txid;
    } catch (error) {
      setIsLoading(false);
      console.error('Approve error:', error);
      throw error;
    }
  }, [stacksAddress, refreshBalance]);

  return {
    stacksAddress,
    isConnected,
    usdcxBalance,
    minWithdrawalAmount,
    isLoading,
    connectWallet,
    disconnectWallet,
    transferUsdcx,
    burnUsdcx,
    approveUsdcx,
    refreshBalance,
  };
}
