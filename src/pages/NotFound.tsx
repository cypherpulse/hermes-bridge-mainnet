import { useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { Compass } from "lucide-react";
import Navbar from "@/components/Navbar";
import { Footer } from "@/components/Footer";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Navbar />
      <main className="flex-1 flex items-center justify-center px-4 py-20">
        <div className="text-center max-w-sm">
          <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-secondary flex items-center justify-center">
            <Compass className="w-8 h-8 text-muted-foreground" />
          </div>
          <h1 className="text-5xl font-bold text-gradient-bitcoin mb-3">404</h1>
          <p className="text-muted-foreground mb-8">
            This page doesn't exist. Check the URL, or head back to bridge USDC.
          </p>
          <Link
            to="/"
            className="inline-flex items-center justify-center gradient-bitcoin text-primary-foreground font-semibold px-8 py-3 rounded-xl hover:opacity-90 transition-opacity glow-orange"
          >
            Return to Home
          </Link>
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default NotFound;
