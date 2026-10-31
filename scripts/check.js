import { readdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Source symlink rejected: ${target}`);
    if (entry.isDirectory()) files.push(...await walk(target)); else files.push(target);
  }
  return files;
}
let checked = 0;
for (const directory of ['src','public','scripts','test']) {
  for (const file of await walk(directory)) if (file.endsWith('.js')) {
    const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`Syntax check failed: ${file}\n${result.stderr}`);
    checked++;
  }
}
const html = await readFile('public/index.html','utf8');
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
if (new Set(ids).size !== ids.length) throw new Error('Duplicate HTML id');
const js = await readFile('public/app.js','utf8');
for (const [, id] of js.matchAll(/\$\('([^']+)'\)/g)) if (!ids.includes(id)) throw new Error(`Missing HTML id: ${id}`);
if (/innerHTML|localStorage|sessionStorage/.test(js)) throw new Error('Unsafe rendering or persistent token storage found');
for (const file of ['Dockerfile','pnpm-lock.yaml','compose.yaml','compose.test.yaml','README.md','.env.example','docs/DEPLOY_NEO_APP.md','docs/TESTING.md','docs/VERIFICATION.md']) await readFile(file);
console.log(`PASS: ${checked} JavaScript syntax checks, ${ids.length} unique HTML IDs, safe DOM rendering, deployment source files.`);
