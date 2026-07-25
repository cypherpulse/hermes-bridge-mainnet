import { Link } from "react-router-dom";
import { LegalLayout } from "@/components/legal/LegalLayout";

const Faq = () => {
  return (
    <LegalLayout title="FAQ & How It Works" lastUpdated="July 25, 2026">
      <h2>What is Hermes?</h2>
      <p>
        Hermes is a non-custodial bridge for moving USDC between Ethereum, several
        major EVM chains, and Stacks (where it arrives as USDCx). Hermes never
        takes custody of your funds - every transfer is signed directly by your
        own wallet, and the underlying movement of funds is handled by Circle's
        Cross-Chain Transfer Protocol (CCTP) and xReserve infrastructure, not by
        Hermes itself.
      </p>

      <h2>How long does a bridge take?</h2>
      <p>
        This is the single biggest source of confusion, so here's the honest
        breakdown. Times depend on the route and the transfer speed you choose:
      </p>
      <h3>Bridging to Stacks (USDC → USDCx)</h3>
      <p>
        Once your deposit transaction confirms, funds move through Circle's
        attestation service before USDCx is minted to your Stacks address. This
        step requires no signature or action from you - it completes
        automatically. It <strong>typically takes 10-20 minutes</strong>,
        occasionally longer during periods of network congestion. You can safely
        close the tab; check{" "}
        <Link to="/my-bridges">Hermes Trail</Link> anytime to see whether it has
        completed.
      </p>
      <h3>EVM-to-EVM transfers (e.g. Base → Avalanche)</h3>
      <p>
        These move directly over Circle's CCTP and are faster: roughly{" "}
        <strong>20 seconds to 2 minutes</strong> on Fast Transfer, or{" "}
        <strong>6-12 minutes</strong> on Standard Transfer.
      </p>
      <p>
        <strong>Fast vs. Standard:</strong> Fast Transfer is available on most
        routes and settles almost immediately for a small additional fee set by
        Circle. If a route doesn't support Fast Transfer, Hermes automatically
        falls back to Standard and tells you so before you confirm.
      </p>

      <h2>What does it cost?</h2>
      <p>Every bridge has up to two fees, both shown before you confirm:</p>
      <ul>
        <li>
          <strong>Hermes protocol fee</strong> - 0.06% of the transfer amount
          (minimum $0.001, capped at $5 USDC).
        </li>
        <li>
          <strong>Circle's network fee</strong> - set by Circle, varies by route
          and transfer speed. This is a pass-through cost, not Hermes revenue.
        </li>
      </ul>
      <p>Plus normal gas fees on the source chain, paid directly to miners/validators - Hermes does not collect these.</p>

      <h2>Which chains are supported?</h2>
      <p>
        Ethereum, Base, Arbitrum, Avalanche, Optimism, Polygon, Linea, Unichain,
        and World Chain, all bridging to and from Stacks or to each other
        directly.
      </p>

      <h2>Is Hermes custodial? Can Hermes access my funds?</h2>
      <p>
        No. Hermes is an interface only - it never holds your USDC, USDCx, or
        private keys at any point. Every step (approval, fee payment, deposit)
        is a transaction you sign yourself with your own wallet.
      </p>

      <h2>How do I check the status of a bridge?</h2>
      <p>
        Open <Link to="/my-bridges">Hermes Trail</Link> from the wallet icon in
        the header - it shows every bridge you've initiated from your connected
        wallet, with live status (pending, in progress, completed, or failed)
        and a step-by-step breakdown with links to the relevant block explorer.
      </p>

      <h2>My bridge has been "in progress" for a while - is something wrong?</h2>
      <p>
        Not necessarily. See the timing breakdown above - a Stacks-bound bridge
        can legitimately take up to 20 minutes (occasionally more) during the
        Circle attestation step, and this requires no action from you. If it's
        been significantly longer than that, check Hermes Trail for the exact
        step it's on, and reach out (see Contact below) if you're concerned.
      </p>

      <h2>What are the risks?</h2>
      <p>
        Bridging involves interacting with smart contracts on multiple chains
        (Circle's CCTP/xReserve contracts and Stacks' USDCx contract), which
        carries inherent smart-contract risk, as with any DeFi protocol. See the{" "}
        <Link to="/terms">Terms of Service</Link> for the full risk disclosure
        before bridging.
      </p>

      <h2>Contact</h2>
      <p>
        Questions or an issue with a bridge? Reach out on{" "}
        <a href="https://x.com/HermesBridge" target="_blank" rel="noopener noreferrer">
          X (@HermesBridge)
        </a>
        .
      </p>
    </LegalLayout>
  );
};

export default Faq;
