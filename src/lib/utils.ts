import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Format a USD-pegged token amount (USDC/USDCx) as "$X.XX" - always two
 * decimal places, with thousands separators. Accepts the raw 6-decimal
 * strings/numbers used throughout the bridge so callers don't hand-roll
 * `.toFixed(2)` and forget the "$" prefix.
 */
export function formatUsd(amount: string | number | null | undefined): string {
  const value = typeof amount === 'string' ? parseFloat(amount) : amount;
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '$0.00';
  }
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Format an exact token amount (the value a user typed or is bridging),
 * preserving up to USDC's 6-decimal precision. Unlike formatUsd - which
 * force-rounds to 2 decimals and would misrepresent e.g. 0.015 as "0.02" -
 * this shows the true amount. No "$" prefix, since it's a token quantity.
 */
export function formatTokenAmount(amount: string | number | null | undefined): string {
  const value = typeof amount === 'string' ? parseFloat(amount) : amount;
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '0';
  }
  return value.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 6 });
}

/**
 * Format a fee amount, which is often tiny (fractions of a cent). formatUsd's
 * fixed 2-decimal rounding makes any fee under half a cent read as "$0.00" -
 * indistinguishable from genuinely free, which is misleading. Shows up to
 * USDC's 6-decimal precision (trimmed of trailing zeros) for anything that
 * would otherwise round to zero.
 */
export function formatFeeUsd(amount: string | number | null | undefined): string {
  const value = typeof amount === 'string' ? parseFloat(amount) : amount;
  if (value === null || value === undefined || !Number.isFinite(value) || value <= 0) {
    return '$0.00';
  }
  if (value < 0.005) {
    const precise = value.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
    return `$${precise}`;
  }
  return formatUsd(value);
}

/**
 * Filter free-text amount input down to a plain non-negative decimal string.
 * Native `<input type="number">` still lets users type "e", "+", "-", or
 * multiple decimal points before validation kicks in - which parseFloat
 * happily accepts (e.g. "1e5" -> 100000), risking an accidental huge amount.
 * Strips anything that isn't a digit or a single decimal point.
 */
export function sanitizeAmountInput(raw: string): string {
  let cleaned = raw.replace(/[^0-9.]/g, '');
  const firstDot = cleaned.indexOf('.');
  if (firstDot !== -1) {
    cleaned = cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, '');
  }
  return cleaned;
}
