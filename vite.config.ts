import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import autoprefixer from 'autoprefixer';
import path from 'path';
import { defineConfig } from 'vite';
import { COMPAT_BROWSERSLIST, createCssCompatPostcssPlugin } from './vite.cssCompat.ts';

export default defineConfig(() => {
  return {
    base: process.env.GITHUB_PAGES ? '/Amar-Dokan-Pro/' : '/',

    plugins: [react(), tailwindcss()],

    css: {
      postcss: {
        plugins: [
          createCssCompatPostcssPlugin(),
          autoprefixer({
            overrideBrowserslist: COMPAT_BROWSERSLIST,
          }),
        ],
      },
    },

    build: {
      target: ['chrome88', 'edge88', 'firefox85', 'safari14', 'es2020'],
      cssTarget: ['chrome88', 'edge88', 'firefox85', 'safari14'],
    },

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
