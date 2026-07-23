import { describe, it, expect } from "vitest";
import { calculateProtocolFee } from "@/lib/cctp-fees";

// The protocol fee is env-driven (VITE_PROTOCOL_FEE_BPS / _MIN_USDC / _MAX_USDC),
// so derive the expected values from the same source the implementation reads
// rather than hardcoding numbers that drift whenever the config is tuned.
const BPS = Number(import.meta.env.VITE_PROTOCOL_FEE_BPS ?? 6);
const MIN = Number(import.meta.env.VITE_PROTOCOL_FEE_MIN_USDC ?? 0.02);
const MAX = Number(import.meta.env.VITE_PROTOCOL_FEE_MAX_USDC ?? 5);

describe("calculateProtocolFee", () => {
  it("applies the floor for small amounts", () => {
    // A 1 USDC transfer's raw bps fee is far below the floor, so it clamps up.
    const { feeUsdc } = calculateProtocolFee("1");
    expect(feeUsdc).toBe(MIN.toFixed(6));
  });

  it("scales proportionally in the middle of the range", () => {
    // Pick an amount whose raw bps fee lands strictly inside [MIN, MAX].
    const midAmount = ((MIN + MAX) / 2) / (BPS / 10_000);
    const rawFee = (midAmount * BPS) / 10_000;
    const { feeUsdc } = calculateProtocolFee(midAmount.toString());
    expect(feeUsdc).toBe(rawFee.toFixed(6));
    expect(parseFloat(feeUsdc)).toBeGreaterThan(MIN);
    expect(parseFloat(feeUsdc)).toBeLessThan(MAX);
  });

  it("applies the cap for large amounts", () => {
    // A huge transfer's raw bps fee exceeds the cap, so it clamps down.
    const { feeUsdc } = calculateProtocolFee("100000000");
    expect(feeUsdc).toBe(MAX.toFixed(6));
  });

  it("returns zero for invalid or non-positive amounts", () => {
    expect(calculateProtocolFee("0").feeUsdc).toBe("0");
    expect(calculateProtocolFee("").feeUsdc).toBe("0");
    expect(calculateProtocolFee("-5").feeUsdc).toBe("0");
  });
});
