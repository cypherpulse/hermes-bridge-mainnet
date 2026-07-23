import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { wagmiAdapter, appKit } from "./lib/reown-config";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
// PostHog removed
import "./index.css";

const queryClient = new QueryClient();


const container = document.getElementById("root");
if (!container) throw new Error('Failed to find root element');

createRoot(container).render(
  <ErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <WagmiProvider config={wagmiAdapter.wagmiConfig}>
        <App />
      </WagmiProvider>
    </QueryClientProvider>
  </ErrorBoundary>
);
