/**
 * MultiChainBridgeForm Component
 * 
 * Main form for multichain bridging operations.
 * Supports two modes:
 * 1. Bridge to Stacks (Source → ETH → Stacks)
 * 2. EVM-to-EVM bridging (Source ↔ Destination)
 */

import { useState, useEffect } from 'react';
import {
  ArrowDown,
  AlertCircle,
  Loader2,
  CheckCircle2,
  XCircle,
  ExternalLink,
  ArrowRight,
  Zap,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { ChainSelector, ChainSelectorWithStacks } from './ChainSelector';
import { BridgeProgress } from './BridgeProgress';
import { useMultiChainBridge, type BridgeStep } from '@/hooks/useMultiChainBridge';
import { useBridgeFeeQuote } from '@/hooks/useBridgeFeeQuote';
import { isValidStacksAddress } from '@/lib/stacks-address';
import { fetchUsdcxBalance } from '@/lib/stacks-usdcx';
import { type CCTPChainId, CCTP_CHAINS } from '@/lib/multichain-bridge-config';
import { BRIDGE_CONFIG } from '@/lib/bridge-config';
import { calculateProtocolFee, type TransferSpeedPreference } from '@/lib/cctp-fees';
import { cn, formatUsd, formatFeeUsd, formatTokenAmount, sanitizeAmountInput } from '@/lib/utils';
import { LargeAmountConfirm, isLargeAmount } from '@/components/bridge/LargeAmountConfirm';

interface MultiChainBridgeFormProps {
  isWalletConnected: boolean;
  stacksAddress: string | null;
}

export function MultiChainBridgeForm({ 
  isWalletConnected, 
  stacksAddress,
}: MultiChainBridgeFormProps) {
  // State
  const [sourceChain, setSourceChain] = useState<CCTPChainId | null>(null);
  const [destChain, setDestChain] = useState<CCTPChainId | 'Stacks' | null>('Stacks');
  const [amount, setAmount] = useState('');
  const [recipientAddress, setRecipientAddress] = useState('');
  const [speed, setSpeed] = useState<TransferSpeedPreference>('FAST');
  const [largeConfirmed, setLargeConfirmed] = useState(false);

  // Hooks
  const {
    isConnected,
    sourceBalance,
    ethBalance,
    isLoadingBalance,
    refreshBalances,
    fetchBalance,
    bridgeToStacks,
    bridgeEvmToEvm,
    bridgeState,
    resetBridgeState,
    currentChain,
    supportedChains,
  } = useMultiChainBridge();

  // Track source balance separately for selected chain
  const [selectedSourceBalance, setSelectedSourceBalance] = useState('0');
  // Distinguishes "still fetching" from "confirmed zero" - without this, a
  // slow RPC read on chain switch briefly reads as a real $0 balance and can
  // flash a false "Insufficient Balance" before the real number lands.
  const [isFetchingBalance, setIsFetchingBalance] = useState(false);

  // Refresh balance when source chain changes
  useEffect(() => {
    if (!sourceChain || !isConnected) {
      setSelectedSourceBalance('0');
      setIsFetchingBalance(false);
      return;
    }

    let cancelled = false;
    setIsFetchingBalance(true);
    fetchBalance(sourceChain).then((balance) => {
      if (cancelled) return;
      setSelectedSourceBalance(balance);
      setIsFetchingBalance(false);
    });

    return () => {
      cancelled = true;
    };
  }, [sourceChain, isConnected, fetchBalance]);

  // Destination-side balance, so the "To" panel shows what's already at the
  // destination the same way "From" shows the source balance. Reads USDCx via
  // Hiro when the destination is Stacks, and USDC over RPC for EVM chains.
  const [destBalance, setDestBalance] = useState('0');
  const [isFetchingDestBalance, setIsFetchingDestBalance] = useState(false);

  useEffect(() => {
    if (!destChain) {
      setDestBalance('0');
      setIsFetchingDestBalance(false);
      return;
    }

    let cancelled = false;

    const load = async () => {
      if (destChain === 'Stacks') {
        // Show the balance of wherever the funds will actually land: the
        // typed recipient when it's valid, otherwise the connected wallet.
        const target =
          recipientAddress && isValidStacksAddress(recipientAddress)
            ? recipientAddress
            : stacksAddress;
        if (!target) {
          setDestBalance('0');
          setIsFetchingDestBalance(false);
          return;
        }
        setIsFetchingDestBalance(true);
        // fetchUsdcxBalance returns raw micro-units (USDCx has 6 decimals).
        const raw = await fetchUsdcxBalance(target);
        if (cancelled) return;
        setDestBalance((parseInt(raw, 10) / 1_000_000).toString());
        setIsFetchingDestBalance(false);
        return;
      }

      if (!isConnected) {
        setDestBalance('0');
        setIsFetchingDestBalance(false);
        return;
      }
      setIsFetchingDestBalance(true);
      const balance = await fetchBalance(destChain as CCTPChainId);
      if (cancelled) return;
      setDestBalance(balance);
      setIsFetchingDestBalance(false);
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [destChain, isConnected, fetchBalance, recipientAddress, stacksAddress]);

  // Set recipient to connected Stacks address if available
  useEffect(() => {
    if (stacksAddress && !recipientAddress) {
      setRecipientAddress(stacksAddress);
    }
  }, [stacksAddress, recipientAddress]);

  // Validation
  const isToStacks = destChain === 'Stacks';
  // Fee/speed preview: for a Stacks destination we quote the leg that actually
  // carries the CCTP maxFee/speed - the source->Ethereum CCTP hop (or the
  // direct Ethereum->Stacks xReserve deposit when source is already Ethereum).
  const isDirectEthToStacks = isToStacks && sourceChain === 'Ethereum';
  const sourceDomain = sourceChain ? CCTP_CHAINS[sourceChain].domain : null;
  const destDomain = !sourceChain
    ? null
    : isToStacks
      ? isDirectEthToStacks
        ? BRIDGE_CONFIG.STACKS_DOMAIN
        : CCTP_CHAINS.Ethereum.domain
      : destChain
        ? CCTP_CHAINS[destChain as CCTPChainId].domain
        : null;
  const { quote: feeQuote, isLoading: isQuoteLoading } = useBridgeFeeQuote({
    amount,
    sourceDomain,
    destDomain,
    speed,
    includeProtocolFee: !isDirectEthToStacks,
  });
  const isValidAmount = amount && parseFloat(amount) > 0;
  const hasEnoughBalance = parseFloat(amount || '0') <= parseFloat(selectedSourceBalance);
  const isValidRecipient = !isToStacks || (!!recipientAddress && isValidStacksAddress(recipientAddress));
  const largeAmountOk = !isLargeAmount(amount) || largeConfirmed;
  const canSubmit =
    isConnected &&
    sourceChain &&
    destChain &&
    isValidAmount &&
    hasEnoughBalance &&
    isValidRecipient &&
    largeAmountOk &&
    !isFetchingBalance &&
    !bridgeState.isLoading;

  // Handle form submission
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!sourceChain || !destChain || !amount) return;

    if (isToStacks) {
      await bridgeToStacks(sourceChain, amount, recipientAddress, speed);
    } else {
      await bridgeEvmToEvm(sourceChain, destChain as CCTPChainId, amount, speed);
    }
  };

  // Handle max amount. The Hermes protocol fee is charged ON TOP of the
  // bridged amount, so MAX must leave room for it - otherwise amount + fee
  // exceeds the balance and the transfer fails. Floor to 6 decimals (never
  // round up past the real balance) and keep full precision.
  const handleMax = () => {
    setLargeConfirmed(false);
    const maxAmount = parseFloat(selectedSourceBalance);
    if (maxAmount <= 0) {
      setAmount('0');
      return;
    }
    const fee = parseFloat(calculateProtocolFee(maxAmount.toString()).feeUsdc);
    const spendable = Math.max(0, maxAmount - fee);
    setAmount((Math.floor(spendable * 1e6) / 1e6).toString());
  };

  // Handle swap chains
  const handleSwapChains = () => {
    if (destChain === 'Stacks') return; // Can't swap if destination is Stacks
    
    const newSource = destChain as CCTPChainId;
    const newDest = sourceChain;
    
    setSourceChain(newSource);
    setDestChain(newDest);
  };

  // The bridge card keeps the same narrow width as every other card on the
  // page - widening it would break the page's visual rhythm. Only when a
  // bridge actually starts does the container grow into two columns, and the
  // progress arrives as its own separate card beside the form rather than
  // being crammed inside it. Below `lg` it stacks, progress first, since on
  // a phone the running bridge matters more than the form already filled in.
  const hasProgress = bridgeState.steps.length > 0;

  return (
    <div
      className={cn(
        'mx-auto w-full',
        hasProgress
          ? 'max-w-5xl grid gap-6 items-start lg:grid-cols-2'
          : 'max-w-lg'
      )}
    >
      {/* Bridge form card */}
      <div
        className={cn(
          'bg-card/50 border border-border rounded-2xl p-6 backdrop-blur-sm space-y-6 min-w-0',
          hasProgress && 'order-2 lg:order-1'
        )}
      >
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Source Chain Selector */}
        <div className="bg-card/90 border border-border/50 rounded-xl p-4 shadow-lg shadow-black/10">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm text-muted-foreground">From</span>
            {sourceChain && (
              <span className="text-sm text-muted-foreground flex items-center gap-1.5">
                {isFetchingBalance ? (
                  <>
                    <Loader2 className="w-3 h-3 animate-spin" />
                    Loading balance...
                  </>
                ) : (
                  <>Balance: {formatUsd(selectedSourceBalance)} USDC</>
                )}
              </span>
            )}
          </div>
          
          <ChainSelector
            value={sourceChain}
            onChange={(chainId) => {
              setSourceChain(chainId);
              // Reset destination if it matches source
              if (destChain === chainId) {
                setDestChain(null);
              }
            }}
            excludeChains={destChain && destChain !== 'Stacks' ? [destChain as CCTPChainId] : []}
            placeholder="Select source chain"
            supportedChains={supportedChains}
          />

          {/* Amount Input */}
          <div className="mt-4">
            <label className="text-sm text-muted-foreground mb-2 block">Amount</label>
            <div className="flex items-center gap-2 bg-muted/50 rounded-lg p-3">
              <Input
                type="text"
                inputMode="decimal"
                placeholder="Enter amount"
                value={amount}
                onChange={(e) => { setAmount(sanitizeAmountInput(e.target.value)); setLargeConfirmed(false); }}
                className="text-2xl font-bold flex-1 bg-transparent border-0 focus-visible:ring-0 focus-visible:ring-offset-0 h-auto p-0"
              />
              <div className="flex items-center gap-2 shrink-0">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={handleMax}
                  className="text-xs h-7"
                >
                  MAX
                </Button>
                <span className="font-semibold text-foreground">USDC</span>
              </div>
            </div>
          </div>
        </div>

        {/* Swap Button */}
        <div className="flex justify-center -my-2 relative z-10">
          <button
            type="button"
            onClick={handleSwapChains}
            disabled={destChain === 'Stacks'}
            className={cn(
              "p-2 rounded-xl bg-card border border-border group",
              "hover:bg-accent hover:border-primary/50 transition-all active:scale-90",
              destChain === 'Stacks' && "opacity-50 cursor-not-allowed"
            )}
          >
            <ArrowDown className="w-5 h-5 transition-transform duration-300 group-hover:rotate-180" />
          </button>
        </div>

        {/* Destination Chain Selector */}
        <div className="bg-card/90 border border-border/50 rounded-xl p-4 shadow-lg shadow-black/10">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm text-muted-foreground">To</span>
            {destChain && (
              <span className="text-sm text-muted-foreground flex items-center gap-1.5">
                {isFetchingDestBalance ? (
                  <>
                    <Loader2 className="w-3 h-3 animate-spin" />
                    Loading balance...
                  </>
                ) : (
                  <>Balance: {formatUsd(destBalance)} {isToStacks ? 'USDCx' : 'USDC'}</>
                )}
              </span>
            )}
          </div>

          <ChainSelectorWithStacks
            value={destChain}
            onChange={(chainId) => {
              setDestChain(chainId);
              // Reset source if it matches destination
              if (sourceChain === chainId) {
                setSourceChain(null);
              }
            }}
            excludeChains={sourceChain ? [sourceChain] : []}
            placeholder="Select destination"
            supportedChains={supportedChains}
          />

          {/* Stacks Recipient Address (only for Stacks destination) */}
          {isToStacks && (
            <div className="mt-4">
              <label className="text-sm text-muted-foreground mb-2 block">
                Stacks Recipient Address
              </label>
              <Input
                placeholder="SP... (Stacks address)"
                value={recipientAddress}
                onChange={(e) => setRecipientAddress(e.target.value.trim())}
                className="font-mono text-sm"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
              />
              {recipientAddress && !isValidStacksAddress(recipientAddress) && (
                <p className="text-xs text-destructive mt-1">
                  Invalid Stacks address - check for typos or accidental extra characters
                </p>
              )}
              {recipientAddress && isValidStacksAddress(recipientAddress) && (
                <p className="text-xs text-green-500 mt-1 flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Valid Stacks address
                </p>
              )}
            </div>
          )}
        </div>

        {/* Route Info */}
        {sourceChain && destChain && (
          <div className="bg-accent/30 rounded-xl p-4">
            <p className="text-sm text-muted-foreground mb-2">Bridge Route</p>
            <div className="flex items-center gap-2 text-sm">
              <span className="font-medium">{CCTP_CHAINS[sourceChain]?.displayName}</span>
              {isToStacks && sourceChain !== 'Ethereum' ? (
                <>
                  <ArrowRight className="w-4 h-4 text-muted-foreground" />
                  <span className="font-medium text-primary">Stacks</span>
                </>
              ) : (
                <>
                  <ArrowRight className="w-4 h-4 text-muted-foreground" />
                  <span className="font-medium text-primary">
                    {isToStacks ? 'Stacks' : CCTP_CHAINS[destChain as CCTPChainId]?.displayName}
                  </span>
                </>
              )}
            </div>
            {isToStacks && sourceChain !== 'Ethereum' && (
              <p className="text-xs text-muted-foreground mt-2">
                Secure two-step transfer via Ethereum routing
              </p>
            )}
          </div>
        )}

        {/* Error Display */}
        {bridgeState.error && (
          <Alert variant="destructive" className="animate-in fade-in slide-in-from-top-2 duration-300">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{bridgeState.error}</AlertDescription>
          </Alert>
        )}

        {/* Validation Errors */}
        {!hasEnoughBalance && isValidAmount && !isFetchingBalance && (
          <Alert variant="destructive" className="animate-in fade-in slide-in-from-top-2 duration-300">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>Insufficient USDC balance</AlertDescription>
          </Alert>
        )}

        {/* Large-amount guardrail */}
        {!bridgeState.isLoading && (
          <LargeAmountConfirm
            amount={amount}
            confirmed={largeConfirmed}
            onConfirmedChange={setLargeConfirmed}
          />
        )}

        {/* Submit Button */}
        <Button
          type="submit"
          disabled={!canSubmit}
          className="w-full h-14 text-lg font-semibold"
        >
          {bridgeState.isLoading ? (
            <>
              <Loader2 className="w-5 h-5 mr-2 animate-spin" />
              Bridging...
            </>
          ) : !isConnected ? (
            'Connect Wallet'
          ) : !sourceChain ? (
            'Select Source Chain'
          ) : !destChain ? (
            'Select Destination'
          ) : isFetchingBalance ? (
            <>
              <Loader2 className="w-5 h-5 mr-2 animate-spin" />
              Loading balance...
            </>
          ) : !isValidAmount ? (
            'Enter Amount'
          ) : !hasEnoughBalance ? (
            'Insufficient Balance'
          ) : isToStacks && !isValidRecipient ? (
            'Enter Stacks Address'
          ) : (
            `Bridge to ${isToStacks ? 'Stacks' : CCTP_CHAINS[destChain as CCTPChainId]?.displayName}`
          )}
        </Button>
      </form>

      {/* Speed selector + fee preview */}
      {sourceChain && destChain && isValidAmount && !bridgeState.isLoading && (
        <div className="bg-accent/30 rounded-xl p-4 space-y-3 animate-in fade-in slide-in-from-top-2 duration-300">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Transfer speed</span>
            <ToggleGroup
              type="single"
              value={speed}
              onValueChange={(value) => value && setSpeed(value as TransferSpeedPreference)}
              size="sm"
            >
              <ToggleGroupItem value="FAST" aria-label="Fast transfer">
                <Zap className="w-3.5 h-3.5 mr-1" /> Fast
              </ToggleGroupItem>
              <ToggleGroupItem value="STANDARD" aria-label="Standard transfer">
                Standard
              </ToggleGroupItem>
            </ToggleGroup>
          </div>

          {isQuoteLoading && (
            <p className="text-xs text-muted-foreground">Fetching live fee quote...</p>
          )}

          {feeQuote && !isQuoteLoading && (
            <div className="text-xs text-muted-foreground space-y-1">
              {feeQuote.usedFallback && (
                <p className="text-yellow-500">Fast Transfer unavailable for this route - using Standard.</p>
              )}
              <div className="flex justify-between">
                <span>You send</span>
                <span className="text-foreground font-medium">{formatTokenAmount(feeQuote.totalDebitUsdc)} USDC</span>
              </div>
              <div className="flex justify-between">
                <span>Fee</span>
                <span>
                  {formatFeeUsd(parseFloat(feeQuote.protocolFeeUsdc) + parseFloat(feeQuote.estimatedCircleFeeUsdc))} USDC
                  {feeQuote.circleFeeBps !== null ? ` (${feeQuote.circleFeeBps} bps)` : ''}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Recipient receives (before final leg)</span>
                <span className="text-foreground font-medium">~{formatTokenAmount(feeQuote.estimatedRecipientUsdc)} USDC</span>
              </div>
              <div className="flex justify-between pt-1 border-t border-border/50">
                <span>Estimated time</span>
                <span>
                  {isToStacks
                    ? feeQuote.speed === 'FAST'
                      ? '~1-3 minutes total'
                      : '15-25 minutes total'
                    : feeQuote.speed === 'FAST'
                      ? '~20s-2 minutes'
                      : '6-12 minutes'}
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      </div>

      {/* Progress - a card in its own right, sitting beside the form rather
          than inside it. Sticky so it stays in view while the user scrolls
          during a multi-minute bridge. */}
      {hasProgress && (
        <div className="order-1 lg:order-2 min-w-0 lg:sticky lg:top-24">
          <BridgeProgress
            steps={bridgeState.steps}
            isCompleted={bridgeState.isCompleted}
            onReset={resetBridgeState}
          />
        </div>
      )}
    </div>
  );
}
