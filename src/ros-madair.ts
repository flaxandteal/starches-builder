import * as fs from 'fs';
import { execFileSync } from 'child_process';

interface BuildRosMadairOptions {
  /** Prebuild-layout directory (graphs/, business_data/, reference_data/). */
  prebuildDir: string;
  outputDir: string;
  bin: string;
  baseUri?: string;
}

/**
 * Build a Rós Madair SPARQL index from a prebuild-layout directory.
 *
 * The ETL's `index` step writes a complete prebuild layout to
 * `docs/definitions/` (graphs, business_data, reference_data), so
 * we just point the Rust binary straight at it.
 */
export async function buildRosMadairIndex(opts: BuildRosMadairOptions): Promise<void> {
  const { prebuildDir, outputDir, bin, baseUri } = opts;

  if (!fs.existsSync(prebuildDir)) {
    console.warn(`[ros-madair] Prebuild dir not found: ${prebuildDir} — skipping.`);
    return;
  }

  await fs.promises.mkdir(outputDir, { recursive: true });

  const args = [prebuildDir, outputDir];
  if (baseUri) {
    args.push('2000', baseUri);
  }
  console.log(`[ros-madair] Running: ${bin} ${args.join(' ')}`);
  execFileSync(bin, args, { stdio: 'inherit' });
}
