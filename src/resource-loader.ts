import * as fs from "fs";
import * as path from "path";
import { GraphManager, RDM, parseSkosXmlToCollection, staticStore, staticTypes } from 'alizarin/inline';
import { safeJsonParseFile } from './safe-utils';
import { getProgressDisplay } from './progress';
import { getFilesForRegex } from './utils';
import type { ModelEntry } from "./types";
import type { PermissionManager } from "./permissions";

const RDM_COLLECTIONS_DIR = "prebuild/reference_data/collections";

/** Lightweight ref returned by WASM loadFromBusinessDataBytes */
interface ResourceRef {
  resourceinstanceid: string;
  graph_id: string;
  isPublic: boolean;
}

export class ResourceLoader {
  permissionManager: PermissionManager;

  constructor(permissionManager: PermissionManager) {
    this.permissionManager = permissionManager;
  }

  async loadGraphsAndPermissions(graphManager: GraphManager, modelFiles: {[key: string]: ModelEntry}, includePrivate: boolean) {
    // Load all graph schemas and apply permissions.
    // Resource loading is handled separately via loadFromBusinessDataBytes.
    const display = getProgressDisplay();
    const modelKeys = Object.keys(modelFiles);

    // Phase 1: Load all graphs
    for (let i = 0; i < modelKeys.length; i++) {
      const model = modelKeys[i];
      display.log(`Loading graph: ${model}`);
      display.progress('graph-loading', 'Loading graphs', i + 1, modelKeys.length);
      await graphManager.loadGraph(model, includePrivate);
    }

    // Phase 2: Apply permissions to all models
    for (let i = 0; i < modelKeys.length; i++) {
      const model = modelKeys[i];
      const Model = await graphManager.get(model, includePrivate);
      const modelClassName = Model.wkrm.modelClassName;
      display.log(`Applying permissions for: ${modelClassName}`);
      await this.permissionManager.applyPermissions(Model, modelClassName, includePrivate);
    }
  }

  /** Legacy: load graphs, permissions, AND resources via staticStore.loadAll.
   *  Used as fallback when WASM loadFromBusinessDataBytes is not available. */
  async loadGraphsAndResources(graphManager: GraphManager, modelFiles: {[key: string]: ModelEntry}, includePrivate: boolean) {
    await this.loadGraphsAndPermissions(graphManager, modelFiles, includePrivate);

    const display = getProgressDisplay();
    const modelKeys = Object.keys(modelFiles);

    // Phase 3: Load resources via staticStore (reads files through ArchesClientLocal)
    for (let i = 0; i < modelKeys.length; i++) {
      const model = modelKeys[i];
      display.log(`Loading resources for: ${model}`);
      let n = 0;
      try {
        for await (const _ of staticStore.loadAll(model)) {
          n += 1;
          if (n % 100 === 0) {
            display.progress(`resource-loading-${model}`, `Loading ${model} resources`, n, n + 1);
          }
        }
        display.progress(`resource-loading-${model}`, `Loading ${model} resources`, n, n);
      } catch (e) {
        display.log("Could not find a resource, perhaps the graph is not in prebuild/graphs.json or a dependency is missing in prebuild/prebuild.json?");
        throw e;
      }
      display.log(`Loaded ${n} resources for ${model}`);
    }
  }

  async preloadReferenceSources(referenceSources: string[]) {
    const display = getProgressDisplay();
    for (const pattern of referenceSources) {
      for await (const file of getFilesForRegex("prebuild/business_data", pattern)) {
        display.log(`Preloading summaries from: ${file}`);
        const content = await fs.promises.readFile(file, { encoding: "utf8" });
        const parsed = JSON.parse(content);
        const resources = parsed.business_data?.resources;
        if (resources && Array.isArray(resources)) {
          staticStore.registry.mergeFromResourcesJson(JSON.stringify(resources), false, true);
          display.log(`Preloaded ${resources.length} summaries from ${file}`);
        }
      }
    }
  }

