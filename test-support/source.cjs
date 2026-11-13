// Loads TypeScript source modules in tests by bundling them with esbuild (the same compiler the build uses).
const { buildSync } = require('esbuild');
const path = require('node:path');

const root = path.join(__dirname, '..');

function bundle(entry, format, globalName) {
  return buildSync({
    entryPoints: [path.join(root, entry)],
    bundle: true,
    write: false,
    format,
    globalName,
    platform: 'browser',
    target: 'es2022',
    define: { __OPENTEAM_DEV__: 'false' },
    logLevel: 'silent',
  }).outputFiles[0].text;
}

const modules = new Map();

// One module instance per entry and test process, like a normal import.
function importSource(entry) {
  if (!modules.has(entry)) modules.set(entry, import(`data:text/javascript;base64,${Buffer.from(bundle(entry, 'esm')).toString('base64')}`));
  return modules.get(entry);
}

// A classic script that defines `globalName` with the module's exports, for pages run in jsdom.
function sourceScript(entry, globalName) {
  return bundle(entry, 'iife', globalName);
}

// The built, unpacked extension (npm run build).
const dist = (...parts) => path.join(root, 'dist', ...parts);

module.exports = { importSource, sourceScript, dist };
