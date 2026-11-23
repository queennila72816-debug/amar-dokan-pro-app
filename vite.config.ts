import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import autoprefixer from 'autoprefixer';
import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import { COMPAT_BROWSERSLIST, createCssCompatPostcssPlugin } from './vite.cssCompat.ts';

export default defineConfig(({ mode }) => {
  const loadedEnv = loadEnv(mode, process.cwd(), '');
  const publicSupabaseUrl = (
    process.env.VITE_SUPABASE_URL ||
    loadedEnv.VITE_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    loadedEnv.SUPABASE_URL ||
    ''
  ).trim();
  const publicSupabaseAnonKey = (
    process.env.VITE_SUPABASE_ANON_KEY ||
    loadedEnv.VITE_SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    loadedEnv.VITE_SUPABASE_PUBLISHABLE_KEY ||
    ''
  ).trim();

  if (publicSupabaseUrl && !process.env.VITE_SUPABASE_URL) {
    process.env.VITE_SUPABASE_URL = publicSupabaseUrl;
  }
  if (publicSupabaseAnonKey && !process.env.VITE_SUPABASE_ANON_KEY && !publicSupabaseAnonKey.startsWith('sb_secret_')) {
    process.env.VITE_SUPABASE_ANON_KEY = publicSupabaseAnonKey;
  }

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
