import { Link } from "react-router-dom";

export function Footer() {
  return (
    <footer className="w-full mt-12 border-t border-border backdrop-blur-sm bg-background/80 py-8 px-4 flex flex-col sm:flex-row items-center justify-between gap-4 z-50">
      <div className="flex flex-col sm:flex-row items-center gap-2 sm:gap-4 text-center sm:text-left">
        <div className="flex items-center gap-2 text-base font-medium text-foreground">
          <span>© {new Date().getFullYear()} Hermes</span>
          <span className="hidden sm:inline text-muted-foreground">|</span>
          <span className="text-xs text-muted-foreground">Multichain USDC Bridge</span>
        </div>
        <nav className="flex items-center gap-3 text-xs text-muted-foreground">
          <Link to="/faq" className="hover:text-primary transition-colors">FAQ</Link>
          <span className="text-border">•</span>
          <Link to="/privacy" className="hover:text-primary transition-colors">Privacy Policy</Link>
          <span className="text-border">•</span>
          <Link to="/terms" className="hover:text-primary transition-colors">Terms of Service</Link>
        </nav>
      </div>
      <a
        href="https://x.com/HermesBridge"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="X (Twitter)"
        className="flex items-center gap-2 text-muted-foreground hover:text-primary transition-colors"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-6 h-6">
          <path d="M17.53 3H21.5L14.5 10.98L22.75 21H16.31L11.38 14.78L5.78 21H1.8L9.2 12.52L1.25 3H7.86L12.33 8.67L17.53 3ZM16.41 19H18.23L7.68 4.89H5.73L16.41 19Z" fill="currentColor"/>
        </svg>
        <span className="text-sm font-medium">Find us on X</span>
      </a>
    </footer>
  );
}
