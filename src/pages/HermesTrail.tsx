import { useCallback, useEffect, useState } from 'react';
import { useAccount } from 'wagmi';
import { useStacksWallet } from '@/hooks/useStacksWallet';
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  Clock,
  ExternalLink,
  Loader2,
  RefreshCw,
  XCircle,
} from 'lucide-react';
import Navbar from '@/components/Navbar';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  fetchMyTransactions,
  reportLeg,
  updateTrackedStatus,
  type TrackedTransaction,
  type TrackedTransactionStatus,
} from '@/lib/tracking-client';
import { findUsdcxMintSince } from '@/lib/stacks-usdcx';
import { legExplorerUrl } from '@/lib/tx-explorers';
import { formatTokenAmount, timeAgo, truncateAddress, cn } from '@/lib/utils';

function humanLegType(t: string): string {
  switch (t) {
    case 'approve':
      return 'Token Approval';
    case 'fee_payment':
      return 'Protocol Fee Payment';
    case 'cctp_burn_mint':
      return 'Cross-Chain Transfer (CCTP)';
    case 'xreserve_deposit':
      return 'xReserve Deposit';
    case 'stacks_mint':
      return 'Stacks Mint (USDCx)';
    case 'stacks_transfer':
      return 'USDCx Transfer';
    default:
      return t;
  }
}

const STATUS_META: Record<
  TrackedTransactionStatus,
  { label: string; color: string; icon: typeof Clock }
> = {
  pending: { label: 'Pending', color: 'text-muted-foreground', icon: Clock },
  in_progress: { label: 'In Progress', color: 'text-blue-500', icon: Loader2 },
  completed: { label: 'Completed', color: 'text-green-500', icon: CheckCircle2 },
  failed: { label: 'Failed', color: 'text-destructive', icon: XCircle },
};

function StatusPill({ status }: { status: TrackedTransactionStatus }) {
  const meta = STATUS_META[status];
  const Icon = meta.icon;
  return (
    <span className={cn('flex items-center gap-1.5 text-sm font-medium', meta.color)}>
      <Icon className={cn('w-4 h-4', status === 'in_progress' && 'animate-spin')} />
      {meta.label}
    </span>
  );
}

function TransactionCard({ tx }: { tx: TrackedTransaction }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="bg-secondary/50 rounded-xl border border-border/50 overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="w-full flex items-center gap-4 p-4 text-left hover:bg-secondary/80 transition-colors"
      >
        <StatusPill status={tx.status} />
        <div className="flex-1 min-w-0">
          <p className="font-medium text-foreground truncate">
            {tx.bridgeType === 'stacks_transfer' ? (
              <>{formatTokenAmount(tx.amount)} USDCx to {truncateAddress(tx.recipientAddress)}</>
            ) : (
              <>{formatTokenAmount(tx.amount)} USDC · {tx.sourceChain} → {tx.destinationChain}</>
            )}
          </p>
          <p className="text-xs text-muted-foreground truncate">
            {timeAgo(tx.createdAt)}
          </p>
          {tx.status === 'in_progress' && (
            <p className="text-xs text-muted-foreground mt-0.5">
              Usually done within 10-20 minutes - no action needed
            </p>
          )}
        </div>
        <ChevronDown className={cn('w-4 h-4 text-muted-foreground transition-transform shrink-0', expanded && 'rotate-180')} />
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-2 animate-in fade-in slide-in-from-top-1 duration-200">
          {tx.errorMessage && (
            <div className="flex items-start gap-2 bg-destructive/10 border border-destructive/20 rounded-lg p-3 text-sm text-destructive">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              {tx.errorMessage}
            </div>
          )}
          {tx.legs.length === 0 && (
            <p className="text-sm text-muted-foreground">No steps recorded yet.</p>
          )}
          {tx.legs.map((leg, i) => {
            const url = legExplorerUrl(leg);
            return (
              <div key={`${leg.legType}-${i}`} className="flex items-center gap-3 bg-card/60 rounded-lg p-3">
                <div className="shrink-0">
                  {leg.status === 'confirmed' && <CheckCircle2 className="w-4 h-4 text-green-500" />}
                  {leg.status === 'failed' && <XCircle className="w-4 h-4 text-destructive" />}
                  {(leg.status === 'pending' || leg.status === 'submitted') && (
                    <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />
                  )}
                  {leg.status === 'unknown' && <AlertCircle className="w-4 h-4 text-yellow-500" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-foreground">{humanLegType(leg.legType)}</p>
                  <p className="text-xs text-muted-foreground">{leg.fromChain} → {leg.toChain}</p>
                </div>
                {url && (
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-primary hover:underline flex items-center gap-1 shrink-0"
                  >
                    View <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>
            );
          })}
          {(tx.protocolFeeUsdc !== '0' || tx.circleFeeUsdc !== '0') && (
            <p className="text-xs text-muted-foreground pt-1">
              Fee paid: {formatTokenAmount(tx.protocolFeeUsdc)} USDC
            </p>
          )}
        </div>
      )}
    </div>
  );
}

