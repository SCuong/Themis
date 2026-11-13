// Prints the SHA-256 of every file in dist/, sorted by path, plus one hash over the whole list.
// Two builds from clean checkouts must print the same output.   npm run build && npm run hashes
const { createHash } = require('node:crypto');
const { readFileSync, readdirSync } = require('node:fs');
const path = require('node:path');

const dist = path.join(__dirname, '..', 'dist');
const sha256 = data => createHash('sha256').update(data).digest('hex');
const files = readdirSync(dist, { recursive: true, withFileTypes: true })
  .filter(entry => entry.isFile())
  .map(entry => path.relative(dist, path.join(entry.parentPath ?? entry.path, entry.name)).split(path.sep).join('/'))
  .sort();
const lines = files.map(file => `${sha256(readFileSync(path.join(dist, file)))}  ${file}`);
console.log(lines.join('\n'));
console.log(`\n${sha256(lines.join('\n'))}  (all ${files.length} files)`);
