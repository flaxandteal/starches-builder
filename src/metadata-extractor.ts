import { getValueFromPath } from "./utils";
import { Asset, DEFAULT_PREBUILD_PATHS } from "./types";
import type { PrebuildConfiguration } from "./types";
import type { SlugGenerator } from "./slug-generator";

export class MetadataExtractor {
  config?: PrebuildConfiguration;
  slugGenerator: SlugGenerator;

  constructor(slugGenerator: SlugGenerator) {
    this.slugGenerator = slugGenerator;
  }

  setConfig(config: PrebuildConfiguration) {
    this.config = config;
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

    const geometryPath = this.config?.paths?.["geometry"] ?? DEFAULT_PREBUILD_PATHS.geometry;

    let geometry = await getValueFromPath(
      staticAsset,
      geometryPath
    );

    let location = await getValueFromPath(
      staticAsset,
      this.config?.paths?.["location"] ?? DEFAULT_PREBUILD_PATHS.location
    ) || geometry;

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

    const slug = await this.slugGenerator.toSlug(displayName, asset, prefix);
    const graphId = asset.__.wkrm.graphId;
    const meta = new Asset(
      staticAsset.id,
      graphId,
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

    // Extract configured filters from node data
    if (this.config?.filters) {
      for (const [filterName, filterConfig] of Object.entries(this.config.filters)) {
        console.log("Extracting filter", filterName, "using path", filterConfig.path);
        const rawValue = await getValueFromPath(staticAsset, filterConfig.path);
        let filterValue: string[];

        if (filterConfig.type === "array") {
          // Value is already an array (or should be)
          filterValue = Array.isArray(rawValue) ? rawValue : (rawValue ? [rawValue] : []);
        } else {
          // Single value - wrap in array for consistent handling
          filterValue = rawValue ? [rawValue] : [];
        }

        meta.meta[filterName] = JSON.stringify(filterValue);
      }
    }

    return meta;
  }
}
