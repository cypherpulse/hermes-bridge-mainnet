/**
 * Best-effort transaction tracking against the Hermes backend
 * (hermes-server). Records every bridge attempt - including the hidden
 * intermediate legs of multi-hop bridges (e.g. Base -> Ethereum -> Stacks) -
 * so support can see exactly which leg stalled or failed for a given user.
 *
 * This is telemetry, not part of the bridge's own correctness: every
 * function here is wrapped so a slow, misconfigured, or completely down
 * backend can NEVER block, delay, or throw into the actual bridge flow. If
 * VITE_HERMES_API_URL/KEY aren't set, every call silently no-ops.
 */

const API_URL = import.meta.env.VITE_HERMES_API_URL as string | undefined;
const API_KEY = import.meta.env.VITE_HERMES_API_KEY as string | undefined;

const TIMEOUT_MS = 6000;

async function safeFetch(path: string, init: RequestInit): Promise<Response | null> {
  if (!API_URL || !API_KEY) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(`${API_URL}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        ...(init.headers ?? {}),
      },
      signal: controller.signal,
    });
  } catch (error) {
    console.warn(`[tracking] ${path} failed (non-fatal, bridge unaffected):`, error);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export type BridgeType = 'eth_to_stacks' | 'evm_to_evm' | 'evm_to_evm_to_stacks' | 'stacks_transfer';
export type LegType = 'approve' | 'fee_payment' | 'cctp_burn_mint' | 'xreserve_deposit' | 'stacks_mint' | 'stacks_transfer';
export type LegStatus = 'pending' | 'submitted' | 'confirmed' | 'failed' | 'unknown';
export type TrackedTransactionStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

export interface CreateTrackedTransactionParams {
  // Optional - a stacks_transfer never touches an Ethereum wallet at all.
  // At least one of ethereumAddress/stacksAddress is required by the backend.
  ethereumAddress?: string;
  // The recipient for bridge-to-stacks types; the SENDER (record identity)
  // for stacks_transfer.
  stacksAddress?: string;
  // Only meaningful for stacks_transfer - who the funds were sent to.
  recipientAddress?: string;
  bridgeType: BridgeType;
  sourceChain: string;
  destinationChain: string;
  amount: string;
  speed: 'FAST' | 'STANDARD';
  protocolFeeUsdc?: string;
  circleFeeUsdc?: string;
}

/**
 * Records that a bridge attempt has started. Call this as early as possible
 * - ideally before any wallet signature - so there's a record even if the
 * user closes their browser or rejects a signature immediately after.
 * Returns the transaction id to pass to reportLeg/updateTrackedStatus, or
 * null if tracking is unavailable (backend down, not configured, etc.) - all
 * other tracking calls silently no-op when given null.
 */
export async function createTrackedTransaction(
  params: CreateTrackedTransactionParams
): Promise<string | null> {
  const response = await safeFetch('/api/transactions', {
    method: 'POST',
    body: JSON.stringify(params),
  });
  if (!response?.ok) return null;
  try {
    const data = (await response.json()) as { _id?: string };
    return data._id ?? null;
  } catch {
    return null;
  }
}

export interface ReportLegParams {
  legType: LegType;
  fromChain: string;
  toChain: string;
  txHash?: string;
  status: LegStatus;
  errorMessage?: string | null;
}

/** Either an already-resolved id or the still-in-flight creation promise - see reportLeg/updateTrackedStatus. */
type TrackedTxRef = string | null | Promise<string | null>;

/**
 * Reports one leg's outcome. Fire-and-forget: accepts the raw promise from
 * createTrackedTransaction directly, so callers never need to `await` it
 * first - awaiting inline would mean a slow/unreachable tracking backend
 * could stall the actual bridge flow at exactly the moment a real on-chain
 * step just completed, which must never happen.
 */
export function reportLeg(transactionId: TrackedTxRef, leg: ReportLegParams): void {
  void Promise.resolve(transactionId).then((id) => {
    if (!id) return;
    void safeFetch(`/api/transactions/${id}/legs`, {
      method: 'PATCH',
      body: JSON.stringify(leg),
    });
  });
}

export interface UpdateTrackedStatusParams {
  status?: TrackedTransactionStatus;
  errorMessage?: string | null;
  // Patched in once a live fee quote is known - the CCTP legs pay the
  // Hermes protocol fee and Circle's fee automatically as part of the burn
  // transaction (via Bridge Kit's customFee), so there's no separate tx to
  // report a fee_payment leg for; this is how those fees end up visible on
  // the admin Fees page for evm_to_evm / evm_to_evm_to_stacks bridges.
  protocolFeeUsdc?: string;
  circleFeeUsdc?: string;
}

/** Updates the overall transaction status. Fire-and-forget - see reportLeg's comment on why this never awaits its input. */
export function updateTrackedStatus(transactionId: TrackedTxRef, update: UpdateTrackedStatusParams): void {
  void Promise.resolve(transactionId).then((id) => {
    if (!id) return;
    void safeFetch(`/api/transactions/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(update),
    });
  });
}

export interface TrackedLeg {
  legType: LegType;
  fromChain: string;
  toChain: string;
  txHash: string | null;
  status: LegStatus;
  errorMessage: string | null;
  startedAt: string;
  confirmedAt: string | null;
}

export interface TrackedTransaction {
  _id: string;
  ethereumAddress: string | null;
  stacksAddress: string | null;
  recipientAddress: string | null;
  bridgeType: BridgeType;
  sourceChain: string;
  destinationChain: string;
  amount: string;
  speed: 'FAST' | 'STANDARD';
  protocolFeeUsdc: string;
  circleFeeUsdc: string;
  status: TrackedTransactionStatus;
  errorMessage: string | null;
  legs: TrackedLeg[];
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface MyTransactionsResult {
  items: TrackedTransaction[];
  pagination: { page: number; limit: number; total: number; pages: number };
}

/**
 * Fetches the connected wallet's own bridge/transfer history and status -
 * powers Hermes Trail, so a user can check back even after closing the tab
 * mid-bridge. At least one of ethereumAddress/stacksAddress is required
 * (matching the backend's own requirement); passing both looks up either
 * wallet's activity together, for someone with both connected. Unlike
 * everything else in this file (fire-and-forget telemetry that must never
 * affect the bridge flow), this IS the thing the caller is waiting on - but
 * it still never throws, returning null on any failure so the UI can show a
 * plain "couldn't load" state.
 */
export async function fetchMyTransactions(
  identity: { ethereumAddress?: string | null; stacksAddress?: string | null },
  opts: { page?: number; limit?: number } = {}
): Promise<MyTransactionsResult | null> {
  const { page = 1, limit = 20 } = opts;
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (identity.ethereumAddress) params.set('ethereumAddress', identity.ethereumAddress);
  if (identity.stacksAddress) params.set('stacksAddress', identity.stacksAddress);
  if (!params.has('ethereumAddress') && !params.has('stacksAddress')) return null;

  const res = await safeFetch(`/api/transactions/mine?${params.toString()}`, { method: 'GET' });
  if (!res?.ok) return null;
  try {
    return (await res.json()) as MyTransactionsResult;
  } catch {
    return null;
  }
}
