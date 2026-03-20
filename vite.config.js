import { defineConfig } from 'vite';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default defineConfig({
  publicDir: 'public',
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true
      }
    }
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        login: resolve(__dirname, 'login.html'),
        signup: resolve(__dirname, 'signup.html'),
        dashboard: resolve(__dirname, 'dashboard.html'),
        connectors: resolve(__dirname, 'connectors.html'),
        contacts: resolve(__dirname, 'contacts.html'),
        deals: resolve(__dirname, 'deals.html'),
        normalization: resolve(__dirname, 'normalization.html'),
      },
      output: {
        manualChunks: undefined
      }
    },
  }
});
