import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const consumerRoot = fileURLToPath(new URL('./web', import.meta.url));
const outputRoot = fileURLToPath(new URL('./public', import.meta.url));

const proxyRule = {
  target: 'http://127.0.0.1:8767',
  changeOrigin: true,
  ws: true,
  configure: proxy => proxy.on('proxyReq', req => req.setHeader('origin', 'http://127.0.0.1:8767')),
};

export default defineConfig({
  root: consumerRoot,
  base: '/',
  publicDir: false,
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': proxyRule,
      '/events': proxyRule,
    },
  },
  build: {
    outDir: outputRoot,
    emptyOutDir: true,
    target: 'es2022',
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      onwarn: (warning, warn) => {
        if (warning.code === 'MODULE_LEVEL_DIRECTIVE') return;
        warn(warning);
      },
    },
  },
});
