import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    allowedHosts: ['3000-i6kuv2en6z05cb57p8wc8-d544a589.us3.manus.computer'],
    port: 3000,
    proxy: { '/api': { target: 'http://localhost:4000', changeOrigin: true } },
  },
})