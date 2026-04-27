import { Marked } from 'marked'
import markedPlaintify from 'marked-plaintify'
import { Asset, DEFAULT_PREBUILD_PATHS } from "./types";
import type { PrebuildConfiguration, FilterConfig, FileConfig } from "./types";
import type { SlugGenerator } from "./slug-generator";
import { TemplateManager } from './templates';
import type { WarningCollector } from './warning-collector';

/**
 * Resolve a dot-path that may contain numeric index segments
 * (e.g. "location_data.geometry.0.geospatial_coordinates").
 *
 * At each numeric segment N, resolves the path so far, sorts tiles
 * by sortorder, picks the Nth, and uses its tileId as filter_tile_id
 * for subsequent resolution.
 *
 * Returns the same PseudoList as getValuesAtPath.
 */
function resolveIndexedPath(wasmWrapper: any, path: string): any {
  const segments = path.replace(/^\./, '').split('.');

  // Quick check: if no numeric segments, pass straight through
  if (!segments.some(s => /^\d+$/.test(s))) {
    return wasmWrapper.getValuesAtPath(path);
  }

  const aliasSegments: string[] = [];   // accumulated alias path
  let filterTileId: string | undefined;

  for (const seg of segments) {
    if (/^\d+$/.test(seg)) {
      // Numeric index — resolve the path so far, pick the Nth tile
      const currentPath = aliasSegments.join('.');
      const list = wasmWrapper.getValuesAtPath(currentPath, filterTileId);
      const allValues = list.getAllValues?.() ?? [];

      const sorted = [...allValues].sort((a: any, b: any) => {
        const sa = a.sortorder ?? Number.MAX_SAFE_INTEGER;
        const sb = b.sortorder ?? Number.MAX_SAFE_INTEGER;
        return sa - sb;
      });

      const index = parseInt(seg, 10);
      if (index >= sorted.length) {
        throw new Error(
          `Index ${index} out of bounds for path "${currentPath}" (${sorted.length} tiles)`
        );
      }

      filterTileId = sorted[index].tileId;
      if (!filterTileId) {
        throw new Error(`Tile at index ${index} of "${currentPath}" has no tileId`);
      }
    } else {
      aliasSegments.push(seg);
    }
  }

  // Final resolution with the accumulated alias path and last filter
  return wasmWrapper.getValuesAtPath(aliasSegments.join('.'), filterTileId);
}

interface ResolvedGraphConfig {
  paths: {[key: string]: string}
  indexCharacters: number
  indexCharactersWarnOnly: boolean
  filters: FilterConfig[]
  thumbnail: {graph: string, path: string, identifier?: string[]}[]
  files: FileConfig[]
}

export class MetadataExtractor {
  config?: PrebuildConfiguration;
  slugGenerator: SlugGenerator;
  templateManager: TemplateManager;
  private warningCollector?: WarningCollector;

  constructor(slugGenerator: SlugGenerator, templateManager: TemplateManager) {
    this.slugGenerator = slugGenerator;
    this.templateManager = templateManager;
  }

  setConfig(config: PrebuildConfiguration) {
    this.config = config;
  }

  setWarningCollector(collector: WarningCollector) {
    this.warningCollector = collector;
  }

  private resolveGraphConfig(graphId: string, modelType: string): ResolvedGraphConfig {
    const gs = this.config?.graphSettings?.[graphId];

    const paths = gs?.paths ?? this.config?.paths ?? {};

    const indexCharacters = gs?.indexCharacters ?? this.config?.indexCharacters ?? 300;
    const indexCharactersWarnOnly = gs?.indexCharactersWarnOnly ?? this.config?.indexCharactersWarnOnly ?? false;

    // For filters: if graphSettings has filters, use those (injecting graph field).
    // Otherwise, use top-level filters that match modelType.
    let filters: FilterConfig[];
    if (gs?.filters) {
      filters = gs.filters.map(f => ({ ...f, graph: modelType }));
    } else {
      filters = (this.config?.filters ?? []).filter(f => f.graph === modelType);
    }

    // Same replacement logic for thumbnail
    let thumbnail: {graph: string, path: string, identifier?: string[]}[];
    if (gs?.thumbnail) {
      thumbnail = gs.thumbnail.map(t => ({ ...t, graph: modelType }));
    } else {
      thumbnail = (this.config?.thumbnail ?? []).filter(t => t.graph === modelType || t.graph === "*");
    }

    // Same replacement logic for files
    let files: FileConfig[];
    if (gs?.files) {
      files = gs.files.map(f => ({ ...f, graph: modelType }));
    } else {
      files = (this.config?.files ?? []).filter(f => f.graph === modelType);
    }

    return { paths, indexCharacters, indexCharactersWarnOnly, filters, thumbnail, files };
  }

