import * as path from 'path';
import * as fs from "fs";
import { type Feature, type FeatureCollection, type Point } from 'geojson';
import { serialize as fgbSerialize } from 'flatgeobuf/lib/mjs/geojson.js';

import { version, slugify, staticTypes, interfaces, client, RDM, graphManager, staticStore, viewModels, resetTimingStats, logTimingStats, tracing } from 'alizarin';

// Set up tracing
const tracer = tracing.getTracer('starches-builder', version);
// Per-batch summary (reset each batch)
const batchSummaryExporter = new tracing.SummaryExporter();
// Global summary (accumulates across entire run)
const globalSummaryExporter = new tracing.SummaryExporter();
tracing.addGlobalExporter(batchSummaryExporter.export);
tracing.addGlobalExporter(globalSummaryExporter.export);

import { Asset } from './types.ts';
import { getFilesForRegex } from './utils.ts';
import { assetFunctions } from './assets';
import { safeJsonParse, safeJsonParseFile, safeJoinPath } from './safe-utils';
import type { GraphConfiguration, PrebuildSource } from './types';
import { getProgressDisplay, enableProgress } from './progress.ts';

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

async function initAlizarin(resourcesFiles: string[] | null, modelFiles: GraphConfiguration['models']) {
    const archesClient = new client.ArchesClientLocal({
        allGraphFile: (() => "prebuild/graphs.json"),
        graphIdToGraphFile: ((graphId: string) => modelFiles?.[graphId] && `prebuild/graphs/resource_models/${modelFiles[graphId].name}`),
        graphToGraphFile: ((graph: staticTypes.StaticGraphMeta) => graph.name && `prebuild/graphs/resource_models/${graph.name}.json`),
        graphIdToResourcesFiles: (async function* (graphId: string) {
          const sources = assetFunctions.config?.sources;
          if (sources) {
            for (const source of sources) {
              if (source.searchFor && source.searchFor.includes(graphId)) {
                for await (const match of await getFilesForRegex("prebuild/business_data", source.resources)) {
                  yield match;
                }
              }
            }
          }
          if (resourcesFiles) {
            for (const r of resourcesFiles) {
              yield r;
            }
          }
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
  return tracer.startActiveSpan('processAsset', async (span) => {
    const asset = await assetPromise;
    span.setAttribute('asset.id', asset.id || 'unknown');

    if (asset.__.wkrm.modelClassName !== "HeritageAsset") {
      if (!warned) {
        console.warn("No soft deletion, assuming all present", asset.__.wkrm.modelClassName)
      }
      warned = true;
    } else {
      const sd = await asset.soft_deleted;
      if (sd) {
        span.setAttribute('asset.soft_deleted', true);
        return null;
      }
    }

    const staticAsset = await tracer.startActiveSpan('forJson', async () => {
      return await asset.forJson(true);
    });

    const meta = await tracer.startActiveSpan('getMeta', async () => {
      return await assetFunctions.getMeta(asset, staticAsset.root, resourcePrefix, includePrivate);
    });

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

    const cache = await tracer.startActiveSpan('getValueCache', async () => {
      return await asset.$.getValueCache(true, async (value: interfaces.IViewModel) => {
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

    span.setAttribute('asset.slug', meta.slug);
    return meta;
  });
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

async function buildPreindex(graphManager: any, resourceFile: string | null, resourcePrefix: string | undefined, includePrivate: boolean=false, lazy: boolean=false) {
    await graphManager.initialize({ graphs: null, defaultAllowAllNodegroups: includePrivate });
    // Pass includePrivate to get() so the model is created with correct default permissions
    const Registry = await graphManager.get("Registry", includePrivate);
    await Registry.all();
    log("Loading for preindex: " + resourceFile);
    if (includePrivate) {
      log("Building for NON-PUBLIC assets");
    }
      log("A");
    const assets = await assetFunctions.getAllFrom(graphManager, resourceFile, includePrivate, lazy);
      log("B");
    log(`Loaded ${assets.length} assets`);
    console.log(`[DEBUG] About to setup batch processing for ${assets.length} assets`);
    // Batch size for parallel processing - RefCell fix allows concurrent async ops
    const n = 10;
    const batches = Math.ceil(assets.length / n);
    console.log(`[DEBUG] Will process ${batches} batches of size ${n}`);
    const assetMetadata = [];
    const assocMetadata = [];
    const registries: {[key: string]: [number, number][]} = {};
    console.log(`[DEBUG] Starting batch loop`);
    for (let b = 0 ; b < batches ; b++) {
      console.log(`[batch] Starting batch ${b}/${batches}, processing assets ${b * n} to ${Math.min((b + 1) * n, assets.length)}`);
      progress('batch-processing', 'Processing assets', b * n, assets.length);

      // Reset both legacy and new timing stats for this batch
      resetTimingStats();
      batchSummaryExporter.reset();

      const batchAssets = assets.slice(b * n, (b + 1) * n);
      console.log(`[batch] Batch has ${batchAssets.length} assets, calling Promise.all...`);

      let assetBatch: Asset[] = await tracer.startActiveSpan('processBatch', { 'batch.index': b, 'batch.size': batchAssets.length }, async (batchSpan) => {
        const results = await Promise.all(batchAssets.map(asset => processAsset(asset, resourcePrefix, includePrivate)));
        return results.filter(asset => asset !== null);
      });

      console.log(`[batch] Batch ${b} completed, got ${assetBatch.length} non-null results`);

      // Flush and print timing summary for this batch
      tracing.flushAll();
      batchSummaryExporter.printSummary(`batch ${b}`);
      logTimingStats(`batch ${b} (legacy)`);

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
      console.log('mark');
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

async function buildOnePreindex(resourceFile: string, resourcePrefix: string, includePrivate: boolean=false, lazy: boolean=false) {
  const graphs = await ensureAssetFunctionsInitialized();

  let resourceFiles = [];
  resourceFile = path.normalize(resourceFile);
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
  console.log("Resource files:", resourceFiles);
  const sources = assetFunctions.config?.sources;
  let resourceSource: PrebuildSource | undefined;
  if (sources) {
    for (const source of sources) {
      if (resourceFile.match(source.resources)) {
        if (resourceSource) {
          console.warn("Resource file matches multiple sources:", resourceSource.resources, source.resources, "<- taking the first");
          continue;
        }
        console.log("Found matching source in prebuild.json:", source.resources);
        resourceSource = source;
        if (source.dependencies) {
          for (const dependency of source.dependencies) {
            for await (const match of await getFilesForRegex("prebuild/business_data", dependency)) {
              console.log("Dependency added:", match);
              resourceFiles.push(match);
            }
          }
        }
      }
    }
  }
  const gm = await initAlizarin(resourceFile ? resourceFiles : null, graphs.models || {});
  await buildPreindex(gm, resourceFile || null, resourcePrefix, includePrivate, lazy);
}

// Helper to log to either progress display or console
function log(message: string) {
  const display = getProgressDisplay();
  display.log(message);
}

// Helper to update progress
function progress(id: string, label: string, current: number, total: number) {
  const display = getProgressDisplay();
  display.progress(id, label, current, total);
}

export async function etl(resourceFile: string, resourcePrefix: string | undefined, includePrivate: boolean=false, useTui: boolean=false, lazy: boolean=false, showSummary: boolean=false) {
  if (!resourceFile.endsWith('.json')) {
    console.error(`Tried to run with a non .json file: ${resourceFile}`);
    process.exit(1);
  }

  if (useTui) {
    enableProgress();
  }

  // Reset global summary at start of run
  globalSummaryExporter.reset();

  try {
    log("Pre-indexing " + resourceFile);
    await buildOnePreindex(resourceFile, resourcePrefix || "", includePrivate, lazy);

    if (useTui) {
      getProgressDisplay().finish();
    }

    // Print final summary if requested
    if (showSummary) {
      tracing.flushAll();
      // Collect Rust and alizarin JS timings into the summary
      tracing.collectAllTimings(globalSummaryExporter);
      console.log('\n');
      globalSummaryExporter.printSummary('FINAL - All Batches Combined');
    }
  } catch (error) {
    // Restore console if TUI was enabled
    if (useTui) {
      getProgressDisplay().cleanup();
    }
    throw error;
  }
}

// Export helpers for use in other modules
export { log, progress };
