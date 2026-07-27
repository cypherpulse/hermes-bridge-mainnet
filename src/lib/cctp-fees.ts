/**
 * Circle CCTP v2 fee quoting + Hermes protocol fee calculation.
 *
 * Docs:
 * - Fee model: https://developers.circle.com/cctp/concepts/fees
 * - Fees API:  GET /v2/burn/USDC/fees/{sourceDomainId}/{destDomainId}
 *   Returns one entry per finality tier, e.g.
 *   [{ finalityThreshold: 1000, minimumFee: 1 }, { finalityThreshold: 2000, minimumFee: 0 }]
 *   `minimumFee` is in basis points. Circle explicitly warns not to hardcode fees.
 *
 * `minFinalityThreshold` values are fixed per Circle's v1->v2 migration guide:
 * 1000 = Fast Transfer, 2000 = Standard Transfer.
 */

export const CCTP_FINALITY_THRESHOLD = {
  FAST: 1000,
  STANDARD: 2000,
} as const;

export type TransferSpeedPreference = 'FAST' | 'STANDARD';

const IRIS_API_HOST = {
  testnet: 'https://iris-api-sandbox.circle.com',
  mainnet: 'https://iris-api.circle.com',
} as const;

interface CircleFeeTier {
  finalityThreshold: number;
  minimumFee: number; // basis points
}

// Circle's fee API is a live quote; cache briefly to avoid hammering it while a
// user is adjusting the amount input, without risking a stale quote at submit time.
const FEE_CACHE_TTL_MS = 60_000;
const feeQuoteCache = new Map<string, { tiers: CircleFeeTier[]; fetchedAt: number }>();

export async function fetchCircleFeeTiers(
  sourceDomain: number,
  destDomain: number,
  isMainnet = true
): Promise<CircleFeeTier[]> {
  const cacheKey = `${isMainnet ? 'main' : 'test'}:${sourceDomain}:${destDomain}`;
  const cached = feeQuoteCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < FEE_CACHE_TTL_MS) {
    return cached.tiers;
  }

  const host = isMainnet ? IRIS_API_HOST.mainnet : IRIS_API_HOST.testnet;
  const response = await fetch(`${host}/v2/burn/USDC/fees/${sourceDomain}/${destDomain}`);
  if (!response.ok) {
    throw new Error(`Circle fee API returned ${response.status}`);
  }

  const tiers = (await response.json()) as CircleFeeTier[];
  feeQuoteCache.set(cacheKey, { tiers, fetchedAt: Date.now() });
  return tiers;
}

// Circle explicitly recommends adding a 10-20% buffer on top of the live quote
// for `maxFee`, since the actual fee at fulfillment time can drift; if maxFee is
// too low the depositForBurn transaction reverts on-chain.
const MAX_FEE_BUFFER_PCT = 0.15;

/**
 * Hard ceiling on the estimated Fast fee below. 25 bps = 0.25%, well above
 * the 0-13 bps Circle charges on real CCTP routes - so even a mistyped env
 * value can never authorize a painful maxFee.
 */
const MAX_FALLBACK_FAST_FEE_BPS = 25;

/**
 * Estimated Fast-tier fee (bps) for the Ethereum -> Stacks (xReserve) leg,
 * which Circle's fee API cannot quote.
 *
 * Findings from live testing:
 *
 *  1. `GET /v2/burn/USDC/fees/0/10003` -> HTTP 400 "Invalid source/destination
 *     domain id". Circle's fee endpoint doesn't cover xReserve's non-EVM
 *     remote domains. (EVM control route 0->6 returns 200 with both tiers.)
 *  2. Mainnet settlement takes ~13-19 min regardless of speed selection. That
 *     floor is Ethereum hard finality (2 epochs), which Standard Transfer must
 *     wait for - not something the client can tune away.
 *
 * Defaults to 0 (fails closed) on least-authorization grounds: `maxFee` is the
 * user signing "deduct up to this much", and the capability it pays for
 * demonstrably doesn't exist on this route yet - so a nonzero value could only
 * ever be drawn against, never benefit them. A missing/blank env must not
 * silently authorize a fee either, hence 0 rather than a nonzero default.
 *
 * The plumbing stays wired so this is a one-line env flip (no code change, no
 * redeploy risk) the day Circle enables Fast Transfer for xReserve remote
 * domains. Re-verify the real fee for the route at that point rather than
 * trusting a value guessed here - 1 bps is what the closest quotable route
 * (Ethereum->Base) charges, but that is not authoritative for Stacks.
 */
