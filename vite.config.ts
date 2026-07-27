import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import removeConsole from "vite-plugin-remove-console";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [react(), removeConsole()],
  optimizeDeps: {
    exclude: ["PhGlobe"]
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  // Strip every console.* call and debugger statement from production
  // bundles at the esbuild level. This is belt-and-braces alongside the
  // removeConsole() plugin above: it's built into the minifier, covers
  // console.warn/error (not just .log), and can't be defeated by plugin
  // ordering. Deliberately scoped to production so `pnpm dev` keeps full
  // logging for debugging.
  esbuild: {
    drop: mode === 'production' ? ['console', 'debugger'] : [],
  },
  build: {
    target: 'esnext',
    minify: 'esbuild',
    sourcemap: mode === 'development',
    chunkSizeWarningLimit: 2000, // Increase limit to 2MB to suppress warnings
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom'],
          'vendor-stacks': ['@stacks/connect', '@stacks/transactions', '@stacks/network'],
          'vendor-reown': ['@reown/appkit', '@reown/appkit-adapter-wagmi', 'wagmi', 'viem'],
          'vendor-ui': ['@radix-ui/react-dialog', '@radix-ui/react-toast'],
        },
      },
    },
  },
  define: {
    // Ensure global is defined for some packages
    global: 'globalThis',
  },
}));
