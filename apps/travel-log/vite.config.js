import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Proxies API requests during local development
      '/api': {
        target: 'http://localhost:3000', // Or whatever port your local API usually runs on
        changeOrigin: true,
        secure: false,
      }
    }
  }
})