export const XRESERVE_FAST_FEE_BPS = (() => {
  const raw = import.meta.env.VITE_XRESERVE_FAST_FEE_BPS as string | undefined;
  const parsed = Number(raw);
  if (raw !== undefined && raw !== '' && Number.isFinite(parsed) && parsed >= 0) {
    return Math.min(parsed, MAX_FALLBACK_FAST_FEE_BPS);
  }
  return 0;
})();

function bpsToUsdc(amountUsdc: string, bps: number, bufferPct = 0): string {
  const amount = parseFloat(amountUsdc);
  if (!Number.isFinite(amount) || amount <= 0 || bps <= 0) return '0';
  const raw = (amount * bps) / 10_000;
  const buffered = raw * (1 + bufferPct);
  // Round up to USDC's 6-decimal precision so we never under-quote maxFee.
  return (Math.ceil(buffered * 1e6) / 1e6).toFixed(6);
}

// Hermes protocol fee: bps of amount, clamped to [min, max]. Env-configurable so
// it can be tuned without a code change before mainnet.
const PROTOCOL_FEE_BPS = Number(import.meta.env.VITE_PROTOCOL_FEE_BPS ?? 6);
const PROTOCOL_FEE_MIN_USDC = Number(import.meta.env.VITE_PROTOCOL_FEE_MIN_USDC ?? 0.02);
const PROTOCOL_FEE_MAX_USDC = Number(import.meta.env.VITE_PROTOCOL_FEE_MAX_USDC ?? 5);

export function calculateProtocolFee(amountUsdc: string): { feeUsdc: string } {
  const amount = parseFloat(amountUsdc);
  if (!Number.isFinite(amount) || amount <= 0) {
    return { feeUsdc: '0' };
  }
  const raw = (amount * PROTOCOL_FEE_BPS) / 10_000;
  const clamped = Math.min(Math.max(raw, PROTOCOL_FEE_MIN_USDC), PROTOCOL_FEE_MAX_USDC);
  return { feeUsdc: clamped.toFixed(6) };
}

export interface BridgeFeeQuote {
  speed: TransferSpeedPreference;
  minFinalityThreshold: number;
  /** The unchanged transfer amount, echoed back for convenience. */
  amountUsdc: string;
  /** Buffered ceiling passed as `maxFee` to depositForBurn. "0" for Standard. */
  circleMaxFeeUsdc: string;
  /** Live basis-point quote from Circle; null when a live quote wasn't available. */
  circleFeeBps: number | null;
  /** Unbuffered estimate of what Circle actually deducts at mint time. */
  estimatedCircleFeeUsdc: string;
  /**
   * Hermes protocol fee. Per Bridge Kit's `customFee` semantics this is charged
   * ON TOP of `amountUsdc` (the sender's wallet is debited amount + protocolFee),
   * not deducted from it.
   */
  protocolFeeUsdc: string;
  /** amountUsdc + protocolFeeUsdc - what leaves the sender's wallet. */
  totalDebitUsdc: string;
  /** amountUsdc - estimatedCircleFeeUsdc - what the recipient ends up with. */
  estimatedRecipientUsdc: string;
  /** True if a live Fast quote could not be obtained and we silently used Standard. */
  usedFallback: boolean;
}

