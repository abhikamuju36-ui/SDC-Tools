import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: false,
  },
  server: {
    port: 5173,
    // tokens.css lives in packages/design-system, outside this Vite root
    fs: { allow: ['../../..'] },
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
      },
      '/thumbnails': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
      },
    },
  },
});
