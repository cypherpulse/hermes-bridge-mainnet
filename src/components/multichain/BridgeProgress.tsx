import { Loader2, CheckCircle2, XCircle, ExternalLink, Wallet } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { type BridgeStep } from '@/hooks/useMultiChainBridge';
import { cn } from '@/lib/utils';

interface BridgeProgressProps {
  steps: BridgeStep[];
  isCompleted: boolean;
  onReset: () => void;
}

export function BridgeProgress({
  steps,
  isCompleted,
  onReset,
}: BridgeProgressProps) {
  const hasFailedSteps = steps.some(step => step.status === 'failed');
  const isActuallyCompleted = isCompleted && !hasFailedSteps;
  // The attestation/minting step needs no wallet signature or user action at
  // all - once it's running, a spinning "in progress" icon still reads as
  // "working on it, don't leave", when the real message should be "this is
  // submitted, you can safely check back later." Give it a calmer, distinct
  // treatment instead of the generic in-progress spinner.
  const attestationStep = steps.find((s) => s.id === 'xreserve-attestation');
  const isSubmittedAndWaiting = attestationStep?.status === 'in-progress';
  const completedCount = steps.filter((s) => s.status === 'completed').length;

  return (
    <div className="bg-card/70 backdrop-blur-xl border border-border/50 rounded-xl p-4 space-y-4 shadow-lg shadow-black/10 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold">Bridge Progress</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {isActuallyCompleted
              ? 'All steps complete'
              : hasFailedSteps
                ? 'Needs attention'
                : `Step ${Math.min(completedCount + 1, steps.length)} of ${steps.length}`}
          </p>
        </div>
        {(isActuallyCompleted || hasFailedSteps) && (
          <Button variant="outline" size="sm" onClick={onReset} className="animate-in fade-in duration-300">
            New Bridge
          </Button>
        )}
      </div>

      {/* Overall progress bar - gives a sense of "how far through am I"
          that a list of step rows alone doesn't convey at a glance. */}
      <div className="h-1.5 w-full rounded-full bg-secondary overflow-hidden">
        <div
          className={cn(
            'h-full rounded-full transition-all duration-700 ease-out',
            hasFailedSteps ? 'bg-destructive' : 'gradient-bitcoin'
          )}
          style={{ width: `${(completedCount / steps.length) * 100}%` }}
        />
      </div>

      <div className="space-y-3">
        {steps.map((step, index) => {
          const isCalmWaiting = step.id === 'xreserve-attestation' && step.status === 'in-progress';
          // Every in-progress step except attestation is waiting on a wallet
          // signature. Calling that out explicitly is the difference between
          // "why is this hanging?" and "oh, my wallet is waiting for me".
          const needsSignature = step.status === 'in-progress' && !isCalmWaiting;
          return (
          <div
            key={step.id}
            style={{ animationDelay: `${index * 75}ms`, animationFillMode: 'backwards' }}
            className={cn(
              "flex items-start gap-3 p-3 rounded-lg transition-colors duration-300",
              "animate-in fade-in slide-in-from-left-2",
              needsSignature && "bg-primary/10 ring-1 ring-primary/40",
              isCalmWaiting && "bg-blue-500/10",
              step.status === 'completed' && "bg-green-500/10",
              step.status === 'failed' && "bg-destructive/10",
            )}
          >
            {/* Status Icon */}
            <div className="mt-0.5">
              {step.status === 'pending' && (
                <div className="w-5 h-5 rounded-full border-2 border-muted-foreground" />
              )}
              {step.status === 'in-progress' && isCalmWaiting && (
                <CheckCircle2 className="w-5 h-5 text-blue-400" />
              )}
              {step.status === 'in-progress' && !isCalmWaiting && (
                <Loader2 className="w-5 h-5 text-primary animate-spin" />
              )}
              {step.status === 'completed' && (
                <CheckCircle2 className="w-5 h-5 text-green-500 animate-in zoom-in-50 duration-300" />
              )}
              {step.status === 'failed' && (
                <XCircle className="w-5 h-5 text-destructive animate-in zoom-in-50 duration-300" />
              )}
            </div>

            {/* Step Info */}
            <div className="flex-1 min-w-0">
              <p className="font-medium text-foreground">{step.name}</p>
              <p className="text-sm text-muted-foreground">{step.description}</p>

              {needsSignature && (
                <p className="mt-1.5 inline-flex items-center gap-1.5 rounded-full bg-primary/15 px-2 py-0.5 text-xs font-medium text-primary">
                  <Wallet className="w-3 h-3" />
                  Confirm in your wallet
                </p>
              )}

              {step.error && (
                <p className="text-sm text-destructive mt-1">{step.error}</p>
              )}

              {step.txHash && step.explorerUrl && (
                <a
                  href={step.explorerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-sm text-primary hover:underline mt-1"
                >
                  View Transaction
                  <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>

            {/* Step Number */}
            <span className="text-sm text-muted-foreground">
              {index + 1}/{steps.length}
            </span>
          </div>
          );
        })}
      </div>

      {isSubmittedAndWaiting && (
        <Alert className="bg-blue-500/10 border-blue-500/20 animate-in fade-in slide-in-from-bottom-2 duration-300">
          <CheckCircle2 className="h-4 w-4 text-blue-400" />
          <AlertDescription className="text-blue-300 flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>Submitted! No action needed - you can safely close this tab.</span>
            <Link to="/my-bridges" className="inline-flex items-center gap-1 text-blue-300 underline hover:text-blue-200">
              Track status in Hermes Trail
              <ExternalLink className="w-3 h-3" />
            </Link>
          </AlertDescription>
        </Alert>
      )}

      {isActuallyCompleted && (
        <Alert className="bg-green-500/10 border-green-500/20 animate-in fade-in zoom-in-95 duration-500">
          <CheckCircle2 className="h-4 w-4 text-green-500" />
          <AlertDescription className="text-green-500">
            Bridge completed! Funds have arrived at the destination - check the transaction links above to verify.
          </AlertDescription>
        </Alert>
      )}

      {hasFailedSteps && (
        <Alert className="bg-destructive/10 border-destructive/20 animate-in fade-in slide-in-from-bottom-2 duration-300">
          <XCircle className="h-4 w-4 text-destructive" />
          <AlertDescription className="text-destructive">
            Bridge failed. Please check the error messages above and try again.
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}