export async function calculateBridgeFee(params: {
  amountUsdc: string;
  sourceDomain: number;
  destDomain: number;
  preferredSpeed?: TransferSpeedPreference;
  isMainnet?: boolean;
  /** Set false for legs (e.g. xReserve) that don't yet support fee-recipient splitting. */
  includeProtocolFee?: boolean;
  /**
   * Estimated Fast-tier fee (bps) to use when Circle's fee API can't quote
   * this route. Opt-in and currently 0 (disabled) for the only route that
   * needs it - see XRESERVE_FAST_FEE_BPS above for the full rationale and
   * mainnet test results. When 0/undefined this behaves exactly as before:
   * an unquotable route falls back to Standard.
   *
   * Note `maxFee` is a CEILING the user accepts, not a charge - the actual
   * deduction is whatever Circle charges, up to this cap.
   */
  fallbackFastFeeBps?: number;
}): Promise<BridgeFeeQuote> {
  const {
    amountUsdc,
    sourceDomain,
    destDomain,
    preferredSpeed = 'FAST',
    isMainnet = true,
    includeProtocolFee = true,
    fallbackFastFeeBps,
  } = params;

  const protocolFeeUsdc = includeProtocolFee ? calculateProtocolFee(amountUsdc).feeUsdc : '0';
  const amount = parseFloat(amountUsdc) || 0;
  const totalDebitUsdc = (amount + parseFloat(protocolFeeUsdc)).toFixed(6);

  const buildQuote = (
    speed: TransferSpeedPreference,
    circleFeeBps: number | null,
    usedFallback: boolean
  ): BridgeFeeQuote => {
    const minFinalityThreshold =
      speed === 'FAST' ? CCTP_FINALITY_THRESHOLD.FAST : CCTP_FINALITY_THRESHOLD.STANDARD;
    const estimatedCircleFeeUsdc = circleFeeBps ? bpsToUsdc(amountUsdc, circleFeeBps) : '0';
    const circleMaxFeeUsdc =
      speed === 'FAST' && circleFeeBps ? bpsToUsdc(amountUsdc, circleFeeBps, MAX_FEE_BUFFER_PCT) : '0';
    const estimatedRecipientUsdc = Math.max(amount - parseFloat(estimatedCircleFeeUsdc), 0).toFixed(6);

    return {
      speed,
      minFinalityThreshold,
      amountUsdc,
      circleMaxFeeUsdc,
      circleFeeBps,
      estimatedCircleFeeUsdc,
      protocolFeeUsdc,
      totalDebitUsdc,
      estimatedRecipientUsdc,
      usedFallback,
    };
  };

  if (preferredSpeed === 'STANDARD') {
    return buildQuote('STANDARD', 0, false);
  }

  try {
    const tiers = await fetchCircleFeeTiers(sourceDomain, destDomain, isMainnet);
    const fastTier = tiers.find((t) => t.finalityThreshold === CCTP_FINALITY_THRESHOLD.FAST);
    if (!fastTier) {
      throw new Error('Route does not offer a Fast Transfer tier');
    }
    return buildQuote('FAST', fastTier.minimumFee, false);
  } catch (error) {
    // Circle couldn't quote this route. If the caller supplied an estimated
    // Fast-tier fee (routes Circle's API doesn't cover at all - notably
    // xReserve's Stacks domain), still attempt Fast using that estimate
    // rather than silently degrading to a 10-20 minute Standard transfer.
    // Clamped so a misconfigured env can never authorize a large maxFee.
    if (fallbackFastFeeBps && fallbackFastFeeBps > 0) {
      const safeBps = Math.min(fallbackFastFeeBps, MAX_FALLBACK_FAST_FEE_BPS);
      console.warn(
        `[cctp-fees] Circle cannot quote ${sourceDomain}->${destDomain}; attempting Fast with an estimated ${safeBps} bps (maxFee is a ceiling, not a charge):`,
        error
      );
      return buildQuote('FAST', safeBps, true);
    }
    console.warn('[cctp-fees] Fast transfer quote failed, falling back to Standard:', error);
    return buildQuote('STANDARD', 0, true);
  }
}
