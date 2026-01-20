import * as path from 'path';
import * as fs from "fs";
import * as Handlebars from 'handlebars';
import { dirname } from 'path';
import { fileURLToPath } from 'url';
import { validatePathWithinBase } from './safe-utils';

export const REGISTRIES: string[] = [];

// NOTE: These constants are now in config.ts - kept here for backward compatibility
// Will be removed in next major version
export const FOR_ARCHES: boolean = false;
export const CHUNK_SIZE_CHARS = 10000000;
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
  let segments = path.split(".");
  async function get(value: any, key: string): Promise<any> {
    if (Array.isArray(value)) {
      const results = await Promise.all(value.map(async (item) => {
        const value = await item;
        if (value === undefined) {
          return value;
        }
        return get(value, key);
      }));
      return results.flat();
    }
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
  const results: any[] = [];
  let multi: boolean = false;
  async function descend(headValue: any, segments: string[]) {
    let segment: string | undefined = segments.shift();
    while (segment !== undefined && headValue) {
      // TODO: this is only necessary to await at every step because we do not know whether the key is valid
      if (segment === "*") {
        multi = true;
        return (await Promise.all(headValue.map(async (headSubvalue: any) => {
          // const value = await headSubvalue;
          // console.log(value, segments, value.constructor.name);
          return descend(await headSubvalue, [...segments]);
        }))).flat();
      } else {
        headValue = await get(await headValue, segment);
      }
      segment = segments.shift();
    }
    if (headValue !== undefined) {
      results.push(headValue);
    }
    return segments;
  }
  segments = await descend(asset, segments);
  return segments.length ? undefined : (multi ? results : results[0]);
}

// Handlebars setup
export function registerHandlebarsHelpers(): void {
  Handlebars.registerHelper("replace", (base, fm, to) => base ? base.replaceAll(fm, to) : base);
  Handlebars.registerHelper("nl", (base, nl) => base ? base.replaceAll("\n", nl) : base);
  Handlebars.registerHelper("plus", (a, b) => a + b);
  Handlebars.registerHelper("default", (a, b) => a === undefined || a === null ? b : a);
  Handlebars.registerHelper("defaulty", (a, b) => a != undefined && a != null && a != false ? a : b);
  Handlebars.registerHelper("equal", (a, b) => a == b);
  Handlebars.registerHelper("or", (a, b) => a || b);
  Handlebars.registerHelper("join", (...args) => {
    if (args.length == 3 && Array.isArray(args[0])) {
      return args.join(args[1]);
    }
    return args.slice(0, args.length - 2).join(args[args.length - 2]);
  });
  Handlebars.registerHelper("and", (a, b) => a && b);
  Handlebars.registerHelper("not", (a, b) => a != b);
  Handlebars.registerHelper("in", (a, b) => Array.isArray(b) ? b.includes(a) : (a in b));
  Handlebars.registerHelper("nospace", (a) => a.replaceAll(" ", "%20"));
  Handlebars.registerHelper("escapeExpression", (a) => Handlebars.Utils.escapeExpression(a));
  Handlebars.registerHelper("clean", (a) => {
    // TODO
    // if (a instanceof renderers.Cleanable) {
    //   return a.__clean;
    // }
    return a;
  });
  Handlebars.registerHelper("concat", (...args) => args.slice(0, args.length - 1).join(""));
  Handlebars.registerHelper("array", (...args) => args);
  Handlebars.registerHelper("dialogLink", (options) => {
    return new Handlebars.SafeString(
      `<button class="govuk-button dialog-link" data-dialog-id="${options.hash.id}">Show</button>`
    );
  });
}
