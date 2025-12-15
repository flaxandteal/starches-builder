interface PrebuildSource {
  resources: string
  public: boolean
  slugPrefix: string
  searchFor?: string[]
  [key: string]: any
}

interface PrebuildPaths {
  location: string
  geometry: string
}

const DEFAULT_PREBUILD_PATHS: PrebuildPaths = {
  location: ".location_data.geometry.geospatial_coordinates",
  geometry: ".location_data.geometry.geospatial_coordinates"
};

/**
 * Configuration for a single filter that can be used in Pagefind search
 */
interface FilterConfig {
  /** Dot-notation path to extract from node data (e.g. ".classification.start_type") */
  path: string
  /** Whether the value is a single item or an array of items */
  type: "single" | "array"
  /** Optional list of all valid options (for frontend UI, even if not in data) */
  options?: string[]
}

interface GraphConfiguration {
  models: {[graphId: string]: ModelEntry}
}

interface PrebuildConfiguration {
  indexTemplates: {[mdl: string]: string}
  sources: PrebuildSource[]
  paths?: {[key: string]: string}
  permissionsFile?: string
  customDatatypes?: {[datatype: string]: string}
  filters?: {[filterName: string]: FilterConfig}
  [key: string]: any
}

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

interface AssetMetadata {
  resourceinstanceid: string
  graphid: string
  geometry?: string
  location?: string
  title: string
  slug: string
  designations: string
  scopes: string
  registries: string
  [key: string]: string | undefined
}

class Asset {
  meta: AssetMetadata;
  content: string;
  slug: string;
  type: string;

  constructor(resourceinstanceid: string, graphid: string, geometry: object, location: object, title: string, slug: string, content: string, type: string, scopes: string[]) {
    this.meta = {
      resourceinstanceid,
      graphid,
      geometry: geometry ? JSON.stringify(geometry) : undefined,
      location: location ? JSON.stringify(location) : undefined,
      title,
      slug,
      designations: "[]",
      scopes: JSON.stringify(scopes),
      registries: "[]"
    };
    this.content = content;
    this.slug = slug;
    this.type = type;
  }
};

class ModelEntry {
  name: string
  resources: {[key: string]: string}

  constructor(name: string, resources: {[key: string]: string}) {
    this.name = name;
    this.resources = resources || [];
  }
}

interface IAssetFunctions {
  getMeta(asset: any, staticAsset: any, prefix: string | undefined, includePrivate: boolean): Promise<Asset>;
  toSlug(title: string, staticAsset: any, prefix: string | undefined): Promise<string>;
  initialize(): Promise<void>;
}

export { Asset, ModelEntry, IndexEntry, DEFAULT_PREBUILD_PATHS };
export type { AssetMetadata, IAssetFunctions, PrebuildConfiguration, GraphConfiguration, PrebuildSource, PrebuildPaths, FilterConfig };
