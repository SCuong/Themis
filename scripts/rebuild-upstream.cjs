// Rebuilds the OpenTeam v1.0.3 release that Themis was made from, from its TypeScript source, and lists
// which files of the Themis build (dist/, npm run build) are identical to it. Since Themis builds from its
// own copy of that source (src/), this is a reference point for reviewing what Themis changed.
//   npm run rebuild:upstream          (needs git, network and a few minutes)
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { existsSync, readFileSync, readdirSync, rmSync } = require('node:fs');
const path = require('node:path');

const REPO = 'https://github.com/afumu/openteam.git';
const COMMIT = '8ef6f37e5fb070c9cb3fb2217837bb4aba2c27d2'; // tag v1.0.3
const root = path.join(__dirname, '..');
const work = path.join(root, 'test-results', 'upstream');
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });

rmSync(work, { recursive: true, force: true });
run('git', ['clone', '--quiet', REPO, work], root);
run('git', ['checkout', '--quiet', COMMIT], work);
run('npm', ['ci', '--no-audit', '--no-fund'], work);
run('npm', ['run', 'build'], work);

const dist = path.join(work, 'dist');
const hash = file => createHash('sha256').update(readFileSync(file)).digest('hex');
const list = dir => readdirSync(dir, { recursive: true, withFileTypes: true })
  .filter(e => e.isFile() && /\.(js|css|html|json)$/.test(e.name))
  .map(e => path.relative(dir, path.join(e.parentPath ?? e.path, e.name)).replaceAll('\\', '/'));

const rows = list(dist).map(file => {
  const ours = path.join(root, 'dist', file);
  const state = !existsSync(ours) ? 'not in the Themis build' : hash(ours) === hash(path.join(dist, file)) ? 'identical' : 'changed by Themis';
  return [file, state];
});
for (const [file, state] of rows.sort()) console.log(`${state.padEnd(24)} ${file}`);
console.log(`\nUpstream build: ${dist}`);
