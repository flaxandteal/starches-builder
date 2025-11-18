#!/usr/bin/env node

import { createWriteStream, existsSync, mkdirSync, chmodSync } from 'fs';
import { mkdir, rm } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createGunzip } from 'zlib';
import { pipeline } from 'stream/promises';
import tarStream from 'tar-stream';
import { get as httpsGet } from 'https';

const { extract: tarExtract } = tarStream;

const __dirname = dirname(fileURLToPath(import.meta.url));
const VENDOR_DIR = join(__dirname, '..', 'vendor');
const BIN_DIR = join(VENDOR_DIR, 'bin');

// GitHub release configuration
const GITHUB_OWNER = process.env.PAGEFIND_GITHUB_OWNER || 'flaxandteal';
const GITHUB_REPO = process.env.PAGEFIND_GITHUB_REPO || 'pagefind';
const RELEASE_TAG = process.env.PAGEFIND_RELEASE_TAG || 'v1.3.0-map-compatibility.5'; // Update to match your release tag

/**
 * Detect the current platform and return the appropriate target triple
 */
function getPlatformTarget() {
  const platform = process.platform;
  const arch = process.arch;

  const targetMap = {
    'linux-x64': 'x86_64-unknown-linux-musl',
    'linux-arm64': 'aarch64-unknown-linux-musl',
    'darwin-x64': 'x86_64-apple-darwin',
    'darwin-arm64': 'aarch64-apple-darwin',
    'win32-x64': 'x86_64-pc-windows-msvc',
  };

  const key = `${platform}-${arch}`;
  const target = targetMap[key];

  if (!target) {
    throw new Error(
      `Unsupported platform: ${platform}-${arch}\n` +
      `Supported platforms: ${Object.keys(targetMap).join(', ')}`
    );
  }

  return target;
}

/**
 * Get the binary filename for the current platform
 */
function getBinaryName() {
  return process.platform === 'win32' ? 'pagefind_extended.exe' : 'pagefind_extended';
}

/**
 * Download a file from a URL
 */
function download(url) {
  return new Promise((resolve, reject) => {
    console.log(`Downloading from: ${url}`);

    const makeRequest = (requestUrl) => {
      httpsGet(requestUrl, (response) => {
        // Handle redirects
        if (response.statusCode === 302 || response.statusCode === 301) {
          const redirectUrl = response.headers.location;
          console.log(`Following redirect to: ${redirectUrl}`);
          return makeRequest(redirectUrl);
        }

        if (response.statusCode !== 200) {
          reject(new Error(`Download failed with status ${response.statusCode}: ${requestUrl}`));
          return;
        }

        resolve(response);
      }).on('error', reject);
    };

    makeRequest(url);
  });
}

/**
 * Extract a tar.gz stream
 */
async function extractTarGz(stream, targetDir) {
  const gunzip = createGunzip();
  const extract = tarExtract();

  extract.on('entry', (header, stream, next) => {
    const filepath = join(targetDir, header.name);

    if (header.type === 'file') {
      console.log(`Extracting: ${header.name}`);
      const dirPath = dirname(filepath);

      if (!existsSync(dirPath)) {
        mkdirSync(dirPath, { recursive: true });
      }

      const writeStream = createWriteStream(filepath);
      stream.pipe(writeStream);

      writeStream.on('finish', () => {
        // Make binary executable
        if (header.name.includes('pagefind')) {
          chmodSync(filepath, 0o755);
        }
        next();
      });

      writeStream.on('error', next);
    } else {
      stream.resume();
      next();
    }
  });

  await pipeline(stream, gunzip, extract);
}

/**
 * Main installation function
 */
async function install() {
  try {
    console.log('Installing pagefind binary from GitHub releases...');

    const target = getPlatformTarget();
    const binaryName = getBinaryName();
    const assetName = `pagefind_extended-${RELEASE_TAG}-${target}.tar.gz`;
    const downloadUrl = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/download/${RELEASE_TAG}/${assetName}`;

    // Clean and create vendor directory
    if (existsSync(VENDOR_DIR)) {
      await rm(VENDOR_DIR, { recursive: true, force: true });
    }
    await mkdir(BIN_DIR, { recursive: true });

    // Download and extract
    const response = await download(downloadUrl);
    await extractTarGz(response, BIN_DIR);

    const installedBinary = join(BIN_DIR, binaryName);
    if (!existsSync(installedBinary)) {
      throw new Error(`Binary not found after extraction: ${installedBinary}`);
    }

    console.log(`✓ Successfully installed pagefind to ${installedBinary}`);
  } catch (error) {
    console.error('Failed to install pagefind binary:');
    console.error(error.message);

    console.error('\nYou can manually download the binary from:');
    console.error(`https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases`);

    process.exit(1);
  }
}

install();
