/**
 * Turn wallet/RPC/SDK errors into short, user-facing messages instead of
 * raw viem dumps (calldata, docs links, "Request Arguments: ...").
 */

interface ViemLikeError {
  shortMessage?: string;
  message?: string;
}

const PATTERNS: Array<[RegExp, string]> = [
  [/user rejected|rejected the request|user denied/i, 'You rejected the request in your wallet.'],
  [/insufficient funds/i, 'Insufficient funds to cover this transaction plus gas fees.'],
  [/insufficient allowance/i, 'Insufficient token allowance - try approving again.'],
  [/chain mismatch|wrong network|does not match the target chain/i, 'Wrong network - please switch networks and try again.'],
  [/timed? ?out/i, 'The request timed out. Please try again.'],
  [/already pending/i, 'A request is already pending in your wallet - check for a popup.'],
];

export function friendlyErrorMessage(error: unknown, fallback = 'Something went wrong. Please try again.'): string {
  const err = error as ViemLikeError | undefined;
  const raw = err?.shortMessage || (error instanceof Error ? error.message : String(error ?? ''));

  for (const [pattern, friendly] of PATTERNS) {
    if (pattern.test(raw)) return friendly;
  }

  // viem/ethers put the human-readable summary on the first line; anything
  // longer than that is calldata/docs-link noise we don't want to show.
  // The cap is generous enough to fit our own deliberately-worded safety
  // messages (e.g. reconcileMintByBalance's "do not resubmit" warning),
  // which are meaningfully longer than a typical one-line SDK error.
  const firstLine = raw.split('\n')[0].trim();
  if (firstLine && firstLine.length < 320) return firstLine;

  return fallback;
}
