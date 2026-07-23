import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Catches render-time errors anywhere below it so a bug in one component
 * (a wallet extension quirk, an unexpected undefined, etc.) shows a
 * recoverable screen instead of a blank white page - this app moves real
 * funds, so a user should never be left wondering if a crash mid-bridge
 * means something went wrong on-chain.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary] Unhandled error:", error, info.componentStack);
  }

  handleReload = () => {
    this.setState({ error: null });
    window.location.reload();
  };

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen bg-background flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-card border border-border rounded-2xl p-8 text-center space-y-4">
            <div className="w-14 h-14 mx-auto rounded-full bg-destructive/10 flex items-center justify-center">
              <AlertTriangle className="w-7 h-7 text-destructive" />
            </div>
            <h1 className="text-xl font-bold text-foreground">Something went wrong</h1>
            <p className="text-sm text-muted-foreground">
              The app hit an unexpected error. This does not affect any transaction you already
              submitted on-chain - check your wallet or a block explorer if you're unsure of a
              transfer's status.
            </p>
            <button
              onClick={this.handleReload}
              className="w-full gradient-bitcoin text-primary-foreground font-semibold py-3 rounded-xl hover:opacity-90 transition-opacity"
            >
              Reload App
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
