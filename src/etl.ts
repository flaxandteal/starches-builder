import * as path from 'path';
import * as fs from "fs";
import { version, slugify, staticTypes, client, RDM, graphManager, staticStore, viewModels, tracing } from 'alizarin/inline';
// Import CLM to register display serializers for reference datatypes
import '@alizarin/clm';
import '@alizarin/filelist';

// Set up tracing
const tracer = tracing.getTracer('starches-builder', version);
// Global summary (accumulates across entire run)
const globalSummaryExporter = new tracing.SummaryExporter();
tracing.addGlobalExporter(globalSummaryExporter.export);

import { Asset } from './types.ts';
import { getFilesForRegex } from './utils.ts';
import { mapsToObjects } from './metadata-extractor.ts';

/**
 * Set tile data for a node via the instance wrapper.
 * Both WASM and NAPI wrappers now expose setTileDataForNode directly.
 * The wrapper's tile store is what getValuesAtPath / forJson read from,
 * so mutations must go through it (not the StaticResource, which holds
 * an independent clone in WASM mode).
 */
export function setTileDataForNode(resource: any, wasmWrapper: any, tileId: string, nodeId: string, value: any): boolean {
  if (typeof wasmWrapper.setTileDataForNode !== 'function') {
    throw new Error('setTileDataForNode not available on instance wrapper — is the backend module up to date?');
  }
  return wasmWrapper.setTileDataForNode(tileId, nodeId, value);
}
import { assetFunctions } from './assets';
import { safeJsonParse, safeJoinPath } from './safe-utils';
import { WarningCollector } from './warning-collector';
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
        graphToGraphFile: ((graph: staticTypes.StaticGraphMeta) => graph.name ? `prebuild/graphs/resource_models/${graph.name}.json` : ""),
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
        collectionIdToFile: ((collectionId: string) => `prebuild/reference_data/collections/${collectionId}.json`),
    });
    (archesClient as any).fs = fs;
    graphManager.archesClient = archesClient;
    staticStore.archesClient = archesClient;
    RDM.archesClient = archesClient;
    return graphManager;
}

