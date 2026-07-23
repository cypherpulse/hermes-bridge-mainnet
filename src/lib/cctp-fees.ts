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
}): Promise<BridgeFeeQuote> {
  const {
    amountUsdc,
    sourceDomain,
    destDomain,
    preferredSpeed = 'FAST',
    isMainnet = true,
    includeProtocolFee = true,
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
    console.warn('[cctp-fees] Fast transfer quote failed, falling back to Standard:', error);
    return buildQuote('STANDARD', 0, true);
  }
}
