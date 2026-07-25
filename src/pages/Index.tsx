import { useState, Fragment } from "react";
import { useBridge } from "@/hooks/useBridge";
import { useStacksWallet } from "@/hooks/useStacksWallet";
import { useWithdrawStatus } from "@/hooks/useWithdrawStatus";
import { ConnectWalletButton } from "@/components/bridge/ConnectWalletButton";
import { BridgeForm } from "@/components/bridge/BridgeForm";
import { BalanceDisplay } from "@/components/bridge/BalanceDisplay";
import { ExternalLink, ArrowRight, ArrowLeft } from "lucide-react";
import Navbar from "@/components/Navbar";
import { Footer } from '@/components/Footer';
import { cn, formatUsd } from "@/lib/utils";
import { friendlyErrorMessage } from "@/lib/error-messages";

interface WithdrawFormProps {
  isConnected: boolean;
  usdcxBalance: string;
  minWithdrawalAmount: string;
  onWithdraw: (amount: string, ethereumAddress: string) => Promise<string>;
}

// Maps real withdrawal status to the 4-dot Burn/Attest/Release/Complete UI.
const WITHDRAW_DOT_THRESHOLD: Record<string, number> = {
  idle: 0,
  burning: 1,
  burn_confirmed: 2,
  releasing: 3,
  completed: 4,
  error: 0,
};

