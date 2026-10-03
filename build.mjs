// Bundle the browser half into client.js in DSH's module-loader format; React comes from the page.
// The Host half ships as plain ESM source (src/host), so it needs no build.
import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';

const PKG = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).name;
const production = !process.argv.includes('--dev');

const client = await build({
  entryPoints: ['src/client/entry.jsx'], bundle: true, write: false, format: 'cjs', platform: 'browser', target: 'es2022',
  jsx: 'automatic', external: ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client'], minify: production, legalComments: 'none',
  define: { 'process.env.NODE_ENV': JSON.stringify(production ? 'production' : 'development') },
});
const wrapped = `window.__ModuleLoader__.load({
  id: ${JSON.stringify(PKG)},
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
${client.outputFiles[0].text}
    return module.exports;
  },
});
`;
writeFileSync(new URL('./client.js', import.meta.url), wrapped);
console.log(`client.js ${(wrapped.length / 1024).toFixed(1)} KB`);
