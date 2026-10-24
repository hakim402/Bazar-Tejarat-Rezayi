/** Compile the owner admin's prefixed utilities using the existing locked frontend tooling. */
import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(path.join(root, 'frontend/package.json'));
const postcss = require('postcss');
const tailwind = require('@tailwindcss/postcss');
const from = path.join(root, 'backend/apps/accounts/styles/admin.css');
const to = path.join(root, 'backend/apps/accounts/static/accounts/admin.css');
const result = await postcss([tailwind({ optimize: true })]).process(await readFile(from, 'utf8'), { from, to });
if (process.argv.includes('--check')) {
  if (await readFile(to, 'utf8') !== result.css) throw new Error('Admin styles are stale. Run node backend/scripts/build_admin_styles.mjs');
  console.log('Admin stylesheet matches its source.');
} else {
  await writeFile(to, result.css);
  console.log('Compiled owner admin stylesheet.');
}
