import { defineConfig } from 'vite';

/**
 * The sandbox serves the dev server through a proxied preview host, which Vite
 * rejects unless it is explicitly allowed. `allowedHosts: true` accepts the
 * proxied host in this environment; production builds are static files and are
 * unaffected.
 */
export default defineConfig({
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    allowedHosts: true,
    hmr: { clientPort: 443 },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
