/**
 * Fix directory (barrel) imports for Node.js ESM.
 * Node.js ESM does NOT support importing directories - you must
 * import "./dir/index.js" explicitly, not "./dir" or "./dir.js".
 * 
 * This script finds imports that point to directories with index.ts
 * and rewrites them from "./dir.js" to "./dir/index.js".
 */
import { readdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = resolve(__dirname, '..', 'src');

function getAllTsFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...getAllTsFiles(fullPath));
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      files.push(fullPath);
    }
  }
  return files;
}

function fixBarrelImports(filePath, content) {
  const fileDir = dirname(filePath);
  let modified = content;

  // Match imports like: from "./something.js" or from "../something.js"
  modified = modified.replace(
    /(from\s+["'])(\.\.?\/[^"']+?)(\.js)(["'])/g,
    (match, prefix, importPath, ext, suffix) => {
      // Resolve the path without .js to see if it's a directory with index.ts
      const resolvedDir = resolve(fileDir, importPath);
      if (existsSync(resolvedDir) && statSync(resolvedDir).isDirectory()) {
        if (existsSync(join(resolvedDir, 'index.ts'))) {
          return `${prefix}${importPath}/index.js${suffix}`;
        }
      }
      return match;
    }
  );

  // Also fix dynamic imports: import("./something.js")
  modified = modified.replace(
    /(import\s*\(\s*["'])(\.\.?\/[^"']+?)(\.js)(["']\s*\))/g,
    (match, prefix, importPath, ext, suffix) => {
      const resolvedDir = resolve(fileDir, importPath);
      if (existsSync(resolvedDir) && statSync(resolvedDir).isDirectory()) {
        if (existsSync(join(resolvedDir, 'index.ts'))) {
          return `${prefix}${importPath}/index.js${suffix}`;
        }
      }
      return match;
    }
  );

  return modified;
}

const files = getAllTsFiles(SRC_DIR);
let count = 0;

for (const file of files) {
  const content = readFileSync(file, 'utf-8');
  const fixed = fixBarrelImports(file, content);
  if (fixed !== content) {
    writeFileSync(file, fixed, 'utf-8');
    const rel = file.replace(SRC_DIR, 'src').replace(/\\/g, '/');
    const log = `Fixed: ${rel}`;
    writeFileSync('fix-barrel-log.txt', log + '\n', { flag: 'a' });
    count++;
  }
}

writeFileSync('fix-barrel-log.txt', `\nDone! Fixed ${count} files.\n`, { flag: 'a' });