let warned = false;
async function processAsset(assetPromise: Promise<viewModels.ResourceInstanceViewModel<any>>, resourcePrefix: string | undefined, includePrivate: boolean=false, minify: boolean=false): Promise<Asset | null> {
  return tracer.startActiveSpan('processAsset', async (span: any) => {
    // ViewModel internals (__.wkrm, $.resource, $.wasmWrapper) are dynamically
    // typed and not fully expressed in alizarin's strict TS declarations.
    const asset: any = await assetPromise;
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

    // Rewrite file URLs before forJson/getMeta so rewritten URLs propagate to thumbnails etc.
    const graphId = asset.__.wkrm.graphId;
    const modelType = asset.__.wkrm.modelClassName;
    const resource = asset.$.resource;
    const filesConfig = assetFunctions.getFilesConfig(graphId, modelType);
    if (filesConfig.length > 0 && resource.tiles) {
      const wasmWrapper = asset.$.wasmWrapper;

      for (const fileConfig of filesConfig) {
        const prefix = fileConfig.prefix.endsWith('/') ? fileConfig.prefix : fileConfig.prefix + '/';

        // getValuesAtPath resolves path entirely in Rust — one FFI call, no async ViewModel walk.
        // Returns PseudoList with tileId, nodeId, tileData on each entry.
        let pseudoList;
        try {
          pseudoList = wasmWrapper.getValuesAtPath(fileConfig.node);
        } catch (e) {
          console.warn(`[files] Could not resolve path "${fileConfig.node}": ${e}`);
          continue;
        }

        const count = pseudoList.totalValues;
        if (count === 0) continue;

        // Resolve variants as children of the file node (e.g. .images.thumbnail)
        const nodePath = fileConfig.node.replace(/^\./, '');

        // Resolve variants via getValuesAtPath too — indexed by tileId for matching
        const variantData: Array<{ sizeDir: string; byTile: Map<string, { nodeId: string; tileData: any }> }> = [];
        if (fileConfig.variants) {
          for (const [alias, sizeDir] of Object.entries(fileConfig.variants)) {
            const variantPath = `.${nodePath}.${alias}`;
            try {
              const varPseudoList = wasmWrapper.getValuesAtPath(variantPath);
              const byTile = new Map<string, { nodeId: string; tileData: any }>();
              const varCount = varPseudoList.totalValues;
              for (let j = 0; j < varCount; j++) {
                const varEntry = varPseudoList.getValue(j);
                const varTileId = varEntry.tileId;
                if (varTileId) {
                  byTile.set(varTileId, { nodeId: varEntry.nodeId, tileData: varEntry.tileData });
                }
              }
              variantData.push({ sizeDir, byTile });
            } catch (e) {
              console.warn(`[files] Could not resolve variant path "${variantPath}": ${e}`);
            }
          }
        }

        for (let i = 0; i < count; i++) {
          const pv = pseudoList.getValue(i);
          const tileId = pv.tileId;
          const nodeId = pv.nodeId;
          const fileList = pv.tileData;

          if (!tileId || !Array.isArray(fileList) || fileList.length !== 1) continue;
          const entry = mapsToObjects(fileList[0]) as any;
          if (!entry?.name) continue;
          // Skip rewrite if matchUrlPrefix is set and the existing URL doesn't match
          if (fileConfig.matchUrlPrefix && (!entry.url || !entry.url.startsWith(fileConfig.matchUrlPrefix))) continue;
          const name = encodeURI(entry.name);
          entry.url = prefix + name;
          setTileDataForNode(resource, wasmWrapper, tileId, nodeId, [entry]);

          // Rewrite variant URLs on the same tile
          for (const { sizeDir, byTile } of variantData) {
            const varInfo = byTile.get(tileId);
            if (!varInfo) continue;
            const variantList = varInfo.tileData;
            if (!Array.isArray(variantList)) continue;
            const converted = variantList.map((v: unknown) => {
              const obj = mapsToObjects(v) as any;
              obj.url = prefix + sizeDir + '/' + name;
              return obj;
            });
            setTileDataForNode(resource, wasmWrapper, tileId, varInfo.nodeId, converted);
          }
        }
      }
    }


    // TILES SHOULD BE CONSIDERED IMMUTABLE FROM HERE, AS WE TAKE THEM BACK FROM ALIZARIN

    // Export tiles from the wrapper — this includes mutations from setTileDataForNode
    // and only tiles that passed permission filtering.
    if (asset.$.wasmWrapper && typeof asset.$.wasmWrapper.exportTilesJson === 'function') {
      resource.tiles = JSON.parse(asset.$.wasmWrapper.exportTilesJson());
    }

    const staticAsset = await tracer.startActiveSpan('forJson', async () => {
      return await asset.forJson(true);
    });

    // Get display-friendly JSON for template rendering (resolves references to strings)
    const displayAsset = await tracer.startActiveSpan('forDisplayJson', async () => {
      return await asset.forDisplayJson(true);
    });

    const meta = await tracer.startActiveSpan('getMeta', async () => {
      return await assetFunctions.getMeta(asset, staticAsset.root, resourcePrefix, includePrivate, displayAsset.root);
    });

    // Apply file URL rewrites to thumbnailUrl — getMeta reads from the stale ViewModel cache,
    // so we rewrite the URL using the same prefix/variant logic applied to tiles above.
    if (filesConfig.length > 0 && meta.meta.thumbnailUrl) {
      const oldUrl: string = meta.meta.thumbnailUrl;
      const filename = oldUrl.split('/').pop();
      if (filename) {
        for (const fileConfig of filesConfig) {
          const thumbnailSizeDir = fileConfig.variants?.['thumbnail'];
          if (!thumbnailSizeDir) continue;
          // Skip if matchUrlPrefix is set and the existing thumbnail URL doesn't match
          if (fileConfig.matchUrlPrefix && !oldUrl.startsWith(fileConfig.matchUrlPrefix)) continue;
          const prefix = fileConfig.prefix.endsWith('/') ? fileConfig.prefix : fileConfig.prefix + '/';
          meta.meta.thumbnailUrl = prefix + thumbnailSizeDir + '/' + filename;
          break;
        }
      }
    }

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

    // Build cache in getValueCache format: {tileId: {nodeId: entry}}
    // Entry formats:
    // - resource-instance: {datatype, id, type, graphId, title}
    // - resource-instance-list: {datatype, _: [...entries...], meta}
    type SingleCacheEntry = {datatype: string, id: string, type: string, graphId: string, title?: string, meta?: any};
    type ListCacheEntry = {datatype: string, _: SingleCacheEntry[], meta?: any};
    type CacheEntry = SingleCacheEntry | ListCacheEntry;

    // First pass: collect all entries per tile/node (since resource-instance-list can have multiple)
    const collectedEntries: Record<string, Record<string, SingleCacheEntry[]>> = {};

    if (resource.tiles) {
      for (const tile of resource.tiles) {
        if (tile.data) {
          for (const [nodeId, value] of Object.entries(tile.data)) {
            // Handle resource-instance and resource-instance-list data format: [{resourceId: "..."}]
            if (Array.isArray(value)) {
              for (const entry of value) {
                if (entry && typeof entry === 'object' && 'resourceId' in entry) {
                  const refId = entry.resourceId;
                  // Look up in staticStore registry
                  const cached = staticStore.registry.getFull(refId) || staticStore.registry.getSummary(refId);
                  if (cached) {
                    const meta = (cached as any).resourceinstance || cached;
                    const graphId = meta.graph_id;
                    // Get model class name from graphManager if available
                    const wkrm = [...graphManager.wkrms.values()].find((w: any) => w.graphId === graphId);
                    const modelClassName = wkrm?.modelClassName || graphId;

                    // Initialize tile/node entry if needed
                    if (!collectedEntries[tile.tileid]) {
                      collectedEntries[tile.tileid] = {};
                    }
                    if (!collectedEntries[tile.tileid][nodeId]) {
                      collectedEntries[tile.tileid][nodeId] = [];
                    }
                    // Collect all entries (don't dedupe - order matters)
                    collectedEntries[tile.tileid][nodeId].push({
                      datatype: 'resource-instance',
                      id: refId,
                      type: modelClassName,
                      graphId: graphId,
                      title: meta.name || meta.descriptors?.name || undefined,
                    });
                  }
                }
              }
            }
          }
        }
      }
    }

    // Second pass: convert to proper cache format based on entry count
    const newCache: Record<string, Record<string, CacheEntry>> = {};
    for (const [tileId, nodeEntries] of Object.entries(collectedEntries)) {
      newCache[tileId] = {};
      for (const [nodeId, entries] of Object.entries(nodeEntries)) {
        if (entries.length === 1) {
          // Single entry - use resource-instance format
          newCache[tileId][nodeId] = entries[0];
        } else if (entries.length > 1) {
          // Multiple entries - use resource-instance-list format
          newCache[tileId][nodeId] = {
            datatype: 'resource-instance-list',
            _: entries,
            meta: {},
          };
        }
      }
    }

    // Set __cache if we found any related resources
    // Merge with existing cache (new entries win for conflicts)
    if (Object.keys(newCache).length > 0) {
      const existingCache = (resource.__cache || {}) as Record<string, Record<string, CacheEntry>>;
      for (const [tileId, nodeEntries] of Object.entries(newCache)) {
        if (!existingCache[tileId]) {
          existingCache[tileId] = {};
        }
        for (const [nodeId, entry] of Object.entries(nodeEntries)) {
          existingCache[tileId][nodeId] = entry;
        }
      }
      resource.__cache = existingCache;
    }

    resource.__scopes = resource.__scopes || safeJsonParse(meta.meta.scopes, 'resource scopes');
    resource.metadata = meta.meta;

    const serial = JSON.stringify(resource, replacer, minify ? undefined : 2)
    const businessDataDir = `${PUBLIC_FOLDER}/definitions/business_data`;
    const safeFilePath = safeJoinPath(businessDataDir, `${meta.slug}.json`);
    await fs.promises.writeFile(safeFilePath, serial);

    span.setAttribute('asset.slug', meta.slug);
    return meta;
  });
}

