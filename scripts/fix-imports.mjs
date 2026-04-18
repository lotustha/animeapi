/**
 * Script to add .js extensions to all relative imports in TypeScript files.
 * This is required for Node.js ESM compatibility (NodeNext module resolution).
 * 
 * Run with: node scripts/fix-imports.mjs
 */
import { readdir, readFile, writeFile } from 'fs/promises';
import { join, extname } from 'path';

const SRC_DIR = join(process.cwd(), 'src');

async function getAllTsFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await getAllTsFiles(fullPath));
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      files.push(fullPath);
    }
  }
  return files;
}

/**
 * Add .js extension to relative imports that don't already have one.
 * Handles:
 *   import X from "./foo"        → import X from "./foo.js"
 *   import { X } from "./foo"    → import { X } from "./foo.js"
 *   export { X } from "./foo"    → export { X } from "./foo.js"
 *   await import("./foo")        → await import("./foo.js")
 *   import("./foo")              → import("./foo.js")
 * 
 * Does NOT modify:
 *   import X from "package"      (npm packages)
 *   import X from "./foo.js"     (already has extension)
 */
function fixImports(content) {
  // Match static imports/exports: from "./path" or from '../path'
  let result = content.replace(
    /(from\s+["'])(\.\.?\/[^"']+)(["'])/g,
    (match, prefix, importPath, suffix) => {
      // Skip if already has an extension
      const ext = extname(importPath);
      if (ext && ext !== '') return match;
      return `${prefix}${importPath}.js${suffix}`;
    }
  );

  // Match dynamic imports: import("./path") or import('./path')
  result = result.replace(
    /(import\s*\(\s*["'])(\.\.?\/[^"']+)(["']\s*\))/g,
    (match, prefix, importPath, suffix) => {
      const ext = extname(importPath);
      if (ext && ext !== '') return match;
      return `${prefix}${importPath}.js${suffix}`;
    }
  );

  return result;
}

async function main() {
  const files = await getAllTsFiles(SRC_DIR);
  let modifiedCount = 0;

  for (const file of files) {
    const content = await readFile(file, 'utf-8');
    const fixed = fixImports(content);
    if (fixed !== content) {
      await writeFile(file, fixed, 'utf-8');
      const rel = file.replace(process.cwd() + '\\', '').replace(process.cwd() + '/', '');
      console.log(`✅ Fixed: ${rel}`);
      modifiedCount++;
    }
  }

  console.log(`\nDone! Modified ${modifiedCount} / ${files.length} files.`);
}

main().catch(console.error);
