/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { handleApiRequest } from './server/proxy.ts';

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'interview-game-api',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          handleApiRequest(req, res).then((handled) => {
            if (!handled) next();
          }, next);
        });
      },
      configurePreviewServer(server) {
        server.middlewares.use((req, res, next) => {
          handleApiRequest(req, res).then((handled) => {
            if (!handled) next();
          }, next);
        });
      },
    },
  ],
  server: { host: '127.0.0.1', port: 5173 },
  optimizeDeps: {
    // Lazily imported (dynamic import) dependencies. Pre-bundling them at startup means the first
    // PDF / DOCX upload or the first Claude request never triggers "new dependencies optimized,
    // reloading" in dev — a reload that would wipe the setup wizard or an interview in progress.
    // Keep these specifiers identical to the ones in src/resume/pdf.ts, src/resume/docx.ts and
    // src/llm/anthropic.ts (its structured-output schemas come from zod, which the dep scan finds).
    include: ['pdfjs-dist/legacy/build/pdf.mjs', 'mammoth/mammoth.browser.js', '@anthropic-ai/sdk'],
  },
  test: {
    include: ['src/**/*.test.{ts,tsx}', 'server/**/*.test.ts'],
    environment: 'node',
  },
});
