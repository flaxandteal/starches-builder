#!/usr/bin/env node

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const VENDOR_DIR = join(__dirname, '..', 'vendor');
const BIN_DIR = join(VENDOR_DIR, 'bin');
const binaryName = process.platform === 'win32' ? 'pagefind_extended.exe' : 'pagefind_extended';
const binaryPath = join(BIN_DIR, binaryName);

// Set environment variable if not already set
if (!process.env.PAGEFIND_EXTENDED_BINARY_PATH) {
  process.env.PAGEFIND_EXTENDED_BINARY_PATH = binaryPath;
}

export const PAGEFIND_BINARY_PATH = binaryPath;
