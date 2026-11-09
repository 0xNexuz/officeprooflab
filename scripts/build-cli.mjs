// Bundles the command-line tool and the engine (with Univer's formula engine) into one file that runs with plain Node.
// The bundle is committed so the GitHub Action works without an install step.
import { build } from 'esbuild';
import { statSync } from 'node:fs';

await build({
  entryPoints: ['cli/officeproof.ts'], outfile: 'dist/officeproof.cjs', bundle: true, platform: 'node', format: 'cjs', target: 'node20',
  minify: true, legalComments: 'none', banner: { js: '#!/usr/bin/env node' }, logLevel: 'warning',
  // Univer's formula packages reference browser globals only inside functions the headless engine never calls.
  define: { 'process.env.NODE_ENV': '"production"' },
});
console.log(`dist/officeproof.cjs ${(statSync('dist/officeproof.cjs').size / 1024 / 1024).toFixed(2)} MB`);
