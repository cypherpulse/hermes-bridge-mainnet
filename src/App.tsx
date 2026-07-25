import { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Index from "./pages/Index";
import MultiChain from "./pages/MultiChain";
import Transfer from "./pages/Transfer";
import HermesTrail from "./pages/HermesTrail";
import Faq from "./pages/Faq";
import PrivacyPolicy from "./pages/PrivacyPolicy";
import Terms from "./pages/Terms";
import NotFound from "./pages/NotFound";

const Solana = lazy(() => import("./pages/Solana"));
const SolanaProvider = lazy(() =>
  import("./components/SolanaProvider").then((m) => ({ default: m.SolanaProvider }))
);

const App = () => (
  <TooltipProvider>
    <Toaster />
    <Sonner />
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route path="/" element={<Index />} />
        <Route path="/multichain" element={<MultiChain />} />
        <Route
          path="/solana"
          element={
            <Suspense fallback={null}>
              <SolanaProvider>
                <Solana />
              </SolanaProvider>
            </Suspense>
          }
        />
        <Route path="/transfer" element={<Transfer />} />
        <Route path="/my-bridges" element={<HermesTrail />} />
        <Route path="/faq" element={<Faq />} />
        <Route path="/privacy" element={<PrivacyPolicy />} />
        <Route path="/terms" element={<Terms />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  </TooltipProvider>
);

export default App;