  getFilesConfig(graphId: string, modelType: string): FileConfig[] {
    return this.resolveGraphConfig(graphId, modelType).files;
  }

  async getMeta(asset: any, staticAsset: any, prefix: string | undefined, _includePrivate: boolean, displayAsset?: any): Promise<Asset> {
    /**
     * getMeta will use the staticAsset where possible, but that _can_ be dynamic (i.e. raw asset) if you have
     * not already serialized.
     *
     * If displayAsset is provided, it will be used for template rendering (has display-friendly strings).
     * Otherwise staticAsset is used for both data extraction and templates.
     */
    const modelType = asset.__.wkrm.modelClassName;
    const graphId = asset.__.wkrm.graphId;
    const gc = this.resolveGraphConfig(graphId, modelType);

    let displayName: string = "(unknown)"; // TODO: translate
    if (await asset.$?.getName) {
      displayName = await asset.$.getName();
    }

    const wasmWrapper = asset.$.wasmWrapper;

    const geometryPath = gc.paths["geometry"] ?? DEFAULT_PREBUILD_PATHS.geometry;
    let geometry = null;
    try {
      const geoList = resolveIndexedPath(wasmWrapper, geometryPath);
      if (geoList.totalValues > 0) {
        geometry = Object.fromEntries(geoList.getValue(0)?.tileData);
      }
    } catch (e) {
      this.warningCollector?.debug("geometry path not found", `${displayName}: geometry path '${geometryPath}' not found: ${e}`);
    }

    const locationPath = gc.paths["location"] ?? DEFAULT_PREBUILD_PATHS.location;
    let location = null;
    try {
      const locList = resolveIndexedPath(wasmWrapper, locationPath);
      if (locList.totalValues > 0) {
        location = Object.fromEntries(locList.getValue(0)?.tileData);
      }
    } catch (e) {
      this.warningCollector?.debug("location path not found", `${displayName}: location path '${locationPath}' not found: ${e}`);
    }
    location = location || geometry;

    let polygon;
    if (location) {
      if (location["features"]) {
        const polygons = [];
        for (const feature of location["features"]) {
          if (feature?.geometry?.coordinates) {
            polygons.push(feature["geometry"]["coordinates"]);
          }
        }
        polygon = polygons.flat();
      } else if (location["coordinates"]) {
        polygon = location["coordinates"];
      }
    }
    if (polygon) {
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
    if (location && location["features"] && location["features"][0]) {
      location = location.features[0].geometry?.coordinates;
    } else if (location && location["coordinates"]) {
      location = location["coordinates"];
    } else {
      location = null;
    }

    const slug = asset.$.resource.resourceinstance?.descriptors?.slug
      || await this.slugGenerator.toSlug(displayName, asset, prefix);
    const meta = new Asset(
      staticAsset.id,
      graphId,
      geometry,
      location,
      displayName,
      slug,
      "",
      modelType,
      asset.$.resource.scopes || []
    );
    meta.meta["registries"] = "[]";

    const template = this.templateManager.getTemplateForGraph(graphId, modelType);
    if (!template) {
      throw Error(`No template found for graph ${graphId} (${modelType})`);
    }
    // Use displayAsset for templates if provided (has display-friendly strings),
    // otherwise fall back to staticAsset
    const templateData = displayAsset ?? staticAsset;

    const md = await template({ type: modelType, title: meta.meta.title, ha: templateData }, {
      allowProtoPropertiesByDefault: true,
      allowProtoMethodsByDefault: true,
    });
    const [indexOnly, description] = md.split('$$$');
    const plaintext = (await new Marked({ gfm: true })
      .use(markedPlaintify())
      .parse(indexOnly))
      .replace("\n", " ");
    if (gc.indexCharactersWarnOnly) {
      if (plaintext.length > gc.indexCharacters) {
        console.warn(`${slug}: ${displayName} has > ${gc.indexCharacters} characters - length ${plaintext.length}`);
      }
      meta.content = plaintext;
    } else {
      meta.content = plaintext.substring(0, gc.indexCharacters);
    }
    if (description) {
      meta.meta.rawContent = description;
    } else {
      meta.meta.rawContent = md;
    }
    meta.meta.resourceinstanceid = asset.$.resource.resourceinstance.resourceinstanceid;

    // Extract configured filters from node data
    for (const filterConfig of gc.filters) {
      let rawValue: any;
      if (filterConfig.dynamic) {
        // Dynamic filters use Rust path resolution for the graph portion,
        // then access ViewModel computed properties for the suffix.
        // Split at first segment that isn't a graph alias (e.g., "ancestors").
        const segments = filterConfig.path.replace(/^\./, '').split('.');
        let graphPrefix = '';
        let vmSuffix: string[] = [];
        // Try progressively shorter prefixes until getValuesAtPath succeeds
        for (let i = segments.length; i > 0; i--) {
          try {
            graphPrefix = segments.slice(0, i).join('.');
            wasmWrapper.getValuesAtPath(graphPrefix);
            vmSuffix = segments.slice(i);
            break;
          } catch {
            graphPrefix = '';
            continue;
          }
        }
        if (!graphPrefix) {
          this.warningCollector?.warn("dynamic filter had no valid graph prefix", `${displayName}: dynamic filter '${filterConfig.name}' — no valid graph prefix found in path '${filterConfig.path}'`);
        }
        if (graphPrefix) {
          const pseudoList = asset.$.getValuesAtPath(graphPrefix);
          const values: any[] = [];
          const allValues = pseudoList.getAllValues?.() ?? [];
          for (const pv of allValues) {
            let val = await pv.getValue();
            // Walk remaining ViewModel suffix
            for (const seg of vmSuffix) {
              if (val == null) break;
              if (seg === '*' && Array.isArray(val)) {
                // Expand array — flatten remaining suffix across all elements
                const rest = vmSuffix.slice(vmSuffix.indexOf(seg) + 1);
                const expanded = await Promise.all(val.map(async (v: any) => {
                  let r = await v;
                  for (const s of rest) { r = r?.[s]; r = await r; }
                  return r;
                }));
                val = expanded;
                vmSuffix = []; // consumed
                break;
              }
              val = val?.[seg];
              val = await val;
            }
            if (val != null) {
              if (Array.isArray(val)) {
                values.push(...val);
              } else {
                values.push(val);
              }
            }
          }
          rawValue = values.length === 1 ? values[0] : values.length > 0 ? values : null;
        }
      } else {
        // Non-dynamic filters: walk display-formatted JSON (zero FFI crossings)
        const source = displayAsset ?? staticAsset;
        rawValue = filterConfig.path.replace(/^\./, '').split('.').reduce(
          (v: any, k: string) => v?.[k], source
        );
      }
      let filterValue: string[];
      if (filterConfig.type === "array") {
        filterValue = Array.isArray(rawValue) ? rawValue : (rawValue ? [rawValue] : []);
      } else {
        filterValue = rawValue ? [rawValue] : [];
      }
      if (filterConfig.dynamic) {
        filterValue = filterValue.map(fv => fv && fv.toString());
      }
      meta.meta[filterConfig.name] = JSON.stringify(filterValue);
    }

    // Thumbnail extraction via Rust path resolution
    for (const thumbConfig of gc.thumbnail) {
      try {
        // Get thumbnail entries at the configured path + '.thumbnail'
        const thumbList = wasmWrapper.getValuesAtPath(thumbConfig.path + '._.thumbnail');
        const thumbValues = thumbList.getAllValues?.() ?? [];

        for (const thumbPv of thumbValues) {
          const td = thumbPv.tileData;
          const url = td?.url;
          const index = td?.file_id != null ? td?.index : undefined;
          if (url && Number.isInteger(index)) {
            meta.meta.thumbnailUrl = url;
            // Get alt_text from sibling — filter by parent tile
            try {
              const altList = wasmWrapper.getValuesAtPath(
                thumbConfig.path + '.alt_text',
                thumbPv.tileId
              );
              if (altList.totalValues > 0) {
                meta.meta.thumbnailAltText = altList.getValue(0)?.tileData || '';
              }
            } catch (e) {
              this.warningCollector?.debug("alt text path not found", `${displayName}: alt_text path not found for thumbnail: ${e}`);
            }
            break;
          }
        }
      } catch (e) {
        this.warningCollector?.warn("thumbnail path not found", `${displayName}: thumbnail path '${thumbConfig.path}' not found: ${e}`);
      }
    }
    return meta;
  }
}
