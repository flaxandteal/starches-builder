#!/usr/bin/env node

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const VENDOR_DIR = join(__dirname, '..', 'vendor');
const BIN_DIR = join(VENDOR_DIR, 'bin');
const binaryName = process.platform === 'win32' ? 'pagefind_extended.exe' : 'pagefind_extended';
const binaryPath = join(BIN_DIR, binaryName);

// Only set if not already set and binary exists
if (!process.env.PAGEFIND_EXTENDED_BINARY_PATH && existsSync(binaryPath)) {
  process.env.PAGEFIND_EXTENDED_BINARY_PATH = binaryPath;
  console.log(`✓ Using custom pagefind binary at ${binaryPath}`);
}
