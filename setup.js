#!/usr/bin/env node

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function run(command, options = {}) {
  execSync(command, {
	cwd: __dirname,
	stdio: 'inherit',
	env: process.env,
	...options,
  });
}

console.log('📦  Installing dependencies...');
run('npm install');

// Ensure the CLI entry remains executable for direct invocation on Unix-like systems.
try {
  const cliPath = path.join(__dirname, 'src', 'index.js');
  const stats = fs.statSync(cliPath);
  fs.chmodSync(cliPath, stats.mode | 0o111);
} catch (_) {
  // Non-fatal: Node can still execute the CLI via `node src/index.js` or `npm start`.
}

console.log('');
console.log('✅  Setup complete!');
console.log('');
console.log('Usage:');
console.log('  node src/index.js');
console.log('');
console.log('Or run via npm:');
console.log('  npm start');
console.log('  npm run setup');
console.log('');
console.log('Or link globally with:');
console.log('  npm link');
console.log('  pnpm-git-changes');