  /**
   * Preload RDM (legacy concept) collections referenced by concept/concept-list
   * nodes into the WASM RDM cache, so `forDisplayJson` can resolve UUIDs to labels.
   *
   * Reads SKOS RDF/XML files from `prebuild/reference_data/collections/{id}.xml`
   * (the convention used by catalina-starches and similar Arches projects).
   * Silently skips collections whose file is missing or fails to parse.
   */
  async preloadRdmCollections(graphManager: GraphManager, modelFiles: {[key: string]: ModelEntry}, includePrivate: boolean) {
    const display = getProgressDisplay();

    // Check the collections directory exists - if not, nothing to preload
    try {
      await fs.promises.access(RDM_COLLECTIONS_DIR);
    } catch {
      display.log(`No RDM collections directory at ${RDM_COLLECTIONS_DIR}, skipping preload`);
      return;
    }

    // Enumerate unique collection IDs across all configured models
    const collectionIds = new Set<string>();
    for (const model of Object.keys(modelFiles)) {
      try {
        const Model = await graphManager.get(model, includePrivate);
        for (const id of Model.getCollections(!includePrivate)) {
          collectionIds.add(id);
        }
      } catch (e) {
        display.log(`Could not enumerate RDM collections for model ${model}: ${e instanceof Error ? e.message : e}`);
      }
    }

    if (collectionIds.size === 0) {
      display.log("No RDM collections referenced by configured models");
      return;
    }

    display.log(`Preloading ${collectionIds.size} RDM collections from ${RDM_COLLECTIONS_DIR}`);
    let loaded = 0;
    let skipped = 0;
    for (const id of collectionIds) {
      const xmlPath = path.join(RDM_COLLECTIONS_DIR, `${id}.xml`);
      try {
        const xmlContent = await fs.promises.readFile(xmlPath, "utf8");
        const parsed = parseSkosXmlToCollection(xmlContent, "http://localhost/") as any;
        const collection = new staticTypes.StaticCollection({
          id: parsed.id || id,
          prefLabels: parsed.prefLabels || {},
          concepts: parsed.concepts || {},
        } as any);
        RDM.addCollection(collection);
        collection.ensureInCache?.();
        loaded++;
      } catch (e) {
        skipped++;
        display.log(`Skipped RDM collection ${id}: ${e instanceof Error ? e.message : e}`);
      }
    }
    display.log(`Preloaded ${loaded} RDM collections (${skipped} skipped)`);
  }

