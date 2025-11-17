import Handlebars from 'handlebars';
import { slugify, getValueFromPath } from "./utils";
import { Asset, ModelEntry, DEFAULT_PREBUILD_PATHS } from "./types";
import type { IAssetFunctions, GraphConfiguration, PrebuildConfiguration } from "./types";
import { GraphManager, staticStore, staticTypes, interfaces } from 'alizarin';
import fs from "fs";
import { safeJsonParseFile } from './safe-utils';

class AssetFunctions implements IAssetFunctions {
  config?: PrebuildConfiguration
  graphs?: GraphConfiguration
  permissions: {[key: string]: {[key: string]: boolean | string} | boolean}
  templates: {[key: string]: HandlebarsTemplateDelegate<any>}
  slugCounter: {[key: string]: number};
  permissionCollectionNodes: {[key: string]: {[alias: string]: staticTypes.StaticCollection | undefined}} = {
  };
  permissionFunctions: {[key: string]: interfaces.CheckPermission} = {
  }

  constructor() {
    this.slugCounter = {};
    this.permissions = {};
    this.templates = {};
  }

  getPermittedNodegroups(modelName: string) {
    if (!this.permissions[modelName]) {
      return null;
    }
    return new Map(Object.entries(this.permissions[modelName]).map(([k, v]: [k: string, v: string | boolean]) => {
      if (typeof v === "boolean") {
        return [k, v];
      }
      return [k, this.permissionFunctions[v]];
    }));
  }

  async initialize() {
    this.config = await safeJsonParseFile<PrebuildConfiguration>("prebuild/prebuild.json");
    this.graphs = await safeJsonParseFile<GraphConfiguration>("prebuild/graphs.json");
    this.permissions = await safeJsonParseFile(
      this.config.permissionsFile || 'prebuild/permissions.json'
    );
    const templates = await Promise.all(Object.entries(this.config.indexTemplates).map(
      async ([mdl, file]: [string, string]): Promise<[string, HandlebarsTemplateDelegate<any>]> => {
        let template = await fs.promises.readFile(`prebuild/indexTemplates/${file}`, { encoding: "utf8" })
        return [
          mdl,
          Handlebars.compile(template)
        ];
      }
    ));
    this.templates = Object.fromEntries(templates);
  }

  shouldIndex(_asset: Asset, _includePrivate: boolean = false) {
    return true;
  }

  async toSlug(title: string, staticAsset: any, prefix: string | undefined): Promise<string> {
    let slug = slugify(title);
    slug = `${slug}_${staticAsset.id.slice(0, 6)}`;
    if (prefix) {
      slug = `${prefix}${slug}`;
    }
    let slug_n;
    if (slug in this.slugCounter) {
      slug_n = this.slugCounter[slug] + 1;
      slug = `${slug}_${slug_n}`;
    } else {
      slug_n = 1;
    }
    this.slugCounter[slug] = slug_n;
    return slug;
  }

