import { useEffect, useState } from 'react';
import { calculateBridgeFee, type BridgeFeeQuote, type TransferSpeedPreference } from '@/lib/cctp-fees';

/**
 * Debounced live fee/speed quote for bridge UI previews. Shared by
 * MultiChainBridgeForm and BridgeForm so both surfaces show the same
 * Fast/Standard fee breakdown computed from src/lib/cctp-fees.ts.
 */
export function useBridgeFeeQuote(params: {
  amount: string;
  sourceDomain: number | null;
  destDomain: number | null;
  speed: TransferSpeedPreference;
  includeProtocolFee?: boolean;
}) {
  const { amount, sourceDomain, destDomain, speed, includeProtocolFee = true } = params;
  const [quote, setQuote] = useState<BridgeFeeQuote | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const amountNum = parseFloat(amount);
    if (!amountNum || amountNum <= 0 || sourceDomain === null || destDomain === null) {
      setQuote(null);
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    setIsLoading(true);

    const timer = setTimeout(async () => {
      try {
        const result = await calculateBridgeFee({
          amountUsdc: amount,
          sourceDomain,
          destDomain,
          preferredSpeed: speed,
          includeProtocolFee,
        });
        if (!cancelled) setQuote(result);
      } catch (error) {
        console.error('[useBridgeFeeQuote] Failed to fetch fee quote:', error);
        if (!cancelled) setQuote(null);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }, 400);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [amount, sourceDomain, destDomain, speed, includeProtocolFee]);

  return { quote, isLoading };
}
