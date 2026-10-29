import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [tanstackRouter({ target: 'react', autoCodeSplitting: true }), react(), tailwindcss()],
  // `bun run tunnel` (scripts/tunnel.ts) serves this dev server under a Cloudflare Tunnel host.
  server: {
    allowedHosts: process.env.RMS_TUNNEL_WEB_HOST ? [process.env.RMS_TUNNEL_WEB_HOST] : [],
  },
})
