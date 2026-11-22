import { readdir, readFile, access } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const skippedDirectories = new Set(['.git', 'dist', 'node_modules']);

async function markdownFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const location = join(directory, entry.name);
    if (entry.isDirectory()) return skippedDirectories.has(entry.name) ? [] : markdownFiles(location);
    return entry.isFile() && entry.name.endsWith('.md') ? [location] : [];
  }));
  return nested.flat();
}

const files = await markdownFiles(root);
const broken = [];
const links = /\]\((?:<([^>]+)>|([^\s)]+))(?:\s+[^)]*)?\)/g;

for (const file of files) {
  const content = await readFile(file, 'utf8');
  for (const match of content.matchAll(links)) {
    const link = (match[1] ?? match[2]).trim();
    if (!link || /^(?:[a-z][a-z\d+.-]*:|#|\/\/)/i.test(link)) continue;
    const target = link.split(/[?#]/, 1)[0];
    if (!target) continue;
    let path;
    try {
      path = decodeURIComponent(target);
    } catch {
      broken.push(`${file}: invalid URL encoding in ${link}`);
      continue;
    }
    const location = path.startsWith('/') ? resolve(root, '.' + path) : resolve(dirname(file), path);
    try {
      await access(location);
    } catch {
      broken.push(`${file}: ${link}`);
    }
  }
}

if (broken.length) {
  process.stderr.write(broken.join('\n') + '\n');
  process.exitCode = 1;
} else {
  process.stdout.write(`Checked ${files.length} Markdown files; no broken relative links\n`);
}
