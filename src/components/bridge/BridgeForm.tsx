import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowDown, ExternalLink, AlertCircle, CheckCircle2, Zap } from "lucide-react";
import { Link } from "react-router-dom";
import { isValidStacksAddress } from "@/lib/stacks-address";
import { toast } from "sonner";
import { useBridgeStatus } from "@/hooks/useBridgeStatus";
import { useBridgeFeeQuote } from "@/hooks/useBridgeFeeQuote";
import { BRIDGE_CONFIG } from "@/lib/bridge-config";
import { calculateProtocolFee, type TransferSpeedPreference } from "@/lib/cctp-fees";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { BridgeProgress } from "@/components/multichain/BridgeProgress";
import type { BridgeStep as ProgressStep } from "@/hooks/useMultiChainBridge";
import { formatUsd, formatFeeUsd, formatTokenAmount, sanitizeAmountInput } from "@/lib/utils";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { createTrackedTransaction, reportLeg, updateTrackedStatus } from "@/lib/tracking-client";
import { LargeAmountConfirm, isLargeAmount } from "@/components/bridge/LargeAmountConfirm";

interface BridgeFormProps {
  isConnected: boolean;
  ethereumAddress: string | null;
  usdcBalance: string;
  ethBalance: string;
  // If the user has also connected a Stacks wallet (via the same "Connect
  // Wallet" dropdown that supports both), prefill the recipient field with
  // it instead of making them paste their own address - matches the
  // multichain bridge form's behavior.
  connectedStacksAddress?: string | null;
  onApprove: (amount: string) => Promise<string | null>;
  onPayFee: (amount: string) => Promise<string | null>;
  onDeposit: (amount: string, recipient: string, speed?: TransferSpeedPreference) => Promise<string | null>;
}

type FormPhase = 'input' | 'bridging' | 'monitoring' | 'complete';

