import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const directory = resolve(process.argv[2] ?? 'test');
const files = readdirSync(directory)
  .filter((name) => name.endsWith('.test.js'))
  .map((name) => resolve(directory, name));

if (!files.length) throw new Error('No test files found in ' + directory);

const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
