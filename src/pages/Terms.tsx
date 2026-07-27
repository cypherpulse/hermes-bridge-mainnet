import { Link } from "react-router-dom";
import { LegalLayout } from "@/components/legal/LegalLayout";
import { SOCIAL_LINKS } from "@/lib/links";

const Terms = () => {
  return (
    <LegalLayout title="Terms of Service" lastUpdated="July 25, 2026">
      <p>
        These terms govern your use of Hermes (the "Service"). By connecting a
        wallet and using the Service, you agree to them. If you don't agree,
        don't use the Service.
      </p>

      <h2>1. Description of the Service</h2>
      <p>
        Hermes is a non-custodial interface that helps you initiate transfers
        of USDC between supported chains, and between those chains and Stacks
        (as USDCx), using Circle's CCTP and xReserve protocols. Hermes does not
        operate those underlying protocols, does not custody funds at any
        point, and every on-chain action is signed and submitted by your own
        wallet.
      </p>

      <h2>2. Eligibility</h2>
      <p>
        You're responsible for determining whether it's legal for you to use
        the Service in your jurisdiction, and for complying with any
        applicable laws (including tax obligations arising from your use of
        the Service). The Service is not available to anyone on a sanctions
        list or in a jurisdiction where its use would be prohibited.
      </p>

      <h2>3. Risks</h2>
      <p>You acknowledge and accept the following risks before bridging:</p>
      <ul>
        <li>
          <strong>Smart contract risk</strong> - Hermes relies on Circle's
          CCTP/xReserve contracts and the Stacks USDCx contract. A bug or
          exploit in any of these, though not something Hermes controls, could
          result in loss of funds.
        </li>
        <li>
          <strong>Irreversibility</strong> - blockchain transactions cannot be
          reversed once confirmed. Double-check addresses and amounts before
          confirming any step.
        </li>
        <li>
          <strong>Timing variance</strong> - bridge completion times are
          estimates (see the <Link to="/faq">FAQ</Link>) and depend on third-party
          infrastructure (Circle's attestation service, network congestion,
          chain finality) outside Hermes' control. Delays can occasionally
          exceed the typical range.
        </li>
        <li>
          <strong>Gas and network fees</strong> - paid to the underlying
          network, not to Hermes, and are non-refundable regardless of
          transaction outcome.
        </li>
        <li>
          <strong>Third-party infrastructure risk</strong> - RPC providers,
          wallet software, and connection tooling (e.g. WalletConnect/Reown)
          are outside Hermes' control and can affect availability.
        </li>
      </ul>

      <h2>4. Fees</h2>
      <p>
        Hermes charges a protocol fee (currently 0.06% of the transfer amount,
        minimum $0.001, capped at $5 USDC) on top of Circle's own network fee.
        Both are disclosed before you confirm a transaction. Fees are subject
        to change; the rate shown at the time of your transaction is what
        applies.
      </p>

      <h2>5. No warranty</h2>
      <p>
        The Service is provided "as is" and "as available," without warranties
        of any kind, express or implied, including fitness for a particular
        purpose, uninterrupted availability, or error-free operation.
      </p>

      <h2>6. Limitation of liability</h2>
      <p>
        To the fullest extent permitted by law, Hermes and its operators are
        not liable for any indirect, incidental, or consequential damages, or
        for any loss of funds resulting from smart contract failures,
        third-party protocol issues, user error (e.g. incorrect addresses), or
        events outside Hermes' reasonable control.
      </p>

      <h2>7. Prohibited use</h2>
      <p>
        You may not use the Service for money laundering, sanctions evasion,
        fraud, or any other unlawful purpose.
      </p>

      <h2>8. Changes to these terms</h2>
      <p>
        These terms may be updated from time to time; the "Last updated" date
        above reflects the most recent revision. Continued use of the Service
        after a change constitutes acceptance of the updated terms.
      </p>

      <h2>9. Contact</h2>
      <p>
        Questions about these terms, or need support? Reach us in our{" "}
        <a href={SOCIAL_LINKS.telegram} target="_blank" rel="noopener noreferrer">
          Telegram support group
        </a>{" "}
        or on{" "}
        <a href={SOCIAL_LINKS.x} target="_blank" rel="noopener noreferrer">
          X (@HermesBridge)
        </a>
        .
      </p>
    </LegalLayout>
  );
};

export default Terms;
