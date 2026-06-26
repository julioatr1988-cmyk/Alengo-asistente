import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    watch: {
      // Ignorar carpetas de whatsapp-web.js para que Vite no recargue la página
      ignored: [
        '**/.wwebjs_cache/**',
        '**/.wwebjs_auth/**',
        '**/wa-session/**',
        '**/release/**',
        '**/dist-electron/**',
      ],
    },
  },
})
