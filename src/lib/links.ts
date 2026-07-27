/**
 * External links used across the app. Kept in one place so a changed handle
 * or invite link is a single edit rather than a hunt through components and
 * legal pages.
 */

export const SOCIAL_LINKS = {
  x: 'https://x.com/HermesBridge',
  /**
   * Telegram support group. Note this is an invite-style link (t.me/+...),
   * which can be revoked or rotated from Telegram's side - if support stops
   * being reachable, check that this link is still live before debugging
   * anything else.
   */
  telegram: 'https://t.me/+2SdxD9VinqAxY2U0',
} as const;

/** Where users should be told to go for help, in one place. */
export const SUPPORT_URL = SOCIAL_LINKS.telegram;
