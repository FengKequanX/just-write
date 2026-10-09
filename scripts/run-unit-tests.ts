import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const root = path.resolve(import.meta.dir, '..');
function tests(dir: string): string[] { return fs.readdirSync(dir, { withFileTypes: true }).flatMap(x => x.name === 'node_modules' ? [] : x.isDirectory() ? tests(path.join(dir, x.name)) : x.name.endsWith('.test.ts') && !x.name.endsWith('.render.test.ts') ? [path.join(dir, x.name)] : []); }
const inputs = [...tests(path.join(root, 'plugins/just-write')), ...tests(path.join(root, 'scripts'))];
const result = spawnSync(process.execPath, ['test', ...inputs], { cwd: root, stdio: 'inherit', shell: false });
if (result.error) console.error(result.error.message);
process.exitCode = result.status ?? 2;
