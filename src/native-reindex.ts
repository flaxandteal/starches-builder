import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const require = createRequire(import.meta.url);

// Load native addon
const nativeAddon = require(join(__dirname, '../starches-builder.node'));

/**
 * Re-index a FlatGeobuf file by adding a spatial index
 * @param inputPath Path to the input FlatGeobuf file (without spatial index)
 * @param outputPath Path to write the output FlatGeobuf file (with spatial index)
 * @param name Name for the FlatGeobuf dataset
 * @param description Optional description for the dataset
 */
export async function reindexFgb(
  inputPath: string,
  outputPath: string,
  name: string = 'assets',
  description?: string
): Promise<void> {
  try {
    console.log(`Reindexing FlatGeobuf: ${inputPath} -> ${outputPath}`);

    // Call native addon
    nativeAddon.reindexFgb(
      inputPath,
      outputPath,
      name,
      description ?? undefined
    );

    console.log(`Successfully reindexed FlatGeobuf with spatial index`);
  } catch (error) {
    console.error(`FlatGeobuf reindex failed:`, error);
    throw error;
  }
}
