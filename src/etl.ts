import * as path from 'path';
import * as fs from "fs";
import { type Feature, type FeatureCollection, type Point } from 'geojson';
import { serialize as fgbSerialize } from 'flatgeobuf/lib/mjs/geojson.js';

import { staticTypes, interfaces, client, RDM, graphManager, staticStore, viewModels } from 'alizarin';

import { Asset } from './types.ts';
import { slugify } from './utils.ts';
import { assetFunctions } from './assets';
import { safeJsonParse, safeJsonParseFile, safeJoinPath } from './safe-utils';
import type { GraphConfiguration } from './types';

const PUBLIC_FOLDER = 'docs';

/**
 * Initialize asset functions and validate configuration
 */
async function ensureAssetFunctionsInitialized(): Promise<GraphConfiguration> {
  if (!assetFunctions.config || !assetFunctions.graphs) {
    await assetFunctions.initialize();
  }

  if (!assetFunctions.graphs) {
    throw Error("You need to set up prebuild/graphs.json first");
  }
  if (!assetFunctions.config) {
    throw Error("You need to set up prebuild/prebuild.json first");
  }

  if (assetFunctions.config.customDatatypes) {
    for (const [datatype, substitute] of Object.entries(assetFunctions.config.customDatatypes)) {
      viewModels.CUSTOM_DATATYPES.set(datatype, substitute);
    }
  }

  return assetFunctions.graphs;
}

function initAlizarin(resourcesFiles: string[] | null, modelFiles: GraphConfiguration['models']) {
    const archesClient = new client.ArchesClientLocal({
        allGraphFile: (() => "prebuild/graphs.json"),
        graphIdToGraphFile: ((graphId: string) => modelFiles[graphId] && `prebuild/graphs/resource_models/${modelFiles[graphId].name}`),
        graphToGraphFile: ((graph: staticTypes.StaticGraphMeta) => graph.name && `prebuild/graphs/resource_models/${graph.name}.json`),
        graphIdToResourcesFiles: ((graphId: string) => {
          // If this is not a heritage, or we have been given no specific files, get the whole resource model.
          let files: string[] = [];
          if ((graphId !== '076f9381-7b00-11e9-8d6b-80000b44d1d9' && graphId !== '49bac32e-5464-11e9-a6e2-000d3ab1e588') || resourcesFiles === null) {
            files = [...files, ...Object.values(modelFiles[graphId].resources).map((resourceFile: string) => `prebuild/business_data/${resourceFile}`)];
          }
          if (resourcesFiles !== null) {
            files = [...files, ...resourcesFiles];
          }
          return files;
        }),
        // resourceIdToFile: ((resourceId: string) => `public/resources/${resourceId}.json`),
        // RMV TODO: move collections and graphs to static
        collectionIdToFile: ((collectionId: string) => `prebuild/reference_data/collections/${collectionId}.json`)
    });
    archesClient.fs = fs;
    graphManager.archesClient = archesClient;
    staticStore.archesClient = archesClient;
    staticStore.cacheMetadataOnly = false;
    RDM.archesClient = archesClient;
    return graphManager;
}

let warned = false;
async function processAsset(assetPromise: Promise<viewModels.ResourceInstanceViewModel>, resourcePrefix: string | undefined, includePrivate: boolean=false): Promise<Asset | null> {
  const asset = await assetPromise;
  if (asset.__.wkrm.modelClassName !== "HeritageAsset") {
    if (!warned) {
      console.warn("No soft deletion, assuming all present", asset.__.wkrm.modelClassName)
    }
    warned = true;
  } else {
    const sd = await asset.soft_deleted;
    if (sd) {
      return null;
    }
  }
  // TODO: there is an issue where if the awaits do not happen in sequence, the same tile will appear multiple times in a pseudo-list
  // const names = [
  //   [await asset.monument_names[0].monument_name, (await asset.monument_names[0]).__parentPseudo.tile.sortorder],
  //   [await asset.monument_names[1].monument_name, (await asset.monument_names[1]).__parentPseudo.tile.sortorder],
  // ].sort((a, b) => b[1] - a[1]).map(a => a[0]);
  console.log(400);
  const staticAsset = await asset.forJson(true);
  const meta = await assetFunctions.getMeta(asset, staticAsset.root, resourcePrefix, includePrivate);
  const replacer = function (_: string, value: any) {
    if (value instanceof Map) {
      const result = Object.fromEntries(value);
      return result;
    } else if (value && typeof value === 'object' && value.__wbg_ptr) {
      const v = value.toJSON();
      return v;
    }
    return value;
  }

  await fs.promises.mkdir(`${PUBLIC_FOLDER}/definitions/business_data`, {"recursive": true});
  const resource = asset.$.resource;
  const cache = await asset.$.getValueCache(true, async (value: interfaces.IViewModel) => {
    if (value instanceof viewModels.ResourceInstanceViewModel) {
      const meta = await assetFunctions.getMeta(await value, await value, undefined, includePrivate);
      return {
        title: meta.meta.title,
        slug: meta.meta.slug,
        location: meta.meta.location,
        type: meta.type,
      };
    }
  });
  if (cache && Object.values(cache).length > 0) {
    resource.__cache = cache;
  }
  resource.__scopes = safeJsonParse(meta.meta.scopes, 'resource scopes');
  resource.metadata = meta.meta;
  const serial = JSON.stringify(resource, replacer, 2)
  const businessDataDir = `${PUBLIC_FOLDER}/definitions/business_data`;
  const safeFilePath = safeJoinPath(businessDataDir, `${meta.slug}.json`);
  await fs.promises.writeFile(safeFilePath, serial);

  return meta;
}

