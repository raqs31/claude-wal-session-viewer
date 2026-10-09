import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The dev server proxies the API to a wal-server started separately on its default port.
const api = 'http://127.0.0.1:7878'

export default defineConfig({
  root: 'web',
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true },
  server: {
    fs: { allow: ['..'] },
    proxy: { '/events': api, '/events-stream': api, '/record': api, '/sessions': api, '/session': api, '/session-stream': api, '/usage': api, '/usage-stream': api },
  },
})
