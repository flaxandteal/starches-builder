import * as path from 'path';

/**
 * Centralized configuration for paths and constants
 */

// Batch processing constants
export const BATCH_SIZE = 25;
export const CHUNK_SIZE_CHARS = 10_000_000; // 10MB chunks for business data

// Slug configuration
export const MAX_SLUG_LENGTH = 100;
export const LEGACY_SLUG_LENGTH = 20; // For backward compatibility

// Default language
export const DEFAULT_LANGUAGE = "en";

// Directory structure
export interface PathConfig {
  prebuildDir: string;
  outputDir: string;
  graphsDir: string;
  resourceModelsDir: string;
  branchesDir: string;
  referenceDataDir: string;
  collectionsDir: string;
  businessDataDir: string;
  fgbDir: string;
  preindexDir: string;
}

/**
 * Get path configuration for a given base directory
 */
export function getPathConfig(baseDir: string = '.'): PathConfig {
  const prebuildDir = path.join(baseDir, 'prebuild');
  const outputDir = process.env.OUTPUT_DIR || path.join(baseDir, 'public');

  return {
    prebuildDir,
    outputDir,
    graphsDir: path.join(prebuildDir, 'graphs'),
    resourceModelsDir: path.join(prebuildDir, 'graphs', 'resource_models'),
    branchesDir: path.join(prebuildDir, 'graphs', 'branches'),
    referenceDataDir: path.join(prebuildDir, 'reference_data'),
    collectionsDir: path.join(prebuildDir, 'reference_data', 'collections'),
    businessDataDir: path.join(outputDir, 'definitions', 'business_data'),
    fgbDir: path.join(outputDir, 'fgb'),
    preindexDir: path.join(prebuildDir, 'preindex'),
  };
}

/**
 * Get output path configuration
 */
export function getOutputPathConfig(outputDir: string): {
  definitionsDir: string;
  graphsOutputDir: string;
  resourceModelsOutputDir: string;
  branchesOutputDir: string;
  referenceDataOutputDir: string;
  collectionsOutputDir: string;
  businessDataOutputDir: string;
  fgbOutputDir: string;
  pagefindDir: string;
} {
  const definitionsDir = path.join(outputDir, 'definitions');
  const graphsOutputDir = path.join(definitionsDir, 'graphs');

  return {
    definitionsDir,
    graphsOutputDir,
    resourceModelsOutputDir: path.join(graphsOutputDir, 'resource_models'),
    branchesOutputDir: path.join(graphsOutputDir, 'branches'),
    referenceDataOutputDir: path.join(definitionsDir, 'reference_data'),
    collectionsOutputDir: path.join(definitionsDir, 'reference_data', 'collections'),
    businessDataOutputDir: path.join(definitionsDir, 'business_data'),
    fgbOutputDir: path.join(outputDir, 'fgb'),
    pagefindDir: path.join(outputDir, 'pagefind'),
  };
}

// Public models allowed for export (when not in private mode)
export const PUBLIC_MODELS = [
  "HeritageAsset",
  "Person",
  "Organization",
  "Event"
];

// Arches compatibility flag
export const FOR_ARCHES = process.env.FOR_ARCHES === 'true';
