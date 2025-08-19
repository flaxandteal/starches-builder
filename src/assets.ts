import { staticTypes, interfaces } from 'alizarin';
import { slugify } from "./utils";
import { Asset, IAssetFunctions } from "./types";

class AssetFunctions implements IAssetFunctions {
  slugCounter: {[key: string]: number};
  permissions: {[key: string]: {[key: string]: boolean | string} | boolean}
  // Nodes to 
  permissionCollectionNodes: {[key: string]: {[alias: string]: staticTypes.StaticCollection | undefined}} = {
  };
  permissionFunctions: {[key: string]: interfaces.CheckPermission} = {
  }

  constructor() {
    this.slugCounter = {};
    this.permissions = {};
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
  }

  shouldIndex(_asset: Asset) {
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
    const modelType = asset.__.wkrm.modelClassName;
    let displayName: string = "(unknown)"; // TODO: translate
    if (await asset.$?.getName) {
      displayName = await asset.$.getName();
    }

    let geometryParent;
    let location = null;
    let geometry = null;
    if (
      ((staticAsset.__has && await staticAsset.__has('location_data')) || 'location_data' in staticAsset) &&
      (((await staticAsset.location_data).__has && (await staticAsset.location_data).__has('geometry')) || 'geometry' in staticAsset.location_data)
    ) {
      geometryParent = await staticAsset.location_data.geometry;
      if (!geometryParent) {
        console.warn("No geometry node for", staticAsset);
      } else {
        geometry = await staticAsset.location_data.geometry.geospatial_coordinates;
        location = geometry;

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
      }
      if (location && location["features"]) {
        location = location["features"][0]["geometry"]["coordinates"];
      } else {
        location = null;
      }
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
};

const assetFunctions = new AssetFunctions();

export { assetFunctions };
