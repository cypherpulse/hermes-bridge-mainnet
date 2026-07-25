import { LegalLayout } from "@/components/legal/LegalLayout";

const PrivacyPolicy = () => {
  return (
    <LegalLayout title="Privacy Policy" lastUpdated="July 25, 2026">
      <p>
        This policy explains what information Hermes collects when you use the
        bridge, why, and who it's shared with. Hermes is a non-custodial
        interface - we never ask for your name, email, or identity documents,
        and we never have access to your private keys or funds.
      </p>

      <h2>Information we collect</h2>
      <h3>Wallet addresses</h3>
      <p>
        When you connect a wallet, we see your public Ethereum and/or Stacks
        address - the same information anyone can see by looking up that
        address on a public block explorer. This is not personally identifying
        on its own.
      </p>
      <h3>Transaction records</h3>
      <p>
        When you initiate a bridge, we record the transaction: source and
        destination chains, amount, fees, status, and the on-chain transaction
        hashes for each step. This is stored so that if a bridge stalls or
        fails, we can look up what happened and help - it's also what powers
        the <strong>Hermes Trail</strong> history view for your own wallet.
        Recording happens automatically in the background and never delays or
        blocks your bridge.
      </p>
      <h3>Basic usage analytics</h3>
      <p>
        We use Google Analytics to understand aggregate usage of the site
        (pages visited, general traffic patterns). This is standard web
        analytics and is not linked to your wallet address or bridge activity.
      </p>

      <h2>What we do not collect</h2>
      <ul>
        <li>No email address, name, or government ID</li>
        <li>No private keys, seed phrases, or wallet passwords - Hermes never has access to these</li>
        <li>No custody of your funds at any point</li>
      </ul>

      <h2>Third parties involved in a bridge</h2>
      <p>
        Completing a bridge necessarily involves several third-party services,
        each of which processes the transaction data relevant to their part of
        the transfer, under their own privacy terms:
      </p>
      <ul>
        <li><strong>Circle</strong> - operates CCTP and xReserve, the protocols that actually move USDC/USDCx between chains</li>
        <li><strong>Hiro</strong> - provides the Stacks blockchain API used to confirm USDCx mints</li>
        <li><strong>RPC providers</strong> (e.g. Alchemy, public node operators) - relay your transactions to each blockchain</li>
        <li><strong>Reown / WalletConnect</strong> - powers the wallet connection itself</li>
      </ul>

      <h2>Public blockchain data</h2>
      <p>
        Every bridge transaction is recorded permanently on the relevant public
        blockchains (Ethereum, the other supported EVM chains, and Stacks),
        independent of Hermes. That data - addresses, amounts, timestamps - is
        inherently public and outside our control once submitted.
      </p>

      <h2>Data retention</h2>
      <p>
        Transaction records are retained to support troubleshooting, auditing,
        and the Hermes Trail history feature. We don't sell or share this data
        with third parties beyond what's needed to operate the bridge (listed
        above).
      </p>

      <h2>Changes to this policy</h2>
      <p>
        If this policy changes, the "Last updated" date at the top of this page
        will reflect it. Material changes will be noted here.
      </p>

      <h2>Contact</h2>
      <p>
        Questions about this policy? Reach out on{" "}
        <a href="https://x.com/HermesBridge" target="_blank" rel="noopener noreferrer">
          X (@HermesBridge)
        </a>
        .
      </p>

      <p className="text-xs mt-10 border-t border-border pt-4">
        This document is provided as a general-purpose template and does not
        constitute legal advice. It should be reviewed by qualified legal
        counsel to confirm compliance with the laws applicable to your
        jurisdiction and user base.
      </p>
    </LegalLayout>
  );
};

export default PrivacyPolicy;