export function BridgeForm({
  isConnected,
  ethereumAddress,
  usdcBalance,
  ethBalance,
  connectedStacksAddress,
  onApprove,
  onPayFee,
  onDeposit,
}: BridgeFormProps) {
  const [amount, setAmount] = useState("");
  const [stacksAddress, setStacksAddress] = useState("");
  const [largeConfirmed, setLargeConfirmed] = useState(false);
  const [phase, setPhase] = useState<FormPhase>('input');
  const [progressSteps, setProgressSteps] = useState<ProgressStep[]>([]);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [speed, setSpeed] = useState<TransferSpeedPreference>('FAST');

  const bridgeStatus = useBridgeStatus();

  // Persists the backend-tracked transaction promise across handleBridge
  // (which creates it) and the separate status-watching effect below (which
  // fires later, once Stacks-side monitoring resolves) - a ref survives
  // across renders without needing to be a dependency anywhere. Stored as
  // the raw promise (not an awaited id) so nothing ever has to block on
  // tracking to use it - reportLeg/updateTrackedStatus accept it directly.
  const trackedTxPromiseRef = useRef<Promise<string | null>>(Promise.resolve(null));

  // xReserve leg fee/speed preview, including the Hermes protocol fee -
  // collected as a separate USDC transfer to our treasury (see onPayFee),
  // since xReserve's depositToRemote has no fee-recipient parameter.
  const { quote: feeQuote, isLoading: isQuoteLoading } = useBridgeFeeQuote({
    amount,
    sourceDomain: 0,
    destDomain: BRIDGE_CONFIG.STACKS_DOMAIN,
    speed,
    includeProtocolFee: true,
  });

  // Watch for bridge completion / failure once Stacks-side monitoring takes
  // over from handleBridge (see startMonitoring below).
  useEffect(() => {
    if (bridgeStatus.status === 'completed') {
      setPhase('complete');
      toast.success("🎉 USDCx minted successfully!");
      reportLeg(trackedTxPromiseRef.current, {
        legType: 'stacks_mint',
        fromChain: 'Ethereum',
        toChain: 'Stacks',
        txHash: bridgeStatus.stacksTxHash ?? undefined,
        status: 'confirmed',
      });
      updateTrackedStatus(trackedTxPromiseRef.current, { status: 'completed' });
    } else if (bridgeStatus.status === 'error') {
      reportLeg(trackedTxPromiseRef.current, {
        legType: 'stacks_mint',
        fromChain: 'Ethereum',
        toChain: 'Stacks',
        status: 'unknown',
        errorMessage: bridgeStatus.errorMessage,
      });
      updateTrackedStatus(trackedTxPromiseRef.current, {
        status: 'failed',
        errorMessage: bridgeStatus.errorMessage,
      });
    }
  }, [bridgeStatus.status]);

  // Prefill the recipient with the connected Stacks wallet's own address, if
  // any - only when the field is still empty, so it never clobbers something
  // the user already typed (e.g. bridging to a different address).
  useEffect(() => {
    if (connectedStacksAddress && !stacksAddress) {
      setStacksAddress(connectedStacksAddress);
    }
  }, [connectedStacksAddress]);

  const parsedAmount = parseFloat(amount) || 0;
  const balance = parseFloat(usdcBalance) || 0;
  // Balance must cover the deposit amount plus the Hermes fee, which is
  // charged as a separate transfer on top (see handleBridge/onPayFee).
  const totalRequired = parsedAmount + parseFloat(calculateProtocolFee(amount || '0').feeUsdc);
  const hasEnoughBalance = parsedAmount > 0 && totalRequired <= balance;
  const isValidAddress = stacksAddress ? isValidStacksAddress(stacksAddress) : false;
  const largeAmountOk = !isLargeAmount(amount) || largeConfirmed;
  const canProceed = hasEnoughBalance && isValidAddress && largeAmountOk && parseFloat(ethBalance) > 0;

  const updateProgressStep = (id: string, updates: Partial<ProgressStep>) => {
    setProgressSteps(prev => prev.map(s => (s.id === id ? { ...s, ...updates } : s)));
  };

  const handleBridge = async () => {
    if (!canProceed) return;

    setError(null);
    setPhase('bridging');

    const { feeUsdc } = calculateProtocolFee(amount);
    const hasFee = parseFloat(feeUsdc) > 0;

    setProgressSteps([
      { id: 'approve', name: 'Approve USDC', description: 'Approve xReserve to spend USDC', status: 'in-progress' },
      ...(hasFee ? [{ id: 'fee', name: 'Pay Hermes Fee', description: `Send ${formatFeeUsd(feeUsdc)} USDC bridge fee`, status: 'pending' as const }] : []),
      { id: 'deposit', name: 'Deposit to xReserve', description: 'Deposit USDC to xReserve contract', status: 'pending' as const },
    ]);

    // Fired now (not awaited) so it runs in the background while the actual
    // bridge proceeds - reportLeg/updateTrackedStatus accept this promise
    // directly, so nothing here ever blocks on tracking.
    trackedTxPromiseRef.current = ethereumAddress
      ? createTrackedTransaction({
          ethereumAddress,
          stacksAddress,
          bridgeType: 'eth_to_stacks',
          sourceChain: 'Ethereum',
          destinationChain: 'Stacks',
          amount,
          speed,
          protocolFeeUsdc: feeUsdc,
          circleFeeUsdc: feeQuote?.estimatedCircleFeeUsdc,
        })
      : Promise.resolve(null);

    try {
      const approveHash = await onApprove(amount);
      if (!approveHash) {
        throw new Error('Approval was not submitted');
      }
      updateProgressStep('approve', {
        status: 'completed',
        txHash: approveHash,
        explorerUrl: `https://etherscan.io/tx/${approveHash}`,
      });
      reportLeg(trackedTxPromiseRef.current, {
        legType: 'approve',
        fromChain: 'Ethereum',
        toChain: 'Ethereum',
        txHash: approveHash,
        status: 'confirmed',
      });

      if (hasFee) {
        updateProgressStep('fee', { status: 'in-progress' });
        const feeHash = await onPayFee(amount);
        if (!feeHash) {
          throw new Error('Fee payment was not submitted');
        }
        updateProgressStep('fee', {
          status: 'completed',
          txHash: feeHash,
          explorerUrl: `https://etherscan.io/tx/${feeHash}`,
        });
        reportLeg(trackedTxPromiseRef.current, {
          legType: 'fee_payment',
          fromChain: 'Ethereum',
          toChain: 'Ethereum',
          txHash: feeHash,
          status: 'confirmed',
        });
      }

      updateProgressStep('deposit', { status: 'in-progress' });
      const depositHash = await onDeposit(amount, stacksAddress, speed);
      if (!depositHash) {
        throw new Error('Deposit was not submitted');
      }
      updateProgressStep('deposit', {
        status: 'completed',
        txHash: depositHash,
        explorerUrl: `https://etherscan.io/tx/${depositHash}`,
      });
      reportLeg(trackedTxPromiseRef.current, {
        legType: 'xreserve_deposit',
        fromChain: 'Ethereum',
        toChain: 'Stacks',
        txHash: depositHash,
        status: 'confirmed',
      });

      setTxHash(depositHash);
      setPhase('monitoring');
      bridgeStatus.startMonitoring(depositHash, stacksAddress, amount);
      toast.success("Bridge transaction submitted! Monitoring for completion...");
    } catch (err) {
      const error = err as Error;
      const failingStepId = progressSteps.find(s => s.status === 'in-progress')?.id ?? 'approve';
      const message = friendlyErrorMessage(error, 'Bridge failed');
      updateProgressStep(failingStepId, { status: 'failed', error: message });
      setError(message);
      toast.error(message);

      const failedLegType = failingStepId === 'approve' ? 'approve' : failingStepId === 'fee' ? 'fee_payment' : 'xreserve_deposit';
      reportLeg(trackedTxPromiseRef.current, {
        legType: failedLegType,
        fromChain: 'Ethereum',
        toChain: failedLegType === 'xreserve_deposit' ? 'Stacks' : 'Ethereum',
        status: 'failed',
        errorMessage: message,
      });
      updateTrackedStatus(trackedTxPromiseRef.current, { status: 'failed', errorMessage: message });
    }
  };

  const handleReset = () => {
    setAmount("");
    setStacksAddress("");
    setLargeConfirmed(false);
    setPhase('input');
    setProgressSteps([]);
    setTxHash(null);
    setError(null);
    bridgeStatus.reset();
  };

  const handleMaxAmount = () => {
    setLargeConfirmed(false);
    // Leave room for the Hermes fee, which is charged on top of the amount.
    const bal = parseFloat(usdcBalance) || 0;
    if (bal <= 0) {
      setAmount('0');
      return;
    }
    const feeEstimate = parseFloat(calculateProtocolFee(bal.toString()).feeUsdc);
    setAmount(Math.max(0, bal - feeEstimate).toFixed(6));
  };

  if (!isConnected) {
    return (
      <Card className="bg-card/70 backdrop-blur-xl border-border/50 shadow-xl shadow-black/20 animate-in fade-in slide-in-from-bottom-4 duration-300">
        <CardContent className="pt-6">
          <div className="text-center py-12">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-secondary flex items-center justify-center">
              <AlertCircle className="w-8 h-8 text-muted-foreground" />
            </div>
            <p className="text-muted-foreground text-lg">
              Connect your Ethereum wallet to start bridging
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (phase === 'monitoring' && txHash) {
    // Once submitted, this step needs no user action and no live countdown -
    // Hermes Trail already tracks the real-time status, and staring at a
    // ticking timer reads as "stuck" well before the ~10-20 minute Circle
    // attestation actually finishes. Just reassure the user it's expected
    // and normal, and let them check back (here or on Hermes Trail) whenever
    // they like. The one exception: once a Stacks mint tx is actually
    // detected, that's genuinely good news worth surfacing immediately.
    const mintDetected = !!bridgeStatus.stacksTxHash;

    return (
      <Card className="bg-card/70 backdrop-blur-xl border-border/50 shadow-xl shadow-black/20 animate-in fade-in slide-in-from-bottom-4 duration-300">
        <CardContent className="pt-6">
          <div className="text-center py-8">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-secondary flex items-center justify-center">
              <CheckCircle2 className="w-8 h-8 text-green-500" />
            </div>

            <h3 className="text-2xl font-bold text-foreground mb-2">Bridge Submitted!</h3>

            <p className="text-muted-foreground mb-4">
              {formatTokenAmount(amount)} USDC → {formatTokenAmount(amount)} USDCx
            </p>

            <div className={`rounded-xl p-4 mb-6 text-left border ${mintDetected ? 'bg-green-500/10 border-green-500/30' : 'bg-blue-500/10 border-blue-500/20'}`}>
              {mintDetected ? (
                <p className="text-sm text-green-400">
                  🎉 USDCx detected on Stacks - finalizing now, usually done within about a minute.
                </p>
              ) : (
                <p className="text-sm text-blue-300">
                  Your USDCx is on its way to{" "}
                  <span className="font-mono">{stacksAddress.slice(0, 6)}…{stacksAddress.slice(-4)}</span>.
                  You can safely close this tab.
                </p>
              )}
            </div>

            {/* Transaction Links */}
            <div className="space-y-3 mb-6">
              <div className="bg-secondary rounded-xl p-4">
                <p className="text-sm text-muted-foreground mb-2">Ethereum Transaction</p>
                <a
                  href={`https://etherscan.io/tx/${txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-sm text-primary hover:underline flex items-center justify-center gap-2"
                >
                  {txHash.slice(0, 12)}...{txHash.slice(-6)}
                  <ExternalLink className="w-4 h-4" />
                </a>
              </div>

              {bridgeStatus.stacksTxHash && (
                <div className="bg-green-500/10 border border-green-500/30 rounded-xl p-4">
                  <p className="text-sm text-green-500 mb-2">🎉 Stacks Mint Transaction</p>
                  <a
                    href={`https://explorer.hiro.so/txid/${bridgeStatus.stacksTxHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-sm text-green-500 hover:underline flex items-center justify-center gap-2"
                  >
                    {bridgeStatus.stacksTxHash.slice(0, 12)}...{bridgeStatus.stacksTxHash.slice(-6)}
                    <ExternalLink className="w-4 h-4" />
                  </a>
                </div>
              )}
            </div>

            <Link
              to="/my-bridges"
              className="text-sm text-primary hover:underline inline-flex items-center gap-2"
            >
              Track status in Hermes Trail
              <ExternalLink className="w-4 h-4" />
            </Link>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (phase === 'complete' && txHash) {
    return (
      <Card className="bg-card/70 backdrop-blur-xl border-border/50 shadow-xl shadow-black/20 animate-in fade-in slide-in-from-bottom-4 duration-300">
        <CardContent className="pt-6">
          <div className="text-center py-8">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full gradient-bitcoin flex items-center justify-center animate-in zoom-in-50 duration-500">
              <CheckCircle2 className="w-8 h-8 text-primary-foreground" />
            </div>
            <h3 className="text-2xl font-bold text-green-400 mb-2 flex items-center justify-center gap-2">
              <span>Bridge Successful!</span>
            </h3>
            <p className="text-muted-foreground mb-4">
              Your {formatTokenAmount(amount)} USDC has been <span className="text-green-400 font-semibold">bridged to Stacks</span>.
            </p>
            <div className="bg-green-500/10 border border-green-500/30 rounded-xl p-4 mb-6 text-left">
              <p className="text-green-400 font-medium text-sm mb-2">✅ Bridge completed in <span className="font-mono">{bridgeStatus.formatElapsedTime(bridgeStatus.elapsedTime)}</span></p>
              <p className="text-green-300 text-xs">
                The Stacks attestation service detected your deposit and minted USDCx to your address.<br/>
                <span className="font-semibold">All steps completed successfully!</span>
              </p>
            </div>
            <div className="bg-secondary rounded-xl p-4 mb-4">
              <p className="text-sm text-muted-foreground mb-2">Ethereum Transaction</p>
              <a
                href={`https://etherscan.io/tx/${txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-sm text-primary hover:underline flex items-center justify-center gap-2"
              >
                {txHash.slice(0, 16)}...{txHash.slice(-8)}
                <ExternalLink className="w-4 h-4" />
              </a>
            </div>
            <div className="bg-secondary rounded-xl p-4 mb-6">
              <p className="text-sm text-muted-foreground mb-2">Check Stacks Wallet</p>
              <a
                href={`https://explorer.hiro.so/address/${stacksAddress}`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-sm text-primary hover:underline flex items-center justify-center gap-2"
              >
                View on Stacks Explorer
                <ExternalLink className="w-4 h-4" />
              </a>
              <p className="text-xs text-muted-foreground mt-2">
                USDCx Contract: <a
                  href="https://explorer.hiro.so/txid/SP120SBRBQJ00MCWS7TM5R8WJNTTKD5K0HFRC2CNE.usdcx"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  SP120SB...usdcx
                </a>
              </p>
            </div>
            <Button onClick={handleReset} variant="outline" className="border-primary text-primary hover:bg-primary hover:text-primary-foreground">
              Bridge More
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-card/70 backdrop-blur-xl border-border/50 shadow-xl shadow-black/20 animate-in fade-in slide-in-from-bottom-4 duration-300">
      <CardHeader>
        <CardTitle className="text-xl text-foreground">Bridge USDC → USDCx</CardTitle>
        <CardDescription>
          Transfer USDC from Ethereum to Stacks
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* From Section */}
        <div className="bg-secondary rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-muted-foreground">From: Ethereum</Label>
            <span className="text-sm text-muted-foreground">
              Balance: <span className="text-foreground font-medium">{formatUsd(usdcBalance)} USDC</span>
            </span>
          </div>
          <div className="flex gap-2">
            <Input
              type="text"
              inputMode="decimal"
              placeholder="0.00"
              value={amount}
              onChange={(e) => { setAmount(sanitizeAmountInput(e.target.value)); setLargeConfirmed(false); }}
              className="text-2xl font-bold bg-transparent border-none focus-visible:ring-0 px-0"
              disabled={phase !== 'input'}
            />
            <Button
              variant="ghost"
              size="sm"
              onClick={handleMaxAmount}
              className="text-primary hover:text-primary hover:bg-primary/10"
              disabled={phase !== 'input'}
            >
              MAX
            </Button>
          </div>
          {parsedAmount > balance && (
            <p className="text-destructive text-sm">Insufficient balance</p>
          )}
        </div>

        {/* Arrow */}
        <div className="flex justify-center">
          <div className="w-10 h-10 rounded-full bg-secondary border border-border flex items-center justify-center">
            <ArrowDown className="w-5 h-5 text-primary" />
          </div>
        </div>

        {/* To Section */}
        <div className="bg-secondary rounded-xl p-4 space-y-3">
          <Label className="text-muted-foreground">To: Stacks</Label>
          <Input
            type="text"
            placeholder="SP... (Stacks address)"
            value={stacksAddress}
            onChange={(e) => setStacksAddress(e.target.value)}
            className="font-mono text-sm"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            disabled={phase !== 'input'}
          />
          {stacksAddress && !isValidAddress && (
            <p className="text-destructive text-sm">Invalid Stacks address (must start with SP)</p>
          )}
          {isValidAddress && (
            <p className="text-green-500 text-sm flex items-center gap-1">
              <CheckCircle2 className="w-4 h-4" /> Valid Stacks address
            </p>
          )}
        </div>

        {/* Speed selector + fee preview */}
        {parsedAmount > 0 && (
          <div className="bg-secondary rounded-xl p-4 space-y-3 animate-in fade-in slide-in-from-top-2 duration-300">
            <div className="flex items-center justify-between">
              <Label className="text-muted-foreground">Transfer speed</Label>
              <ToggleGroup
                type="single"
                value={speed}
                onValueChange={(value) => value && setSpeed(value as TransferSpeedPreference)}
                size="sm"
                disabled={phase !== 'input'}
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
                  <p className="text-yellow-500">Fast Transfer unavailable right now - using Standard.</p>
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
                  <span>You'll receive on Stacks</span>
                  <span className="text-foreground font-medium">~{formatTokenAmount(feeQuote.estimatedRecipientUsdc)} USDCx</span>
                </div>
                <div className="flex justify-between pt-1 border-t border-border/50">
                  <span>Estimated time</span>
                  <span>{feeQuote.speed === 'FAST' ? '~1-3 minutes' : '5-30 minutes'}</span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ETH Balance Warning */}
        {parseFloat(ethBalance) === 0 && (
          <div className="bg-destructive/10 border border-destructive/20 rounded-xl p-4 flex items-start gap-3 animate-in fade-in slide-in-from-top-2 duration-300">
            <AlertCircle className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-destructive font-medium">Insufficient ETH for gas</p>
              <p className="text-destructive/80 text-sm">
                You need ETH in your wallet to pay for transaction fees.
              </p>
            </div>
          </div>
        )}

        {/* Large-amount guardrail */}
        {phase === 'input' && (
          <LargeAmountConfirm
            amount={amount}
            confirmed={largeConfirmed}
            onConfirmedChange={setLargeConfirmed}
          />
        )}

        {/* Error Display */}
        {error && (
          <div className="bg-destructive/10 border border-destructive/20 rounded-xl p-4 flex items-start gap-3 animate-in fade-in slide-in-from-top-2 duration-300">
            <AlertCircle className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />
            <p className="text-destructive text-sm">{error}</p>
          </div>
        )}

        {/* Action Button */}
        {phase === 'input' && (
          <Button
            onClick={handleBridge}
            disabled={!canProceed}
            className="w-full gradient-bitcoin text-primary-foreground font-semibold py-6 text-lg rounded-xl glow-orange hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            Bridge to Stacks
          </Button>
        )}

        {/* Bridging progress */}
        {phase === 'bridging' && (
          <BridgeProgress
            steps={progressSteps}
            isCompleted={false}
            onReset={handleReset}
          />
        )}
      </CardContent>
    </Card>
  );
}
