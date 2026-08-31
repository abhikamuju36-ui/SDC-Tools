import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3131,
    open: true,
    proxy: {
      // Project API server — server.js runs on PORT (4004 in SDC Tools)
      '/api': 'http://localhost:4004',
    },
  },
  // Explicitly pre-bundle React to avoid Node 24 resolution issues
  optimizeDeps: {
    include: ['react', 'react-dom', 'react/jsx-runtime'],
  },
});
