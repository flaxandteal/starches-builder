import { dirname } from 'path';
import { fileURLToPath } from 'url';

export const REGISTRIES: string[] = [];

export const FOR_ARCHES: string[] = [];

export const CHUNK_SIZE_CHARS = 10000000;

export const PUBLIC_MODELS: string[] = ["Asset"];

export const DEFAULT_LANGUAGE = "en"; // FIXME

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
export const STARCHES_UTILS_BIN = `${SCRIPT_DIR}/../starches-rs`;

export function slugify(name: string) {
  // TODO: proper slugify
  return `${name}`.replaceAll(/[^A-Za-z0-9_]/g, "").slice(0, 20);
}

export function registriesToRegcode(registries: string[]) {
    return registries.map((r: string) => REGISTRIES.indexOf(slugify(r))).reduce((acc: number, n: number) => {
        if (n >= 0) {
            acc += 2**n;
        }
        return acc;
    }, 0);
}

