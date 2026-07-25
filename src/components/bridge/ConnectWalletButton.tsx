
import { appKit } from '@/lib/reown-config';
import { useAppKitAccount, useAppKitNetwork } from '@reown/appkit/react';
import { Wallet, LogOut, FileText } from 'lucide-react';
import { useDisconnect } from '@reown/appkit/react';
import { useStacksWallet } from '@/hooks/useStacksWallet';
import { useState, useRef } from 'react';
import { useBalance } from 'wagmi';
import { Link } from 'react-router-dom';


export function ConnectWalletButton() {
  const { address, isConnected } = useAppKitAccount();
  const { chainId } = useAppKitNetwork();
  const { data: balance } = useBalance({ address });
  const { disconnect } = useDisconnect();
  const { connectWallet: connectStacksWallet } = useStacksWallet();
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  // (optional: can be improved with useEffect for full accessibility)
  function handleDropdownBlur(e: React.FocusEvent<HTMLDivElement>) {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setShowDropdown(false);
    }
  }

  const displayAddress = address ? `${address.slice(0, 6)}...${address.slice(-4)}` : 'Connect';
  const displayBalance = balance ? balance.formatted : '0.0000';
  const displaySymbol = balance ? balance.symbol : 'ETH';


  if (!isConnected) {
    return (
      <div className="relative inline-block" tabIndex={0} ref={dropdownRef} onBlur={handleDropdownBlur}>
        <button
          onClick={() => setShowDropdown((v) => !v)}
          className="group relative inline-flex items-center gap-2 px-6 py-3 rounded-xl font-semibold text-primary-foreground bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 shadow-lg shadow-orange-500/30 hover:shadow-orange-500/50 transition-all duration-200 active:scale-95"
        >
          <Wallet className="w-5 h-5 transition-transform group-hover:scale-110" />
          <span className="hidden sm:inline">Connect Wallet</span>
          <span className="sm:hidden">Connect</span>
        </button>
        {showDropdown && (
          <div className="absolute right-0 mt-2 w-[90vw] max-w-xs min-w-[180px] sm:w-80 sm:max-w-sm bg-card/95 backdrop-blur-xl border border-border rounded-2xl shadow-2xl shadow-black/40 z-[9999] flex flex-col py-4 px-2 animate-in fade-in-0 zoom-in-95 slide-in-from-top-2 duration-150">
            <div className="px-3 pb-2">
              <span className="block text-lg font-bold text-foreground tracking-tight">Select Wallet</span>
              <span className="block text-xs text-muted-foreground mt-1">Choose a network to connect</span>
            </div>
            <button
              className="flex items-center gap-4 w-full text-left px-3 py-3 my-1 rounded-xl bg-secondary/50 hover:bg-accent border border-transparent hover:border-primary/40 transition-all focus:outline-none focus:ring-2 focus:ring-primary/40"
              onClick={() => {
                setShowDropdown(false);
                connectStacksWallet();
              }}
            >
              <img src="https://res.cloudinary.com/dg5rr4ntw/image/upload/v1768901230/download_7_pixwpt.png" alt="Stacks" className="w-10 h-10 rounded-full border border-border bg-white shadow-sm" />
              <div className="flex flex-col min-w-0">
                <span className="font-semibold text-base text-foreground truncate">Stacks</span>
                <span className="text-xs text-muted-foreground truncate">Leather, Hiro...</span>
              </div>
            </button>
            <button
              className="flex items-center gap-4 w-full text-left px-3 py-3 my-1 rounded-xl bg-secondary/50 hover:bg-accent border border-transparent hover:border-primary/40 transition-all focus:outline-none focus:ring-2 focus:ring-primary/40"
              onClick={() => {
                setShowDropdown(false);
                appKit.open();
              }}
            >
              <img src="https://res.cloudinary.com/dg5rr4ntw/image/upload/v1768900941/download_6_b0zu0z.png" alt="Ethereum" className="w-10 h-10 rounded-full border border-border bg-white shadow-sm" />
              <div className="flex flex-col min-w-0">
                <span className="font-semibold text-base text-foreground truncate">Ethereum</span>
                <span className="text-xs text-muted-foreground truncate">MetaMask, Coinbase...</span>
              </div>
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 sm:gap-3">
      {/* Hermes Trail (transaction records) */}
      <Link
        to="/my-bridges"
        title="Hermes Trail"
        className="flex items-center justify-center p-2 rounded-xl bg-secondary/50 border border-primary/20 hover:border-primary/50 hover:bg-secondary transition-all duration-200"
      >
        <FileText className="w-4 h-4 text-foreground" />
      </Link>

      {/* Network Selector */}
      <button
        onClick={() => appKit.open({ view: 'Networks' })}
        className="hidden sm:flex items-center gap-2 px-3 py-2 rounded-xl bg-secondary/50 border border-primary/20 hover:border-primary/50 hover:bg-secondary transition-all duration-200"
      >
        <div className="w-4 h-4 rounded-full bg-green-500 animate-pulse" />
        <span className="text-xs font-medium text-foreground truncate max-w-[100px]">
          Network
        </span>
      </button>

      {/* Balance Display */}
      <div className="hidden md:flex items-center gap-2 px-3 py-2 rounded-xl bg-secondary/30 border border-primary/10">
        <div className="text-right">
          <div className="text-xs font-semibold text-primary">
            {displayBalance}
          </div>
          <div className="text-xs text-muted-foreground">
            {displaySymbol}
          </div>
        </div>
      </div>

      {/* Account Button */}
      <div className="relative group">
        <button
          onClick={() => appKit.open({ view: 'Account' })}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-primary/20 to-primary/10 border border-primary/30 hover:border-primary/60 hover:from-primary/30 hover:to-primary/20 transition-all duration-200 active:scale-95"
        >
          <div className="w-5 h-5 rounded-lg bg-gradient-to-br from-orange-400 to-orange-600 flex items-center justify-center text-xs font-bold text-white">
            {displayAddress.charAt(0)}
          </div>
          <span className="font-mono text-sm font-semibold text-foreground">
            {displayAddress}
          </span>
        </button>

        {/* Hover Tooltip */}
        <div className="absolute right-0 top-full mt-2 px-3 py-2 rounded-lg bg-slate-900 text-white text-xs font-medium opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap border border-primary/40 z-50 shadow-xl">
          Click to view account
        </div>
      </div>

      {/* Disconnect Button */}
      <button
        onClick={() => disconnect()}
        className="hidden sm:block p-2 rounded-xl bg-red-500/10 border border-red-500/30 hover:bg-red-500/20 hover:border-red-500/60 transition-all duration-200 group"
        title="Disconnect wallet"
      >
        <LogOut className="w-4 h-4 text-red-500 group-hover:text-red-600 transition-colors" />
      </button>
    </div>
  );
}
