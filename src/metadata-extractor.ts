import { Marked } from 'marked'
import { getValueFromPath } from "alizarin/inline";
import markedPlaintify from 'marked-plaintify'
import { Asset, DEFAULT_PREBUILD_PATHS } from "./types";
import type { PrebuildConfiguration } from "./types";
import type { SlugGenerator } from "./slug-generator";
import { TemplateManager } from './templates';

export class MetadataExtractor {
  config?: PrebuildConfiguration;
  slugGenerator: SlugGenerator;
  templateManager: TemplateManager;

  constructor(slugGenerator: SlugGenerator, templateManager: TemplateManager) {
    this.slugGenerator = slugGenerator;
    this.templateManager = templateManager;
  }

  setConfig(config: PrebuildConfiguration) {
    this.config = config;
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
    let displayName: string = "(unknown)"; // TODO: translate
    if (await asset.$?.getName) {
      displayName = await asset.$.getName();
    }

    const geometryPath = this.config?.paths?.["geometry"] ?? DEFAULT_PREBUILD_PATHS.geometry;

    const geometry = await getValueFromPath(
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
      asset.$.resource.scopes || []
    );
    meta.meta["registries"] = "[]";

    const template = this.templateManager.getTemplate(modelType);
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
    const maxChars = this.config?.indexCharacters || 300;
    if (this.config?.indexCharactersWarnOnly) {
      if (plaintext.length > maxChars) {
        console.warn(`${slug}: ${displayName} has > ${maxChars} characters - length ${plaintext.length}`);
      }
      meta.content = plaintext;
    } else {
      meta.content = plaintext.substring(0, this.config?.indexCharacters || 300);
    }
    if (description) {
      meta.meta.rawContent = description;
    } else {
      meta.meta.rawContent = md;
    }
    meta.meta.resourceinstanceid = asset.$.resource.resourceinstance.resourceinstanceid;
      

    // Extract configured filters from node data
    if (this.config?.filters) {
      for (const filterConfig of this.config.filters) {
        if (filterConfig.graph === modelType) {
            const rawValue = await getValueFromPath(filterConfig.dynamic ? asset : displayAsset, filterConfig.path);
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
      }
    }

    // Thumbnail extraction
    if (this.config?.thumbnail) {
      for (const thumbConfig of this.config.thumbnail || []) {
        if (thumbConfig.graph === modelType || thumbConfig.graph === "*") {
          const thumbnailData = await getValueFromPath(asset, thumbConfig.path);
          const identifiers = thumbConfig.identifier || null;

          // Find first image whose name contains one of the identifiers
          for (const imageGroup of thumbnailData || []) {
            if (imageGroup._ && imageGroup._.thumbnail && imageGroup._.thumbnail[0]) {
              const url = await imageGroup._.thumbnail[0].url || await imageGroup[0].url;
              // If there is no index, this should not be shown.
              const index = await imageGroup._.thumbnail[0]._file.index;
              if (url && Number.isInteger(index)) {
                meta.meta.thumbnailUrl = url;
                meta.meta.thumbnailAltText = await imageGroup.alt_text || '';
                break;
              }
            }
          }
        }
      }
    }
    return meta;
  }
}
