import { defineConfig } from 'astro/config';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';

if (existsSync('.env')) loadEnvFile('.env');

// Set SITE_URL to your production origin; BASE_PATH supports subdirectory hosting.
export default defineConfig({
  site: process.env.SITE_URL || 'https://syharipf.github.io',
  base: process.env.BASE_PATH || '/',
  output: 'static',
  trailingSlash: 'always',
  devToolbar: { enabled: false },
});
