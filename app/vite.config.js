import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Tailwind v4：不再要 tailwind.config.js，插件 + CSS 里 @theme 即可
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:3001' }, // 开发期同源转发，免 CORS（后端仍开着 cors）
  },
})
