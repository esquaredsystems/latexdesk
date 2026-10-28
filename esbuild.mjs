// Bundles the extension host code, the CLI and each webview into dist/.
import * as esbuild from 'esbuild';
import { copyFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

const common = {
  bundle: true,
  minify: production,
  sourcemap: !production,
  logLevel: 'info',
};

const builds = [
  // Extension host. MathJax and pdf-lib (watermark) are separate bundles, loaded on first use.
  {
    ...common,
    entryPoints: { extension: 'src/extension/extension.ts', mathjax: 'src/extension/mathjax.ts', spellWorker: 'src/extension/spellWorker.ts', watermark: 'src/build/watermark.ts' },
    outdir: 'dist',
    platform: 'node',
    format: 'cjs',
    target: 'node18',
    external: ['vscode'],
  },
  // Headless bibliography checker.
  {
    ...common,
    entryPoints: { bibcheck: 'src/cli/bibcheck.ts', gatecore: 'src/cli/gatecore.ts' },
    outdir: 'dist',
    platform: 'node',
    format: 'cjs',
    target: 'node18',
    banner: { js: '#!/usr/bin/env node' },
  },
  // Webviews (browser code).
  {
    ...common,
    entryPoints: {
      pdfViewer: 'src/webview/pdfViewer.ts',
      bibManager: 'src/webview/bibManager.ts',
      bibEntryForm: 'src/webview/bibEntryForm.ts',
      exportPanel: 'src/webview/exportPanel.ts',
      tableWizard: 'src/webview/tableWizard.ts',
      tools: 'src/webview/tools.ts',
      panels: 'src/webview/panels.ts',
      templateGallery: 'src/webview/templateGallery.ts',
    },
    outdir: 'dist/webview',
    platform: 'browser',
    format: 'esm',
    target: 'es2022',
    loader: { '.css': 'css' },
  },
];

// Start from an empty dist/ for release builds so no stale files are packaged.
if (production) rmSync('dist', { recursive: true, force: true });

// pdf.js needs its worker as a separate file.
mkdirSync('dist/webview', { recursive: true });
copyFileSync('node_modules/pdfjs-dist/build/pdf.worker.min.mjs', 'dist/webview/pdf.worker.min.mjs');
copyFileSync('node_modules/pdfjs-dist/web/pdf_viewer.css', 'dist/webview/pdf_viewer.css');
// Hunspell dictionaries for the spell checker (SCOWL-based, MIT/BSD; see the README).
mkdirSync('dist/dictionaries', { recursive: true });
for (const [pkg, lang] of [['dictionary-en', 'en_US'], ['dictionary-en-gb', 'en_GB']]) {
  copyFileSync(`node_modules/${pkg}/index.aff`, `dist/dictionaries/${lang}.aff`);
  copyFileSync(`node_modules/${pkg}/index.dic`, `dist/dictionaries/${lang}.dic`);
  copyFileSync(`node_modules/${pkg}/license`, `dist/dictionaries/${lang}.license.txt`);
}
// Copy file by file: copying the folder would also copy its read-only permissions.
mkdirSync('dist/webview/images', { recursive: true });
for (const name of readdirSync('node_modules/pdfjs-dist/web/images')) {
  copyFileSync(`node_modules/pdfjs-dist/web/images/${name}`, `dist/webview/images/${name}`);
}

if (watch) {
  for (const options of builds) {
    const ctx = await esbuild.context(options);
    await ctx.watch();
  }
} else {
  await Promise.all(builds.map((options) => esbuild.build(options)));
}
