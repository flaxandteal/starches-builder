import { dirname } from 'path';
import { fileURLToPath } from 'url';

export const REGISTRIES: string[] = [];

// NOTE: These constants are now in config.ts - kept here for backward compatibility
// Will be removed in next major version
export const FOR_ARCHES: boolean = false;
export const CHUNK_SIZE_CHARS = 10000000;
export const PUBLIC_MODELS: string[] = ["HeritageAsset", "Registry"];
export const DEFAULT_LANGUAGE = "en";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
export const STARCHES_UTILS_BIN = `${SCRIPT_DIR}/../starches-rs`;

/**
 * @deprecated Use slugify from safe-utils.ts instead
 * Kept for backward compatibility only
 */
export function slugify(name: string) {
  // Safer implementation with better character handling
  if (!name || typeof name !== 'string') {
    throw new Error(`Invalid slug input: ${name}`);
  }

  return name
    .toLowerCase()
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 20);
}

export function registriesToRegcode(registries: string[]) {
    return registries.map((r: string) => REGISTRIES.indexOf(slugify(r))).reduce((acc: number, n: number) => {
        if (n >= 0) {
            acc += 2**n;
        }
        return acc;
    }, 0);
}

export async function getValueFromPath(asset: any, path: string): Promise<any> {
    const segments = path.split(".");
    async function get(value: any, key: string) {
        if (value.__has) {
            if (!await value.__has(key)) {
                return undefined;
            }
            return value[key];
        }
        return value[key];
    }
    if (segments[0] == "") {
        // If it starts with a dot
        segments.shift();
    }
    let headValue = asset;
    let segment: string | undefined = segments.shift();
    while (segment !== undefined && headValue) {
        // TODO: this is only necessary to await at every step because we do not know whether the key is valid
        headValue = await get(headValue, segment);
        segment = segments.shift();
    }
    return segments.length ? undefined : headValue;
}
