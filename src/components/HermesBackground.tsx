/**
 * Ambient page background for the Hermes app.
 *
 * Purely decorative: fixed, non-interactive, and sits behind all content.
 * Pages should render this once, then wrap their own content in a
 * `relative z-10` container so it layers above.
 *
 * Deliberately calm: slow drifting aurora orbs for depth plus a faint
 * network grid. Nothing tracks or streaks across the viewport - moving
 * lines pull the eye away from balances and addresses, which is the last
 * thing a bridge UI should do. All styling lives in index.css under the
 * `.hermes-bg` block, including prefers-reduced-motion handling.
 */
export function HermesBackground() {
  return (
    <div className="hermes-bg" aria-hidden="true">
      <div className="hermes-bg__wash" />
      <div className="hermes-bg__grid" />

      <div className="hermes-bg__orb hermes-bg__orb--1" />
      <div className="hermes-bg__orb hermes-bg__orb--2" />
      <div className="hermes-bg__orb hermes-bg__orb--3" />

      <div className="hermes-bg__vignette" />
    </div>
  );
}

export default HermesBackground;
