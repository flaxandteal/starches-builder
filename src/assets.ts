import { Asset, ModelEntry } from "./types";
import type { IAssetFunctions, GraphConfiguration, PrebuildConfiguration } from "./types";
import { GraphManager } from 'alizarin';
import { safeJsonParseFile } from './safe-utils';
import { PermissionManager } from './permissions';
import { TemplateManager } from './templates';
import { SlugGenerator } from './slug-generator';
import { MetadataExtractor } from './metadata-extractor';
import { ResourceLoader } from './resource-loader';

class AssetFunctions implements IAssetFunctions {
  config?: PrebuildConfiguration;
  graphs?: GraphConfiguration;

  // Composed managers
  private permissionManager: PermissionManager;
  private templateManager: TemplateManager;
  private slugGenerator: SlugGenerator;
  private metadataExtractor: MetadataExtractor;
  private resourceLoader: ResourceLoader;

  constructor() {
    this.permissionManager = new PermissionManager();
    this.templateManager = new TemplateManager();
    this.slugGenerator = new SlugGenerator();
    this.metadataExtractor = new MetadataExtractor(this.slugGenerator);
    this.resourceLoader = new ResourceLoader(this.permissionManager);
  }

  getPermittedNodegroups(modelName: string) {
    return this.permissionManager.getPermittedNodegroups(modelName);
  }

  async initialize() {
    this.config = await safeJsonParseFile<PrebuildConfiguration>("prebuild/prebuild.json");
    this.graphs = await safeJsonParseFile<GraphConfiguration>("prebuild/graphs.json");

    const permissions = await safeJsonParseFile(
      this.config.permissionsFile || 'prebuild/permissions.json'
    );
    this.permissionManager.setPermissions(permissions);

    await this.templateManager.initialize(this.config);
    this.metadataExtractor.setConfig(this.config);
  }

  shouldIndex(_asset: Asset, _includePrivate: boolean = false) {
    return true;
  }

  async toSlug(title: string, staticAsset: any, prefix: string | undefined): Promise<string> {
    return this.slugGenerator.toSlug(title, staticAsset, prefix);
  }

  async getMeta(asset: any, staticAsset: any, prefix: string | undefined, includePrivate: boolean): Promise<Asset> {
    return this.metadataExtractor.getMeta(asset, staticAsset, prefix, includePrivate);
  }

  async getAllFrom(graphManager: GraphManager, filename: string, includePrivate: boolean) {
    return this.resourceLoader.getAllFrom(graphManager, filename, includePrivate, this.getModelFiles());
  }

  getModelFiles(): {[key: string]: ModelEntry} {
    return (this.graphs || {}).models || {};
  }
}

const assetFunctions = new AssetFunctions();

export { assetFunctions };
