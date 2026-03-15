import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import fs from 'fs';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [
      react(),
      // ── Inject build timestamp into service worker ──────────────────────
      {
        name: 'inject-sw-version',
        closeBundle() {
          const swPath = path.resolve(__dirname, 'dist/sw.js');
          if (fs.existsSync(swPath)) {
            let content = fs.readFileSync(swPath, 'utf-8');
            const version = Date.now(); // unique on every build
            content = content.replace(
              /const CACHE_NAME = ['"]learning-tracker-[^'"]*['"]/,
              `const CACHE_NAME = 'learning-tracker-${version}'`
            );
            content = content.replace(
              /const API_CACHE = ['"]lt-api-cache-[^'"]*['"]/,
              `const API_CACHE = 'lt-api-cache-${version}'`
            );
            fs.writeFileSync(swPath, content);
            console.log(`✅ SW cache version set to: ${version}`);
          }
        },
      },
    ],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      allowedHosts: true,
    },
  };
});