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
  /** The name of the filter */
  name: string
  /** The modelClassName of the graph this filter applies to */
  graph: string
  /** Dot-notation path to extract from node data (e.g. ".classification.start_type") */
  path: string
  /** Whether the value is a single item or an array of items */
  type: "single" | "array"
  /** Optional list of all valid options (for frontend UI, even if not in data) */
  options?: string[]
  /** Optional requirement to use dynamic asset instead of (faster) display-rendered static one */
  dynamic?: boolean
  /** Optional default character count to trim the index entries to for free-text search */
  indexCharacters?: number
  /** Optional whether to trim or only warn */
  indexCharactersWarnOnly?: boolean
}

interface ThumbnailConfig {
  /** The modelClassName of the graph this filter applies to */
  graph: string
  /** Dot-notation path to extract from node data (e.g. ".classification.start_type") */
  path: string
  /** The value that will be present in the image name to identify the thumbnail */
  identifier?: string[]
}

interface GraphSpecificSettings {
  paths?: {[key: string]: string}
  indexCharacters?: number
  indexCharactersWarnOnly?: boolean
  filters?: Omit<FilterConfig, 'graph'>[]
  thumbnail?: Omit<ThumbnailConfig, 'graph'>[]
  indexTemplate?: string
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
  filters?: FilterConfig[]
  thumbnail?: ThumbnailConfig[]
  graphSettings?: {[graphId: string]: GraphSpecificSettings}
  /** Business data files to preload as summaries for resource-instance name resolution */
  referenceSources?: string[]
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
export type { AssetMetadata, IAssetFunctions, PrebuildConfiguration, GraphConfiguration, GraphSpecificSettings, PrebuildSource, PrebuildPaths, FilterConfig };