const HermesTrail = () => {
  const { address: ethereumAddress, isConnected: isEthConnected } = useAccount();
  const { stacksAddress, isConnected: isStacksConnected } = useStacksWallet();
  const isConnected = isEthConnected || isStacksConnected;
  const [transactions, setTransactions] = useState<TrackedTransaction[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  // Self-heal: a Stacks-bound bridge only gets reported "completed" if the
  // same browser tab is still open ~10-20 minutes later when the mint
  // actually lands - close it early and the transaction sits at
  // pending/in_progress forever, even though the funds arrived, until
  // someone happens to run the admin's on-chain audit. Since Hermes Trail
  // already knows the Stacks recipient and start time, check directly here
  // too so the fix lands the moment the user comes back to check, not
  // whenever an admin next runs a sweep.
  const reconcileStacksArrivals = useCallback(async (txs: TrackedTransaction[]) => {
    const candidates = txs.filter(
      (t) =>
        (t.status === 'pending' || t.status === 'in_progress') &&
        (t.bridgeType === 'eth_to_stacks' || t.bridgeType === 'evm_to_evm_to_stacks') &&
        !!t.stacksAddress
    );
    if (candidates.length === 0) return;

    const checks = await Promise.all(
      candidates.map(async (tx) => ({
        tx,
        mint: await findUsdcxMintSince(tx.stacksAddress as string, tx.createdAt),
      }))
    );
    const confirmed = checks.filter((c) => c.mint);
    if (confirmed.length === 0) return;

    const nowIso = new Date().toISOString();
    for (const { tx, mint } of confirmed) {
      reportLeg(tx._id, {
        legType: 'stacks_mint',
        fromChain: 'Ethereum',
        toChain: 'Stacks',
        txHash: mint!.txId,
        status: 'confirmed',
      });
      updateTrackedStatus(tx._id, { status: 'completed' });
    }

    // Reflect it immediately rather than waiting on the next poll/refresh -
    // the backend writes above are fire-and-forget but will have landed by
    // the time anyone reloads this page again regardless.
    setTransactions((prev) =>
      prev?.map((t) => {
        const hit = confirmed.find((c) => c.tx._id === t._id);
        if (!hit) return t;
        return {
          ...t,
          status: 'completed' as const,
          completedAt: t.completedAt ?? nowIso,
          legs: [
            ...t.legs.filter((l) => l.legType !== 'stacks_mint'),
            {
              legType: 'stacks_mint' as const,
              fromChain: 'Ethereum',
              toChain: 'Stacks',
              txHash: hit.mint!.txId,
              status: 'confirmed' as const,
              errorMessage: null,
              startedAt: nowIso,
              confirmedAt: nowIso,
            },
          ],
        };
      }) ?? null
    );
  }, []);

  const load = useCallback(async () => {
    if (!ethereumAddress && !stacksAddress) return;
    setIsLoading(true);
    const result = await fetchMyTransactions({ ethereumAddress, stacksAddress }, { limit: 20 });
    if (result) {
      setTransactions(result.items);
      setLoadFailed(false);
      void reconcileStacksArrivals(result.items);
    } else {
      setLoadFailed(true);
    }
    setIsLoading(false);
  }, [ethereumAddress, stacksAddress, reconcileStacksArrivals]);

  useEffect(() => {
    setTransactions(null);
    setLoadFailed(false);
    if (ethereumAddress || stacksAddress) load();
  }, [ethereumAddress, stacksAddress, load]);

  // Auto-refresh while anything is still pending/in_progress, so a user who
  // leaves this tab open sees status update on its own.
  useEffect(() => {
    if (!transactions?.some((t) => t.status === 'pending' || t.status === 'in_progress')) return;
    const interval = setInterval(load, 20_000);
    return () => clearInterval(interval);
  }, [transactions, load]);

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="container mx-auto px-4 py-8 max-w-3xl">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Hermes Trail</h1>
            <p className="text-sm text-muted-foreground">
              Your trail of transfers - bridge history and live status for your connected wallet
            </p>
          </div>
          {isConnected && (
            <Button variant="outline" size="sm" onClick={load} disabled={isLoading}>
              <RefreshCw className={cn('w-4 h-4 mr-2', isLoading && 'animate-spin')} />
              Refresh
            </Button>
          )}
        </div>

        {!isConnected && (
          <Card className="bg-card/70 backdrop-blur-xl border-border/50 shadow-xl shadow-black/20">
            <CardContent className="pt-6">
              <div className="text-center py-12">
                <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-secondary flex items-center justify-center">
                  <AlertCircle className="w-8 h-8 text-muted-foreground" />
                </div>
                <p className="text-muted-foreground text-lg">
                  Connect your Ethereum or Stacks wallet to see your bridge and transfer history
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {isConnected && isLoading && !transactions && (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-20 w-full rounded-xl" />
            ))}
          </div>
        )}

        {isConnected && loadFailed && !transactions && (
          <Card className="bg-card/70 backdrop-blur-xl border-border/50">
            <CardContent className="pt-6 text-center py-12">
              <p className="text-muted-foreground mb-4">Couldn't load your bridge history right now.</p>
              <Button variant="outline" size="sm" onClick={load}>Try again</Button>
            </CardContent>
          </Card>
        )}

        {isConnected && transactions && transactions.length === 0 && (
          <Card className="bg-card/70 backdrop-blur-xl border-border/50">
            <CardContent className="pt-6 text-center py-12">
              <p className="text-muted-foreground">No bridges or transfers yet - they'll show up here once you make one.</p>
            </CardContent>
          </Card>
        )}

        {isConnected && transactions && transactions.length > 0 && (
          <Card className="bg-card/70 backdrop-blur-xl border-border/50 shadow-xl shadow-black/20">
            <CardHeader>
              <CardTitle className="text-lg">Recent activity</CardTitle>
              <CardDescription>Tap a row to see step-by-step status and transaction links</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {transactions.map((tx) => (
                <TransactionCard key={tx._id} tx={tx} />
              ))}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
};

export default HermesTrail;
