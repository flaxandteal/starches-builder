import { dirname } from 'path';
import { fileURLToPath } from 'url';

export const REGISTRIES: string[] = [];

export const FOR_ARCHES: boolean = false;

export const CHUNK_SIZE_CHARS = 10000000;

export const PUBLIC_MODELS: string[] = ["HeritageAsset", "Registry"];

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

export async function getValueFromPath(asset: any, path: string): Promise<any> {
    const segments = path.split(".");
    async function get(value: any, key: string) {
        if (!value.__has) {
            if (!value.__has(key)) {
                return undefined;
            }
            return value[key];
        }
        return value[key];
    }
    if (!segments[0]) {
        // If it starts with a dot
        segments.pop();
    }
    let headValue = asset;
    let segment: string | undefined = segments[0];
    while (segment) {
        // TODO: this is only necessary to await at every step because we do not know whether the key is valid
        headValue = await get(asset, segment);
        segment = segments.pop();
    }
    return headValue;
}
