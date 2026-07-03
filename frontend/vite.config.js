import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/trade': { target: 'http://localhost:9000', changeOrigin: true },
      '/market': { target: 'http://localhost:9000', changeOrigin: true },
      '/portfolio': { target: 'http://localhost:9000', changeOrigin: true },
      '/auth': { target: 'http://localhost:9000', changeOrigin: true },
      '/sentinel': { target: 'http://localhost:9000', changeOrigin: true },
      '/orderbooks': { target: 'http://localhost:9000', changeOrigin: true },
      '/optionchains': { target: 'http://localhost:9000', changeOrigin: true },
      '/stream': { target: 'http://localhost:9010', changeOrigin: true },
      '/start': { target: 'http://localhost:9010', changeOrigin: true },
      '/stop': { target: 'http://localhost:9010', changeOrigin: true },
      '/algo': { target: 'http://localhost:9010', changeOrigin: true },
      '/state': { target: 'http://localhost:9010', changeOrigin: true },
      '/health': { target: 'http://localhost:9010', changeOrigin: true },
    },
  },
})
