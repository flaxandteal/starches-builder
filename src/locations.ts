import { Asset } from './types.ts';
import { type FeatureCollection, type Feature } from "geojson";
import { registriesToRegcode, DEFAULT_LANGUAGE, PUBLIC_MODELS } from "./utils";
import { IndexEntry } from "./types";
import * as pagefind from "pagefind";


export async function getLocations(index: pagefind.PagefindIndex, assetMetadata: Asset[], includePrivate: boolean=false): Promise<[IndexEntry, Feature][]> {
    const catalogue = await index.getIndexCatalogue();
    if (!catalogue.entries) {
        throw Error(catalogue.errors);
    }
    const hashes = catalogue.entries.reduce((agg: {[key: string]: string}, [hash, entry]: [string, string]) => {
        const slug = JSON.parse(entry).meta.slug;
        if (slug) {
            agg[slug] = hash;
        }
        return agg
    }, {});
    return (await Promise.all(assetMetadata.map(async (asset: Asset) => {
        /// RMV
        if (asset.meta && asset.meta.location && (includePrivate || PUBLIC_MODELS.includes(asset.type))) {
            {
                const loc = JSON.parse(asset.meta.location);
                const registries = asset.meta.registries ? JSON.parse(asset.meta.registries) : [];
                console.log('registries', registries);
                const designations = asset.meta.designations ? JSON.parse(asset.meta.designations) : [];
                const regcode = registriesToRegcode(registries);
                const language = DEFAULT_LANGUAGE ?? "en";
                const hash = hashes[asset.meta.slug];
                if (Array.isArray(loc)) {
                  const feature: Feature = {
                    id: hash,
                    type: 'Feature',
                    properties: {
                        url: `/asset/?slug=${asset.meta.slug}`,
                        // Only taking a bit of the plaintext for now... RMV
                        content: asset.content,
                        language: language,
                        regcode: regcode,
                        filters: {
                            tags: registries,
                            designations: designations
                        },
                        meta: asset.meta
                    },
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
