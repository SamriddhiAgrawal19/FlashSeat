import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// The API has no CORS, so in dev every call goes through this proxy: /api/* is
// forwarded to the backend with the /api prefix stripped. The refresh-token
// cookie is set with Path=/auth by the API; rewriting it to /api/auth makes the
// browser send it back on /api/auth/* requests (login/refresh, later).
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiTarget = env.VITE_API_PROXY_TARGET || 'http://localhost:3000';

  return {
    plugins: [react(), tailwindcss()],
    server: {
      port: 5173,
      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, ''),
          cookiePathRewrite: { '/auth': '/api/auth' },
        },
      },
    },
  };
});
