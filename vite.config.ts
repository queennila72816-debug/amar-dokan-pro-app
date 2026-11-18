import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

export default defineConfig(() => {
  return {
    base: process.env.GITHUB_PAGES ? '/Amar-Dokan-Pro/' : '/',

    plugins: [react(), tailwindcss()],

    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, '.'),
      },
    },

    server: {
      // HMR configuration
      hmr: process.env.DISABLE_HMR !== 'true',

      // Disable file watching when HMR is disabled
      watch:
        process.env.DISABLE_HMR === 'true'
          ? null
          : {},
    },
  };
});
