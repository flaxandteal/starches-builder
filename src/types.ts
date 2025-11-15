class PrebuildSource {
  [key: string]: any
  resources: string
  public: boolean
  slugPrefix: string

  constructor(source: PrebuildSource) {
    this.resources = source.resources;
    this.public = source.public;
    this.slugPrefix = source.slugPrefix;
  }
};

class PrebuildPaths {
  location: string = ".location_data.0.geometry.geospatial_coordinates"
  geometry: string = ".location_data.0.geometry.geospatial_coordinates"
};

class PrebuildConfiguration {
  [key: string]: any
  indexTemplates: {[mdl: string]: string}
  sources: PrebuildSource[]
  paths: {[key: string]: string}
  permissionsFile?: string
  constructor(config: PrebuildConfiguration) {
    this.indexTemplates = config.indexTemplates;
    this.sources = config.sources;
    this.paths = config.paths || new PrebuildPaths();
    Object.assign(this, config);
  }
};

class IndexEntry {
  loc: Array<number>
  hash: string
  regcode: number

  constructor(loc: Array<number>, hash: string, regcode: number) {
    this.loc = loc;
    this.hash = hash;
    this.regcode = regcode;
  }
};

class AssetMetadata {
  [key: string]: string

  constructor(resourceinstanceid: string, geometry: object, location: object, title: string, slug: string, scopes: string) {
    this.resourceinstanceid = resourceinstanceid;
    if (geometry) {
      this.geometry = JSON.stringify(geometry);
    }
    if (location) {
      this.location = JSON.stringify(location);
    }
    this.title = title;
    this.slug = slug;
    this.designations = "[]";
    this.scopes = scopes;
    this.registries = "[]";
  }
};

class Asset {
  meta: AssetMetadata;
  content: string;
  slug: string;
  type: string;

  constructor(resourceinstanceid: string, geometry: object, location: object, title: string, slug: string, content: string, type: string, scopes: string[]) {
    this.meta = new AssetMetadata(resourceinstanceid, geometry, location, title, slug, JSON.stringify(scopes));
    this.content = content;
    this.slug = slug;
    this.type = type;
  }
};

class ModelEntry {
  graph: string
  resources: {[key: string]: string}

  constructor(graph: string, resources: {[key: string]: string}) {
    this.graph = graph;
    this.resources = resources || [];
  }
}

interface IAssetFunctions {
  getMeta(asset: any, staticAsset: any, prefix: string | undefined, includePrivate: boolean): Promise<Asset>;
  toSlug(title: string, staticAsset: any, prefix: string | undefined): Promise<string>;
  initialize(): Promise<void>;
}

export { Asset, AssetMetadata, ModelEntry, IndexEntry, PrebuildConfiguration };
export type { IAssetFunctions };