  async getMeta(asset: any, staticAsset: any, prefix: string | undefined, _includePrivate: boolean): Promise<Asset> {
    /**
     * getMeta will use the staticAsset where possible, but that _can_ be dynamic (i.e. raw asset) if you have
     * not already serialized.
     */
    const modelType = asset.__.wkrm.modelClassName;
    let displayName: string = "(unknown)"; // TODO: translate
    if (await asset.$?.getName) {
      displayName = await asset.$.getName();
    }

    let geometry = await getValueFromPath(
      staticAsset,
      this.config?.paths?.["geometry"] ?? DEFAULT_PREBUILD_PATHS.geometry
    );
    if (!geometry) {
      console.warn("No geometry node for", staticAsset);
    }
    let location = await getValueFromPath(
      staticAsset,
      this.config?.paths?.["location"] ?? DEFAULT_PREBUILD_PATHS.location
    ) || geometry;
    if (!location) {
      console.warn("No location node for", staticAsset);
    }

    if (location && location["features"]) {
      const polygon = location["features"][0]["geometry"]["coordinates"];
      if (Array.isArray(polygon[0])) {
        let polygons = polygon[0];
        if ((Array.isArray(polygons[0][0]))) {
          polygons = polygons.flat();
        }
        const centre = polygons.reduce((c: Array<number>, p: Array<number>) => {
          c[0] += p[0] / polygons.length;
          c[1] += p[1] / polygons.length;
          return c;
        }, [0, 0]);
        location = {
            "features": [{
                "geometry": {
                    "type": "Point",
                    "coordinates": centre
                }
            }]
        }
      }
    }
    if (location && location["features"]) {
      location = location["features"][0]["geometry"]["coordinates"];
    } else {
      location = null;
    }

    const slug = await this.toSlug(displayName, asset, prefix);
    const meta = new Asset(
      staticAsset.id,
      geometry,
      location,
      displayName,
      slug,
      "",
      modelType,
      [] // TODO: this should say ['public'] if we know it is
    );
    meta.meta["registries"] = "[]";
    meta.content = displayName;
    return meta;
  }

  // RMV: TO REFACTOR
  async getAllFrom(graphManager: GraphManager, filename: string, includePrivate: boolean) {
    const resourceFile = await safeJsonParseFile(filename);
    const resourceList: staticTypes.StaticResource[] = resourceFile.business_data.resources;
    const graphs = resourceList.reduce((set: Set<string>, resource: staticTypes.StaticResource) => { set.add(resource.resourceinstance.graph_id); return set; }, new Set());
    const resources = [];
    const models: {[graphId: string]: any} = {};
    for (const modelToLoad of graphs) {
      this.registries = Object.fromEntries(await Promise.all((await (await graphManager.get("Registry")).all()).map(async (reg) => {
        const nameCount = await reg.names.length;
        let names = [];
        let indexedNames = [];
        for (let i = 0 ; i < nameCount ; i++) {
          names.push([
            (await reg.names[i].name_use_type).toString(),
            (await reg.names[i].name).toString(),
          ]);
        }
        indexedNames = Object.fromEntries(names);
        return [await reg.id, indexedNames['Primary']];
      })));
      const Model = await graphManager.get(modelToLoad);
      const modelClassName = Model.wkrm.modelClassName;
      let permissions = this.permissions;
      if (includePrivate) {
        console.warn("Still publishing ALL nodegroups for", modelToLoad);
      } else {
        if (modelClassName in permissions && permissions[modelClassName] !== false) {
          if (permissions[modelClassName] !== true) {
            if (modelClassName in this.permissionCollectionNodes) {
              const nodes = Model.getNodeObjectsByAlias();
              for (const [alias] of Object.entries(this.permissionCollectionNodes[modelClassName])) {
                const node = nodes.get(alias);
                this.permissionCollectionNodes[modelClassName][alias] = await RDM.retrieveCollection(node.config.rdmCollection);
              }
            }
            Model.setPermittedNodegroups(this.getPermittedNodegroups(modelClassName));
          }
        } else {
          Model.setPermittedNodegroups([]);
        }
      }

      for (const model of Object.keys(this.getModelFiles())) {
        await graphManager.loadGraph(model);
      }

      for (const model of Object.keys(this.getModelFiles())) {
        console.log("Loading graph", model);
        for await (const res of staticStore.loadAll(model)) {
          // FIXME: remove this loop but ensure loading happens
        }
      }

      models[modelToLoad] = Model;
    }

    for (const staticResource of resourceList) {
      const Model = models[staticResource.resourceinstance.graph_id];
      const resource = Model.find(staticResource.resourceinstance.resourceinstanceid);
      resources.push(resource);
    }
    return Promise.all(resources);
  }

  getModelFiles():{[key: string]: ModelEntry} {
    return (this.graphs || {}).models || {};
  }
};

const assetFunctions = new AssetFunctions();

export { assetFunctions };
