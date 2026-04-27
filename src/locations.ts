import { Asset } from './types.ts';
import { type Feature } from "geojson";
import { registriesToRegcode } from "./utils";
import { DEFAULT_LANGUAGE } from "./config";
import { IndexEntry } from "./types";
import * as pagefind from "pagefind";
import { safeJsonParse } from './safe-utils';
import { assetFunctions } from "./assets";

/** Strip undefined values from an object (flatgeobuf can't serialize undefined) */
function stripUndefined<T extends Record<string, unknown>>(obj: T): T {
    return Object.fromEntries(
        Object.entries(obj).filter(([_, v]) => v !== undefined)
    ) as T;
}


export async function getLocations(index: pagefind.PagefindIndex, assetMetadata: Asset[], includePrivate: boolean=false): Promise<[IndexEntry, Feature][]> {
    const catalogue = await index.getIndexCatalogue();
    if (!catalogue.entries) {
        throw Error((catalogue as any).errors || "No entries in catalogue");
    }
    const hashes = catalogue.entries.reduce((agg: {[key: string]: string}, [hash, entry]: [string, string]) => {
        const entryData = safeJsonParse<{ meta?: { slug?: string } }>(entry, `pagefind entry with hash ${hash}`);
        const slug = entryData.meta?.slug;
        if (slug) {
            agg[slug] = hash;
        }
        return agg
    }, {});
    await assetFunctions.initialize();
    const publicModels = assetFunctions.getPermittedModels()
    return (await Promise.all(assetMetadata.map(async (asset: Asset) => {
        /// RMV
        if (asset.meta && asset.meta.location && (includePrivate || publicModels.includes(asset.type))) {
            {
                const loc = safeJsonParse(asset.meta.location, `asset ${asset.slug} location`);

                // TODO: find a less application-tied way to configure these
                const registries = asset.meta.registries ? safeJsonParse<string[]>(asset.meta.registries, `asset ${asset.slug} registries`) : [];
                const designations = asset.meta.designations ? safeJsonParse<string[]>(asset.meta.designations, `asset ${asset.slug} designations`) : [];
                const category: string | undefined = asset.meta.Category ? safeJsonParse<string[]>(asset.meta.Category, `asset ${asset.slug} categories`)[0] : undefined;
                const regcode = registriesToRegcode(registries);

                const language = DEFAULT_LANGUAGE ?? "en";
                const hash = hashes[asset.meta.slug];
                if (!hash) {
                    console.warn(`Asset ${asset.meta.slug} not found in pagefind index, skipping location`);
                    return undefined;
                }
                if (Array.isArray(loc) && loc.length >= 2
                    && Number.isFinite(loc[0]) && Number.isFinite(loc[1])) {
                  // Build properties, excluding undefined values (flatgeobuf can't serialize undefined)
                  const properties: Record<string, unknown> = {
                        url: `/asset/?slug=${asset.meta.slug}`,
                        // Only taking a bit of the plaintext for now... RMV
                        content: asset.content ?? null,
                        language: language,
                        regcode: regcode,
                        filters: {
                            tags: registries,
                            designations: designations
                        },
                        meta: stripUndefined(asset.meta ?? {})
                  };
                  // Only include category if defined
                  if (category !== undefined) {
                      properties.category = category;
                  }
                  const feature: Feature = {
                    id: hash,
                    type: 'Feature',
                    properties,
                    geometry: {
                        type: 'Point',
                        coordinates: loc
                    }
                  };
                  const pair: [IndexEntry, Feature] = [
                      new IndexEntry(
                          loc,
                          hash,
                          regcode
                      ),
                      feature
                  ];
                  return pair;
                }
            }
                // Ignore badly formed locations
        }
    }))).filter(asset => asset !== undefined);
};