  async *getAllFrom(graphManager: GraphManager, filenames: string[], includePrivate: boolean, modelFiles: {[key: string]: ModelEntry}, lazy: boolean = false, referenceSources?: string[]): AsyncGenerator<any, void, unknown> {
    const display = getProgressDisplay();

    // Phase 1: Load all graph schemas and permissions (no resource data yet).
    // This MUST happen before loading business data so Model.find() works.
    display.log("Loading graph schemas...");
    await this.loadGraphsAndPermissions(graphManager, modelFiles, includePrivate);

    // Load Registry graph schema (may not be in modelFiles) — needed so
    // alizarin can resolve record_or_registry resource-instance references.
    display.log("Loading Registry graph...");
    await graphManager.loadGraph("Registry", includePrivate);
    const RegistryModel = await graphManager.get("Registry", includePrivate);
    await this.permissionManager.applyPermissions(RegistryModel, "Registry", includePrivate);
    display.log("Graph schemas loaded");

    // Phase 2: Load resources via WASM loadFromBusinessDataBytes.
    // Reads files as raw bytes, parses and stores entirely in Rust — no V8
    // string limit, no V8 object allocation.
    // Falls back to JS JSON.parse for older alizarin builds.
    display.log(`Loading resources from ${filenames.length} file(s)...`);
    let resourceRefs: ResourceRef[] = [];
    const useWasmLoader = typeof staticStore.registry.loadFromBusinessDataBytes === 'function';

    if (useWasmLoader) {
      for (const filename of filenames) {
        display.log(`Loading: ${filename}`);
        const buffer = await fs.promises.readFile(filename);
        const refs: ResourceRef[] = staticStore.registry.loadFromBusinessDataBytes(buffer, true, true);
        if (refs.length > 0) {
          display.log(`Sample ref keys: ${JSON.stringify(Object.keys(refs[0]))}`);
          display.log(`Sample ref: ${JSON.stringify(refs[0])}`);
        }
        const filtered = includePrivate ? refs : refs.filter(r => r.isPublic);
        resourceRefs.push(...filtered);
        display.log(`Loaded ${refs.length} resources via WASM from ${filename} (${filtered.length} after scope filter)`);
      }
      display.log(`Total: ${resourceRefs.length} resources from all files`);
    } else {
      // Fallback: read via JS + load via staticStore.loadAll
      display.log("WASM loadFromBusinessDataBytes not available, falling back to JS path");
      for (const filename of filenames) {
        const resourceFile = await safeJsonParseFile(filename);
        let resourceList = resourceFile.business_data.resources;
        if (!includePrivate) {
          resourceList = resourceList.filter((resource: any) => {
            if (resource.__scopes && resource.__scopes.includes("public")) {
              return true;
            }
          });
        }
        resourceRefs.push(...resourceList.map((r: any) => ({
          resourceinstanceid: r.resourceinstance.resourceinstanceid,
          graph_id: r.resourceinstance.graph_id,
          isPublic: true,
        })));
      }
      // Load resources via staticStore (the old way — reads files again)
      const modelKeys = Object.keys(modelFiles);
      for (const model of modelKeys) {
        let n = 0;
        for await (const _ of staticStore.loadAll(model)) { n++; }
        display.log(`Loaded ${n} resources for ${model} (legacy path)`);
      }
      display.log(`Found ${resourceRefs.length} resources via JS fallback`);
    }

    const graphs = new Set(resourceRefs.map(r => r.graph_id));

    if (referenceSources?.length) {
      display.log("Preloading reference summaries...");
      await this.preloadReferenceSources(referenceSources);
      display.log("Reference summary preloading complete");
    }

    // Preload RDM collections so concept-list nodes resolve to labels in forDisplayJson
    await this.preloadRdmCollections(graphManager, modelFiles, includePrivate);

    // Set up permissions for each graph present in the data.
    // Skip graph_ids that weren't loaded (not in modelFiles).
    const models: {[graphId: string]: any} = {};
    const graphsArray = Array.from(graphs);
    for (let i = 0; i < graphsArray.length; i++) {
      const modelToLoad = graphsArray[i];
      try {
        const Model = await graphManager.get(modelToLoad, includePrivate);
        const modelClassName = Model.wkrm.modelClassName;

        display.progress('permission-setup', 'Setting up permissions', i + 1, graphsArray.length);
        await this.permissionManager.applyPermissions(Model, modelClassName, includePrivate);
        models[modelToLoad] = Model;
      } catch {
        display.log(`Skipping graph ${modelToLoad} (not in modelFiles, likely a dependency)`);
      }
    }

    // Filter refs to only include graphs we have models for
    const processableRefs = resourceRefs.filter(r => models[r.graph_id]);
    const skippedCount = resourceRefs.length - processableRefs.length;
    if (skippedCount > 0) {
      display.log(`Skipping ${skippedCount} resources from unloaded graphs (dependencies)`);
    }

    display.log(`Finding ${processableRefs.length} resources...`);
    display.log(`Registry size: ${staticStore.registry.length}`);

    // Process in small batches and YIELD each resource individually
    const BATCH_SIZE = 10;
    let lastLogTime = Date.now();
    let lastLogCount = 0;
    let yielded = 0;

    for (let i = 0; i < processableRefs.length; i += BATCH_SIZE) {
      const batch = processableRefs.slice(i, Math.min(i + BATCH_SIZE, processableRefs.length));
      const batchPromises = batch.map((ref) => {
        const Model = models[ref.graph_id];
        return Model.find(ref.resourceinstanceid, lazy);
      });

      const batchResults = await Promise.all(batchPromises);

      for (const resource of batchResults) {
        yield resource;
        yielded++;
      }

      const processed = Math.min(i + BATCH_SIZE, processableRefs.length);
      display.progress('finding-resources', 'Finding resources', processed, processableRefs.length);

      const now = Date.now();
      if (processed % 500 === 0 || (now - lastLogTime > 5000 && processed > lastLogCount)) {
        const elapsed = now - lastLogTime;
        const rate = ((processed - lastLogCount) / elapsed * 1000).toFixed(1);
        display.log(`Found ${processed}/${processableRefs.length} (${rate} res/sec)`);
        lastLogTime = now;
        lastLogCount = processed;
      }
      display.forceRender();
    }

    display.log(`Found all ${yielded} resources`);
  }
}