async function buildPreindex(graphManager: any, resourceFile: string | null, allResourceFiles: string[], resourcePrefix: string | undefined, includePrivate: boolean=false, lazy: boolean=false, minify: boolean=false) {
    await graphManager.initialize({ graphs: null, defaultAllowAllNodegroups: includePrivate });
    log("Loading for preindex: " + resourceFile);
    if (includePrivate) {
      log("Building for NON-PUBLIC assets");
    }
    log("Starting resource processing...");

    if (!resourceFile) {
      throw Error("Resource file is required for preindexing");
    }

    // getAllFrom now returns an async generator to avoid accumulating all resources in memory
    const assetGenerator = assetFunctions.getAllFrom(graphManager, allResourceFiles, includePrivate, lazy);

    const assetMetadata: Asset[] = [];
    const assocMetadata: Asset[] = [];
    const registries: {[key: string]: [number, number][]} = {};

    // Batch size for parallel processing
    const n = 10;
    let batchAssets: any[] = [];
    let totalProcessed = 0;
    let batchNumber = 0;

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

    // Process resources as they arrive from the generator
    for await (const asset of assetGenerator) {
      batchAssets.push(asset);

      // Process when we have a full batch
      if (batchAssets.length >= n) {
        progress('batch-processing', 'Processing assets', totalProcessed, totalProcessed + 100); // Estimate

        let assetBatch: Asset[] = await tracer.startActiveSpan('processBatch', { 'batch.index': batchNumber, 'batch.size': batchAssets.length }, async () => {
          const results = await Promise.all(batchAssets.map(a => processAsset(Promise.resolve(a), resourcePrefix, includePrivate, minify)));
          return results.filter(a => a !== null);
        });

        // Release WASM memory for processed resources to prevent memory exhaustion
        for (const processedAsset of batchAssets) {
          try {
            processedAsset.$?.release?.();
          } catch (e) {
            // Ignore release errors - resource may already be cleaned up
          }
        }

        assetBatch.map((a: Asset) => a.meta && a.meta.geometry ? addFeatures(a) : null);
        assocMetadata.push(...assetBatch.filter(a => !assetFunctions.shouldIndex(a, includePrivate)));
        assetBatch = assetBatch.filter(a => assetFunctions.shouldIndex(a, includePrivate));
        assetMetadata.push(...assetBatch);

        totalProcessed += batchAssets.length;
        batchNumber++;
        batchAssets = [];
      }
    }

    // Process any remaining assets in the final partial batch
    if (batchAssets.length > 0) {
      let assetBatch: Asset[] = await tracer.startActiveSpan('processBatch', { 'batch.index': batchNumber, 'batch.size': batchAssets.length }, async () => {
        const results = await Promise.all(batchAssets.map(a => processAsset(Promise.resolve(a), resourcePrefix, includePrivate, minify)));
        return results.filter(a => a !== null);
      });

      // Release WASM memory for processed resources
      for (const processedAsset of batchAssets) {
        try {
          processedAsset.$?.release?.();
        } catch (e) {
          // Ignore release errors
        }
      }

      assetBatch.map((a: Asset) => a.meta && a.meta.geometry ? addFeatures(a) : null);
      assocMetadata.push(...assetBatch.filter(a => !assetFunctions.shouldIndex(a, includePrivate)));
      assetBatch = assetBatch.filter(a => assetFunctions.shouldIndex(a, includePrivate));
      assetMetadata.push(...assetBatch);

      totalProcessed += batchAssets.length;
    }

    log(`Processed ${totalProcessed} assets total`);

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

async function buildOnePreindex(resourceFile: string, resourcePrefix: string, includePrivate: boolean=false, lazy: boolean=false, minify: boolean=false, warningCollector?: WarningCollector) {
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
  if (warningCollector) {
    assetFunctions.setWarningCollector(warningCollector);
  }
  await buildPreindex(gm, resourceFile || null, resourceFiles, resourcePrefix, includePrivate, lazy, minify);
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

export async function etl(resourceFile: string, resourcePrefix: string | undefined, includePrivate: boolean=false, useTui: boolean=false, lazy: boolean=false, showSummary: boolean=false, verbose: boolean=false, minify: boolean=false, buildRosMadair: boolean=false, rosMadairBin: string="build_from_prebuild", rosMadairOutput: string="docs/static/ros-madair") {
  if (!resourceFile.endsWith('.json')) {
    console.error(`Tried to run with a non .json file: ${resourceFile}`);
    process.exit(1);
  }

  if (useTui) {
    enableProgress();
  }

  // Reset global summary at start of run
  globalSummaryExporter.reset();

  const warningCollector = new WarningCollector(verbose);

  try {
    log("Pre-indexing " + resourceFile);
    await buildOnePreindex(resourceFile, resourcePrefix || "", includePrivate, lazy, minify, warningCollector);

    if (buildRosMadair) {
      log("Building Rós Madair index...");
      const { buildRosMadairIndex } = await import('./ros-madair.ts');
      await buildRosMadairIndex({
        businessDataDir: `${PUBLIC_FOLDER}/definitions/business_data`,
        graphsDir: 'prebuild/graphs/resource_models',
        outputDir: rosMadairOutput,
        bin: rosMadairBin,
      });
      log("Rós Madair index built.");
    }

    if (useTui) {
      getProgressDisplay().finish();
    }

    warningCollector.printSummary();

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
