import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  root: 'src',
  // Static assets live in frontend/assets and frontend/icons — served by Express.
  // We don't copy them into dist because vite.config.js handles asset references via
  // the proxy. For a production build you can copy them manually or use a CI step.
  publicDir: false,
  build: {
    outDir: path.resolve(__dirname, 'dist'),
    emptyOutDir: true,
  },
  server: {
    port: 5174,
    proxy: {
      '/api': 'http://localhost:4005',
      '/auth': 'http://localhost:4005',
      '/health': 'http://localhost:4005',
      // Proxy static asset directories served by Express from frontend/
      '/assets': 'http://localhost:4005',
      '/icons': 'http://localhost:4005',
    },
  },
});
