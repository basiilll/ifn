import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import svgr from 'vite-plugin-svgr'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), svgr()],
  // host:true binds 0.0.0.0 so the dev server is reachable on the LAN static IP
  // (192.168.1.99), not just localhost. Pair with the IP-based VITE_SUPABASE_URL
  // in .env.selfhost so cross-machine browsers hit this host, not their own localhost.
  server: { host: true, port: 5173 },
})
