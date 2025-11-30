import * as path from 'path';
import * as fs from "fs";
import { dirname } from 'path';
import { fileURLToPath } from 'url';
import { validatePathWithinBase } from './safe-utils';

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
 * Get all matching files for a relative regex.
 */
export async function *getFilesForRegex(dir: string, regex: string): AsyncGenerator<string> {
  if (!regex.startsWith(dir)) {
    console.warn(`The directory ${dir} does not appear to contain ${regex}`);
    return;
  }
  async function *walk(subdir: string): AsyncGenerator<string> {
    for await (const entry of await fs.promises.opendir(subdir)) {
      const entryname = path.join(subdir, entry.name);
      if (entry.isDirectory()) yield* walk(entryname);
      else if (entry.isFile() && entryname.match(regex)) {
        if (validatePathWithinBase(entryname, dir)) {
          console.debug("Found", entryname);
          yield entryname;
        } else {
          console.warn(`Found ${entryname} outside ${dir}, skipping`);
        }
      }
    }
  }
  yield* walk(dir);
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