const WithdrawForm = ({ isConnected, usdcxBalance, minWithdrawalAmount, onWithdraw }: WithdrawFormProps) => {
  const [amount, setAmount] = useState('');
  const [ethereumAddress, setEthereumAddress] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  const withdrawStatus = useWithdrawStatus();
  const isActive = withdrawStatus.status !== 'idle';
  const dotsReached = WITHDRAW_DOT_THRESHOLD[withdrawStatus.status] ?? 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isConnected) return;

    setIsSubmitting(true);
    setFormError('');

    try {
      const numAmount = parseFloat(amount);
      const numBalance = parseFloat(usdcxBalance);
      const minAmount = parseFloat(minWithdrawalAmount);

      if (numAmount <= 0) {
        throw new Error('Amount must be greater than 0');
      }
      if (numAmount < minAmount) {
        throw new Error(`Minimum withdrawal amount is ${minAmount} USDCx`);
      }
      if (numAmount > numBalance) {
        throw new Error('Insufficient USDCx balance');
      }
      if (!ethereumAddress.startsWith('0x') || ethereumAddress.length !== 42) {
        throw new Error('Invalid Ethereum address');
      }

      // Burn the tokens directly (no approval needed for protocol-burn)
      const transactionId = await onWithdraw(amount, ethereumAddress);
      await withdrawStatus.startMonitoring(transactionId, ethereumAddress);

      setAmount('');
      setEthereumAddress('');
    } catch (err) {
      setFormError(friendlyErrorMessage(err, 'Transaction failed'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const statusText: Record<string, string> = {
    burning: 'Burn transaction submitted - waiting for Stacks confirmation...',
    burn_confirmed: 'Burn confirmed on Stacks! Waiting for Circle to release USDC on Ethereum...',
    releasing: `Circle is processing the release - usually within 5-15 minutes (${withdrawStatus.formatElapsedTime(withdrawStatus.elapsedTime)} elapsed).`,
    completed: `USDC arrived! ${withdrawStatus.releasedAmountUsdc ? formatUsd(withdrawStatus.releasedAmountUsdc) : ''} USDC released to your Ethereum address.`,
  };

  return (
    <div className="bg-card/70 backdrop-blur-xl border border-border/50 rounded-xl p-6 shadow-xl shadow-black/20">
      <h3 className="text-lg font-semibold mb-4">Withdraw to Ethereum</h3>

      {/* Process Info */}
      <div className="mb-4 p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg">
        <p className="text-sm text-blue-300">
          <strong>How withdrawal works:</strong> Your USDCx is burned on Stacks, Circle's attestation service detects the burn event,
          verifies it, and releases equivalent USDC to your Ethereum address. This process typically takes 5-15 minutes.
          Minimum withdrawal: {formatUsd(minWithdrawalAmount)} USDCx.
        </p>
      </div>

      {/* Progress Steps */}
      {isActive && (
        <div className="mb-4 animate-in fade-in slide-in-from-top-2 duration-300">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">Progress</span>
            <button onClick={withdrawStatus.reset} className="text-xs text-primary hover:underline">
              Start New
            </button>
          </div>
          <div className="flex items-center space-x-2">
            {[1, 2, 3, 4].map((dot) => (
              <Fragment key={dot}>
                <div
                  className={cn(
                    'w-3 h-3 rounded-full transition-all duration-500',
                    dotsReached >= dot ? 'bg-primary scale-110' : 'bg-muted',
                    dotsReached === dot - 1 && withdrawStatus.status !== 'error' && 'animate-pulse'
                  )}
                ></div>
                {dot < 4 && (
                  <div className="flex-1 h-0.5 bg-muted overflow-hidden rounded-full">
                    <div className={`h-full bg-primary transition-all duration-500 ease-out ${dotsReached > dot ? 'w-full' : 'w-0'}`}></div>
                  </div>
                )}
              </Fragment>
            ))}
          </div>
          <div className="flex justify-between text-xs text-muted-foreground mt-1">
            <span>Burn</span>
            <span>Attest</span>
            <span>Release</span>
            <span>Complete</span>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-2">Amount (USDCx)</label>
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder={`Min: ${minWithdrawalAmount}`}
            step="0.01"
            min={minWithdrawalAmount}
            className="w-full px-3 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
            disabled={!isConnected || isSubmitting || isActive}
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">Ethereum Address</label>
          <input
            type="text"
            value={ethereumAddress}
            onChange={(e) => setEthereumAddress(e.target.value)}
            placeholder="0x..."
            className="w-full px-3 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary font-mono text-sm"
            disabled={!isConnected || isSubmitting || isActive}
          />
        </div>

        {formError && (
          <div className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 p-3 rounded-lg">
            {formError}
          </div>
        )}

        {withdrawStatus.status === 'error' && (
          <div className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 p-3 rounded-lg animate-in fade-in slide-in-from-top-1 duration-300">
            {withdrawStatus.errorMessage}
          </div>
        )}

        {isActive && withdrawStatus.status !== 'error' && (
          <div
            key={withdrawStatus.status}
            className={`text-sm p-3 rounded-lg border animate-in fade-in slide-in-from-top-1 duration-300 ${withdrawStatus.status === 'completed' ? 'text-green-400 bg-green-500/10 border-green-500/20' : 'text-blue-300 bg-blue-500/10 border-blue-500/20'}`}>
            {statusText[withdrawStatus.status]}
            {withdrawStatus.stacksTxId && (
              <div className="mt-2">
                <a
                  href={`https://explorer.hiro.so/txid/${withdrawStatus.stacksTxId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline text-xs flex items-center gap-1"
                >
                  View burn transaction on Stacks Explorer <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            )}
          </div>
        )}

        <button
          type="submit"
          disabled={!isConnected || isSubmitting || !amount || !ethereumAddress || isActive}
          className="w-full bg-primary text-primary-foreground py-3 rounded-lg font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isSubmitting ? 'Processing...' : isConnected ? 'Withdraw to Ethereum' : 'Connect Stacks Wallet'}
        </button>
      </form>
    </div>
  );
};

const Index = () => {
  const [mode, setMode] = useState<'bridge' | 'withdraw'>('bridge');
  
  const {
    address: ethAddress,
    isConnected: isEthConnected,
    ethBalance,
    usdcBalance,
    refreshBalances,
    approveUSDC,
    payProtocolFee,
    depositToStacks,
  } = useBridge();

  const {
    stacksAddress,
    isConnected: isStacksConnected,
    usdcxBalance,
    minWithdrawalAmount,
    burnUsdcx,
    approveUsdcx,
    refreshBalance,
  } = useStacksWallet();

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Background gradient effects */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-primary/10 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-primary/5 rounded-full blur-3xl" />
      </div>

      <div className="relative z-10 flex flex-col flex-1">
        <Navbar />

        {/* Main Content */}
        <main className="container mx-auto px-4 py-12 flex-1">
          <div className="max-w-lg mx-auto space-y-6">
            {/* Hero Section */}
            <div className="text-center mb-8">
              <h2 className="text-4xl font-bold mb-3">
                <span className="text-white">Ethereum</span>
                <span className="text-foreground"> ↔ </span>
                <span className="text-gradient-bitcoin">Stacks</span>
              </h2>
              
              {/* Mode Toggle */}
              <div className="flex items-center justify-center gap-4 mb-6">
                <button
                  onClick={() => setMode('bridge')}
                  className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                    mode === 'bridge'
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground hover:bg-muted/80'
                  }`}
                >
                  Bridge to Stacks
                </button>
                <button
                  onClick={() => setMode('withdraw')}
                  className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                    mode === 'withdraw'
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground hover:bg-muted/80'
                  }`}
                >
                  Withdraw to Ethereum
                </button>
              </div>
              
              {/* Chain Logos */}
              <div className="flex items-center justify-center gap-8 mb-4">
                {mode === 'bridge' ? (
                  <>
                    <div className="flex flex-col items-center">
                      <img 
                        src="https://res.cloudinary.com/dg5rr4ntw/image/upload/v1768900941/download_6_b0zu0z.png" 
                        alt="Ethereum" 
                        className="w-16 h-16 rounded-full border-2 border-orange-500/30 bg-white shadow-lg" 
                      />
                      <span className="text-sm font-medium text-white mt-2">USDC</span>
                    </div>
                    
                    <ArrowRight className="w-8 h-8 text-muted-foreground" />
                    
                    <div className="flex flex-col items-center">
                      <img 
                        src="https://res.cloudinary.com/dg5rr4ntw/image/upload/v1768901230/download_7_pixwpt.png" 
                        alt="Stacks" 
                        className="w-16 h-16 rounded-full border-2 border-indigo-500/30 bg-white shadow-lg" 
                      />
                      <span className="text-sm font-medium text-gradient-bitcoin mt-2">USDCx</span>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex flex-col items-center">
                      <img 
                        src="https://res.cloudinary.com/dg5rr4ntw/image/upload/v1768901230/download_7_pixwpt.png" 
                        alt="Stacks" 
                        className="w-16 h-16 rounded-full border-2 border-indigo-500/30 bg-white shadow-lg" 
                      />
                      <span className="text-sm font-medium text-gradient-bitcoin mt-2">USDCx</span>
                    </div>
                    
                    <ArrowLeft className="w-8 h-8 text-muted-foreground" />
                    
                    <div className="flex flex-col items-center">
                      <img 
                        src="https://res.cloudinary.com/dg5rr4ntw/image/upload/v1768900941/download_6_b0zu0z.png" 
                        alt="Ethereum" 
                        className="w-16 h-16 rounded-full border-2 border-orange-500/30 bg-white shadow-lg" 
                      />
                      <span className="text-sm font-medium text-white mt-2">USDC</span>
                    </div>
                  </>
                )}
              </div>
              
              <p className="text-muted-foreground text-lg">
                {mode === 'bridge' 
                  ? 'Blazing fast bridging between Ethereum and Stacks'
                  : 'Withdraw USDCx from Stacks back to Ethereum'
                }
              </p>
              <p className="text-xs text-muted-foreground mt-2">
                Powered by Circle & Stacks
              </p>
            </div>

            {/* Bridge Content */}
            {mode === 'bridge' ? (
              <>
                {/* Balance Display */}
                <BalanceDisplay
                  ethBalance={ethBalance}
                  usdcBalance={usdcBalance}
                  onRefresh={refreshBalances}
                  isConnected={isEthConnected}
                />

                {/* Bridge Form */}
                <BridgeForm
                  isConnected={isEthConnected}
                  ethereumAddress={ethAddress}
                  usdcBalance={usdcBalance}
                  ethBalance={ethBalance}
                  connectedStacksAddress={isStacksConnected ? stacksAddress : null}
                  onApprove={approveUSDC}
                  onPayFee={payProtocolFee}
                  onDeposit={depositToStacks}
                />
              </>
            ) : (
              <>
                {/* Withdraw Balance Display */}
                <div className="bg-card border border-border rounded-xl p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold">Your Balance</h3>
                    <button
                      onClick={refreshBalance}
                      className="text-sm text-primary hover:underline"
                    >
                      Refresh
                    </button>
                  </div>
                  <div className="space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="text-muted-foreground">USDCx Balance:</span>
                      <span className="font-mono text-lg">
                        {isStacksConnected ? `${formatUsd(usdcxBalance)} USDCx` : 'Connect wallet'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Withdraw Form */}
                <WithdrawForm
                  isConnected={isStacksConnected}
                  usdcxBalance={usdcxBalance}
                  minWithdrawalAmount={minWithdrawalAmount}
                  onWithdraw={burnUsdcx}
                />
              </>
            )}

            {/* Network Info */}
            <div className="bg-card border border-border rounded-xl p-4 text-center mt-8">
              <p className="text-xs text-muted-foreground">
                Network: <span className="text-foreground">Ethereum</span> ↔ <span className="text-foreground">Stacks</span>
              </p>
            </div>
          </div>
        </main>

        {/* Footer */}
        <Footer />
      </div>
    </div>
  );
};

export default Index;