function extractFeatures(geoJsonString: string): Feature[] {
  const geoJson = safeJsonParse(geoJsonString, 'GeoJSON string');
  if (geoJson["type"] === "FeatureCollection") {
    const features = geoJson["features"].filter(feat => feat);
    return features;
  }
  const feature: Feature = {
    type: geoJson["type"],
    geometry: geoJson["geometry"],
    properties: geoJson["properties"],
  };
  if (!feature.geometry) {
    return [];
  }
  return [feature];
}

async function buildPreindex(graphManager: any, resourceFile: string | null, resourcePrefix: string | undefined, includePrivate: boolean=false) {
    await graphManager.initialize();
    const Registry = await graphManager.get("Registry");
    await Registry.all();
    console.log("loading for preindex", resourceFile);
    if (includePrivate) {
      console.warn("Building for NON-PUBLIC assets");
    }
    const assets = await assetFunctions.getAllFrom(graphManager, resourceFile, includePrivate);
    console.log("loaded", assets.length);
    let n = 25;
    const batches = assets.length / n;
    const assetMetadata = [];
    const assocMetadata = [];
    const registries: {[key: string]: [number, number][]} = {};
    for (let b = 0 ; b < batches ; b++) {
      if (b % 5 == 0) {
        console.log(b, ": completed", b * n, "records,", Math.floor(b * n * 100 / assets.length), "%");
      }

      let assetBatch: Asset[] = (await Promise.all(assets.slice(b * n, (b + 1) * n).map(asset => processAsset(asset, resourcePrefix)))).filter(asset => asset !== null);

      function addFeatures(asset: Asset) {
        const assetRegistries = safeJsonParse<string[]>(asset.meta.registries, `asset ${asset.slug} registries`);
        assetRegistries.forEach((reg: string) => {
          if (asset.meta.location) {
            if (!registries[reg]) {
              registries[reg] = [];
            }
            const location = safeJsonParse(asset.meta.location, `asset ${asset.slug} location`);
            registries[reg].push(location);
          }
        });
      }
      assetBatch.map((asset: Asset) => asset.meta && asset.meta.geometry ? addFeatures(asset) : null)
      assocMetadata.push(...assetBatch.filter(asset => !assetFunctions.shouldIndex(asset, includePrivate)));
      assetBatch = assetBatch.filter(asset => assetFunctions.shouldIndex(asset, includePrivate));
      assetMetadata.push(...assetBatch);
    }

    let preindexFile: string;
    let fgbFile: string;
    let assocFile: string;
    // let fgbFile: string;
    await fs.promises.mkdir('prebuild/fgb', {"recursive": true});
    await fs.promises.mkdir('prebuild/preindex', {"recursive": true});
    if (resourceFile) {
      preindexFile = `prebuild/preindex/${path.basename(resourceFile)}.pi`;
      assocFile = `prebuild/preindex/${path.basename(resourceFile)}.pi.assoc`;
      fgbFile = `prebuild/fgb/REGISTER---${path.basename(resourceFile, '.json')}.json`;
    } else {
      preindexFile = `prebuild/preindex/ix.pi`;
      assocFile = `prebuild/preindex/ix.pi.assoc`;
      fgbFile = `prebuild/preindex/REGISTER---ix.json`;
    }

    const promises = [];
    if (assetMetadata.length) {
      promises.push(
        fs.promises.writeFile(preindexFile, JSON.stringify(assetMetadata, null, 2)),
      );
      for (const [registry, points] of Object.entries(registries)) {
        if (points.length > 0) {
          promises.push(fs.promises.writeFile(
            fgbFile.replace('REGISTER', slugify(registry)), JSON.stringify(points)
          ));
        }
      }
    }
    if (assocMetadata.length) {
      promises.push(
        fs.promises.writeFile(assocFile, JSON.stringify(assocMetadata, null, 2)),
      );
    }
    return Promise.all(promises);
}

async function buildOnePreindex(resourceFile: string, additionalFiles: string[], resourcePrefix: string, includePrivate: boolean=false) {
  const graphs = await ensureAssetFunctionsInitialized();

  let resourceFiles = [];
  if (resourceFile.indexOf('%') !== -1) {
    let i = 0;
    let filename;
    let complete = false;
    while (!complete) {
      filename = resourceFile.replace('%', `${i}`);
      try {
        await fs.promises.access(filename)
        resourceFiles.push(filename);
      } catch {
        complete = true;
      }
      i += 1;
    }
  } else {
    resourceFiles = [resourceFile];
  }
  resourceFiles = [...resourceFiles, ...additionalFiles];
  console.log("Resource files:", resourceFiles);
  const gm = await initAlizarin(resourceFile ? resourceFiles : null, graphs.models);
  await buildPreindex(gm, resourceFile || null, resourcePrefix, includePrivate);
}

export async function etl(resourceFile: string, resourcePrefix: string | undefined, includePrivate: boolean=false) {
  if (resourceFile) {
    const additionalFiles: string[] = [];
    // RMV FIXME
    // let next = false;
    // for (const arg of process.argv) {
    //   if (next) {
    //     additionalFiles.push(arg);
    //     next = false;
    //   }
    //   if (arg === '-a') {
    //     next = true;
    //   }
    // }
    if (!resourceFile.endsWith('.json')) {
      console.error(`Tried to run with a non .json file: ${resourceFile}`);
      process.exit(1);
    }
    console.log("Pre-indexing", resourceFile);
    await buildOnePreindex(resourceFile, additionalFiles, resourcePrefix);
  } else {
    const prebuildList: any[] = await safeJsonParseFile('prebuild/prebuild.json');
    for (const prebuildItem of prebuildList) {
      if (includePrivate || prebuildItem.public) {
        await buildOnePreindex(prebuildItem.resources, prebuildItem.supplementary || [], prebuildItem.slugPrefix, includePrivate);
      }
    }
  }
}
