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
    // First, ensure the graph is loaded with correct default permissions
    await graphManager.loadGraph("Registry", includePrivate);

    const registryGraph = await graphManager.get("Registry", includePrivate);

    // Apply permissions to Registry model BEFORE calling all() which creates resources
    // This ensures tiles aren't pruned incorrectly when includePrivate is true
    await this.permissionManager.applyPermissions(registryGraph, "Registry", includePrivate);

    const allRegs = await registryGraph.all();

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

  async getAllFrom(graphManager: GraphManager, filename: string, includePrivate: boolean, modelFiles: {[key: string]: ModelEntry}) {
    const resourceFile = await safeJsonParseFile(filename);
    const resourceList: staticTypes.StaticResource[] = resourceFile.business_data.resources;
    const graphs = resourceList.reduce((set: Set<string>, resource: staticTypes.StaticResource) => {
      set.add(resource.resourceinstance.graph_id);
      return set;
    }, new Set());

    const resources = [];
    const models: {[graphId: string]: any} = {};

    await this.loadRegistries(graphManager, includePrivate);
    await this.loadGraphsAndResources(graphManager, modelFiles, includePrivate);

    // Now set up permissions for each graph
    for (const modelToLoad of graphs) {
      const Model = await graphManager.get(modelToLoad, includePrivate);
      const modelClassName = Model.wkrm.modelClassName;

      await this.permissionManager.applyPermissions(Model, modelClassName, includePrivate);
      models[modelToLoad] = Model;
    }

    for (const staticResource of resourceList) {
      const Model = models[staticResource.resourceinstance.graph_id];
      const resource = Model.find(staticResource.resourceinstance.resourceinstanceid);
      resources.push(resource);
    }

    return Promise.all(resources).catch((e) => {
      console.log("*** Could not load a resource, perhaps the graph is not in prebuild/graphs.json or a dependency is missing in prebuild/prebuild.json? ***");
      throw e;
    });
  }
}
