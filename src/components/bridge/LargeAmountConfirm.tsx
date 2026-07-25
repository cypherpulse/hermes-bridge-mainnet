import { AlertTriangle } from "lucide-react";
import { formatUsd } from "@/lib/utils";

/**
 * Fat-finger guardrail. Bridge/transfer transactions are irreversible once
 * signed, so above a threshold we make the user explicitly acknowledge the
 * amount before the action button enables. This never changes what's
 * possible - it's purely a speed bump against an accidental extra zero on
 * real funds.
 *
 * The threshold is env-configurable so it can be tuned without a code
 * change; defaults to 1000 USDC.
 */
const DEFAULT_LARGE_AMOUNT_THRESHOLD = 1000;

// Robust against an unset OR empty/invalid env value. `Number('')` is 0,
// which would wrongly flag EVERY amount as "large" and show the checkbox on
// all transfers - so anything that doesn't parse to a positive number falls
// back to the default rather than 0.
function resolveThreshold(): number {
  const raw = import.meta.env.VITE_LARGE_AMOUNT_WARN_USDC as string | undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_LARGE_AMOUNT_THRESHOLD;
}

export const LARGE_AMOUNT_THRESHOLD = resolveThreshold();

export function isLargeAmount(amount: string | number): boolean {
  const n = typeof amount === "string" ? parseFloat(amount) : amount;
  return Number.isFinite(n) && n >= LARGE_AMOUNT_THRESHOLD;
}

interface LargeAmountConfirmProps {
  amount: string;
  confirmed: boolean;
  onConfirmedChange: (checked: boolean) => void;
  disabled?: boolean;
}

export function LargeAmountConfirm({
  amount,
  confirmed,
  onConfirmedChange,
  disabled,
}: LargeAmountConfirmProps) {
  if (!isLargeAmount(amount)) return null;

  return (
    <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 space-y-3 animate-in fade-in slide-in-from-top-2 duration-300">
      <div className="flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-amber-400 font-medium">Large transfer</p>
          <p className="text-amber-300/80 text-sm">
            You're about to move{" "}
            <span className="font-semibold">{formatUsd(amount)} USDC</span>. This
            is irreversible once signed - double-check the amount and recipient.
          </p>
        </div>
      </div>
      <label className="flex items-center gap-2 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => onConfirmedChange(e.target.checked)}
          disabled={disabled}
          className="h-4 w-4 rounded border-amber-500/50 accent-amber-500"
        />
        <span className="text-sm text-amber-300">
          I've verified the amount and recipient are correct.
        </span>
      </label>
    </div>
  );
}
