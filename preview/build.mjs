import { build } from 'esbuild';
import { copyFileSync } from 'node:fs';
await build({ entryPoints: [new URL('./preview.jsx', import.meta.url).pathname], bundle: true, outfile: new URL('./preview.js', import.meta.url).pathname,
  format: 'esm', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' }, minify: true });
copyFileSync(new URL('../../scheduler-plugin/preview/index.html', import.meta.url), new URL('./index.html', import.meta.url));
