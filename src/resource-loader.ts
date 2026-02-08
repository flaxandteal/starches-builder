import { GraphManager, staticStore, staticTypes } from 'alizarin';
import { safeJsonParseFile } from './safe-utils';
import { getProgressDisplay } from './progress';
import type { ModelEntry } from "./types";
import type { PermissionManager } from "./permissions";

export class ResourceLoader {
  permissionManager: PermissionManager;
  registries: {[key: string]: any} = {};

  constructor(permissionManager: PermissionManager) {
    this.permissionManager = permissionManager;
  }

  async loadRegistries(graphManager: GraphManager, includePrivate: boolean) {
    const display = getProgressDisplay();

    // First, ensure the graph is loaded with correct default permissions
    display.log("Loading Registry graph...");
    await graphManager.loadGraph("Registry", includePrivate);

    display.log("Getting Registry graph...");
    const registryGraph = await graphManager.get("Registry", includePrivate);

    // Apply permissions to Registry model BEFORE calling all() which creates resources
    // This ensures tiles aren't pruned incorrectly when includePrivate is true
    display.log("Applying Registry permissions...");
    await this.permissionManager.applyPermissions(registryGraph, "Registry", includePrivate);

    display.log("Loading all registries...");
    const allRegs = await registryGraph.all();

    display.log(`Processing ${allRegs.length} registries...`);
    const entries: [string, string][] = [];
    for (const reg of allRegs) {
      const nameCount = await reg.names.length;
      const names: [string, string][] = [];

      for (let i = 0; i < nameCount; i++) {
        try {
          const nameUseType = await reg.names[i].name_use_type;
          const name = await reg.names[i].name;
          names.push([nameUseType?.toString(), name.toString()]);
        } catch (e) {
          console.error(`Error loading name ${i} for registry:`, e);
        }
      }

      const indexedNames = Object.fromEntries(names);
      const regId = await reg.id;
      entries.push([regId, indexedNames['Primary']]);
    }

    this.registries = Object.fromEntries(entries);
  }

  async loadGraphsAndResources(graphManager: GraphManager, modelFiles: {[key: string]: ModelEntry}, includePrivate: boolean) {
    // Load all graphs first, then apply permissions, then load resources
    // Permissions MUST be set before loading resources to prevent incorrect tile pruning
    const display = getProgressDisplay();
    const modelKeys = Object.keys(modelFiles);

    // Phase 1: Load all graphs
    for (let i = 0; i < modelKeys.length; i++) {
      const model = modelKeys[i];
      display.log(`Loading graph: ${model}`);
      display.progress('graph-loading', 'Loading graphs', i + 1, modelKeys.length);
      await graphManager.loadGraph(model, includePrivate);
    }

    // Phase 2: Apply permissions to all models BEFORE loading any resources
    // This is critical - resources are created during loadAll, and they prune tiles based on permissions
    for (let i = 0; i < modelKeys.length; i++) {
      const model = modelKeys[i];
      const Model = await graphManager.get(model, includePrivate);
      const modelClassName = Model.wkrm.modelClassName;
      display.log(`Applying permissions for: ${modelClassName}`);
      await this.permissionManager.applyPermissions(Model, modelClassName, includePrivate);
    }

    // Phase 3: Now load resources - permissions are already set
    for (let i = 0; i < modelKeys.length; i++) {
      const model = modelKeys[i];
      display.log(`Loading resources for: ${model}`);
      // Force all resources into the cache, so we can find them without the need for individual requests.
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

  async *getAllFrom(graphManager: GraphManager, filename: string, includePrivate: boolean, modelFiles: {[key: string]: ModelEntry}, lazy: boolean = false): AsyncGenerator<any, void, unknown> {
    const display = getProgressDisplay();
    display.log("Parsing resource file...");
    const resourceFile = await safeJsonParseFile(filename);
    let resourceList: staticTypes.StaticResource[] = resourceFile.business_data.resources;
    if (!includePrivate) {
      resourceList = resourceList.filter((resource: staticTypes.StaticResource) => {
        if (resource.__scopes && resource.__scopes.includes("public")) {
          return true;
        }
      });
    }
    display.log(`Found ${resourceList.length} resources in file`);
    const graphs: Set<string> = resourceList.reduce((set: Set<string>, resource: staticTypes.StaticResource) => {
      set.add(resource.resourceinstance.graph_id);
      return set;
    }, new Set<string>());

    const models: {[graphId: string]: any} = {};

    display.log("Starting registry loading...");
    await this.loadRegistries(graphManager, includePrivate);
    display.log("Registry loading complete, starting graph/resource loading...");
    await this.loadGraphsAndResources(graphManager, modelFiles, includePrivate);
    display.log("Graph/resource loading complete");

    // Now set up permissions for each graph
    const graphsArray: string[] = Array.from(graphs);
    for (let i = 0; i < graphsArray.length; i++) {
      const modelToLoad: string = graphsArray[i];
      const Model = await graphManager.get(modelToLoad, includePrivate);
      const modelClassName = Model.wkrm.modelClassName;

      display.progress('permission-setup', 'Setting up permissions', i + 1, graphsArray.length);
      await this.permissionManager.applyPermissions(Model, modelClassName, includePrivate);
      models[modelToLoad] = Model;
    }

    display.log(`Finding ${resourceList.length} resources...`);
    // Debug: check registry state before find calls
    display.log(`Registry size: ${staticStore.registry.length}`);
    if (resourceList.length > 0) {
      const firstId = resourceList[0].resourceinstance.resourceinstanceid;
      const cached = staticStore.registry.getFull(firstId);
      display.log(`First resource ${firstId} cached as: ${cached?.constructor?.name || 'not found'}`);
    }

    // Process in small batches and YIELD each resource individually
    // This allows the caller to process and release resources incrementally
    // preventing WASM memory exhaustion from accumulating all resources at once
    const BATCH_SIZE = 10;
    let lastLogTime = Date.now();
    let lastLogCount = 0;
    let yielded = 0;

    for (let i = 0; i < resourceList.length; i += BATCH_SIZE) {
      const batch = resourceList.slice(i, Math.min(i + BATCH_SIZE, resourceList.length));
      const batchPromises = batch.map((staticResource) => {
        const Model = models[staticResource.resourceinstance.graph_id];
        // Pass lazy flag - for ETL (lazy=false), tiles are loaded upfront from the JSON
        return Model.find(staticResource.resourceinstance.resourceinstanceid, lazy);
      });

      // Await this batch before starting the next - reduces Promise queue contention
      const batchResults = await Promise.all(batchPromises);

      // Yield each resource individually so caller can process and release
      for (const resource of batchResults) {
        yield resource;
        yielded++;
      }

      // Update progress and log rate
      const processed = Math.min(i + BATCH_SIZE, resourceList.length);
      display.progress('finding-resources', 'Finding resources', processed, resourceList.length);

      const now = Date.now();
      if (processed % 500 === 0 || (now - lastLogTime > 5000 && processed > lastLogCount)) {
        const elapsed = now - lastLogTime;
        const rate = ((processed - lastLogCount) / elapsed * 1000).toFixed(1);
        display.log(`Found ${processed}/${resourceList.length} (${rate} res/sec)`);
        lastLogTime = now;
        lastLogCount = processed;
      }
      display.forceRender();
    }

    display.log(`Found all ${yielded} resources`);
  }
}
