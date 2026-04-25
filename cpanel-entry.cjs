// CommonJS wrapper for cPanel's LiteSpeed Node.js runner (lsnode.js)
// lsnode.js uses require() to load this file, so it MUST be CommonJS.
// We use dynamic import() to load the actual ESM application.

const { readFileSync } = require('node:fs');
const { resolve, dirname } = require('node:path');

// Load .env manually
const envPath = resolve(__dirname, '.env');
try {
  const envContent = readFileSync(envPath, 'utf-8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    // Handle quoted values properly (don't strip # inside quotes)
    let rawValue = trimmed.slice(eqIndex + 1);
    let value;
    // Check if value starts with a quote
    const trimmedVal = rawValue.trimStart();
    if (trimmedVal.startsWith('"') || trimmedVal.startsWith("'")) {
      const quote = trimmedVal[0];
      const endQuote = trimmedVal.indexOf(quote, 1);
      if (endQuote !== -1) {
        value = trimmedVal.slice(1, endQuote);
      } else {
        value = trimmedVal.slice(1);
      }
    } else {
      // Unquoted: strip inline comments
      const commentIndex = rawValue.indexOf(' #');
      if (commentIndex !== -1) {
        rawValue = rawValue.slice(0, commentIndex);
      }
      value = rawValue.trim();
    }

    if (!process.env[key]) process.env[key] = value;
  }
  console.log('✅ Loaded .env file');
} catch (err) {
  console.warn('⚠️  No .env file found, using system environment variables');
}

process.env.NODE_ENV = process.env.NODE_ENV || 'production';

console.log(`🚀 Starting Cooren API (Node.js ${process.version})...`);

// Dynamic import() works with ESM modules from CommonJS
import('./dist/src/index.js').catch((err) => {
  console.error('❌ Failed to start:', err);
  process.exit(1);
});
