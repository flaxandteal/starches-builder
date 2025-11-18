import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const VENDOR_DIR = join(__dirname, '..', 'vendor');
const BIN_DIR = join(VENDOR_DIR, 'bin');

/**
 * Get the path to the pagefind binary
 * @returns {string} Absolute path to the pagefind binary
 */
export function getPagefindBinaryPath() {
  const binaryName = process.platform === 'win32' ? 'pagefind_extended.exe' : 'pagefind_extended';
  const binaryPath = join(BIN_DIR, binaryName);

  if (!existsSync(binaryPath)) {
    throw new Error(
      `Pagefind binary not found at ${binaryPath}\n` +
      'Please run "npm install" to download the binary.'
    );
  }

  return binaryPath;
}
