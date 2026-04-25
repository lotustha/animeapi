import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Load .env manually (no extra dependency needed)
const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '.env');
try {
  const envContent = readFileSync(envPath, 'utf-8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1);
    const commentIndex = value.indexOf('#');
    if (commentIndex !== -1) {
      value = value.slice(0, commentIndex);
    }
    value = value.trim().replace(/^["']|["']$/g, '');
    
    if (!process.env[key]) process.env[key] = value;
  }
  console.log('✅ Loaded .env file');
} catch (err) {
  console.warn('⚠️  No .env file found, using system environment variables');
}

// Force production mode
process.env.NODE_ENV = process.env.NODE_ENV || 'production';

console.log(`🚀 Starting Cooren API (Node.js ${process.version})...`);

// Import and start the compiled application
try {
  await import('./dist/src/index.js');
} catch (err) {
  console.log('⚠️ Failed to load ./dist/src/index.js, falling back to ./dist/index.js');
  try {
    await import('./dist/index.js');
  } catch (err2) {
    console.error('❌ Failed to start:', err2);
    process.exit(1);
  }
}