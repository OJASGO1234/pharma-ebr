import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// `npm run dev -w client` proxies the API to the Express server on :3000
export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': 'http://localhost:3000' } },
});
