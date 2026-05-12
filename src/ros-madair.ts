import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFileSync } from 'child_process';

interface BuildRosMadairOptions {
  businessDataDir: string;
  graphsDir: string;
  outputDir: string;
  bin: string;
  baseUri?: string;
  /** Explicit business data file paths. If provided, only these files are read (businessDataDir is ignored). */
  files?: string[];
  /** Directory containing SKOS reference data (collections, concepts). Symlinked into the staging area. */
  referenceDataDir?: string;
}

/**
 * Build a Rós Madair SPARQL index from the filtered business_data files
 * produced by the ETL. The business_data JSONs already have permission
 * filtering applied (via alizarin WASM), so the resulting index inherits
 * the same permission boundaries.
 */
export async function buildRosMadairIndex(opts: BuildRosMadairOptions): Promise<void> {
  const { businessDataDir, graphsDir, outputDir, bin, baseUri, files: explicitFiles, referenceDataDir } = opts;

  // Resolve the list of JSON files to process
  let filePaths: string[];
  if (explicitFiles && explicitFiles.length > 0) {
    filePaths = explicitFiles.map(f => path.resolve(f));
  } else {
    const dirEntries = await fs.promises.readdir(businessDataDir);
    filePaths = dirEntries
      .filter(f => f.endsWith('.json') && !f.startsWith('_'))
      .map(f => path.join(businessDataDir, f));
  }

  if (filePaths.length === 0) {
    console.warn('[ros-madair] No business_data JSON files found — skipping index build.');
    return;
  }

  // Group resources by graph_id
  const byGraph: Record<string, any[]> = {};
  for (const filePath of filePaths) {
    const content = await fs.promises.readFile(filePath, 'utf-8');
    let resource: any;
    try {
      resource = JSON.parse(content);
    } catch (e) {
      console.warn(`[ros-madair] Failed to parse ${filePath}: ${e}`);
      continue;
    }

    // ETL writes StaticResource format: { resourceinstance: { graph_id, ... }, tiles: [...] }
    const graphId = resource.resourceinstance?.graph_id;
    if (!graphId) {
      console.warn(`[ros-madair] No graph_id found in ${filePath} — skipping.`);
      continue;
    }

    if (!byGraph[graphId]) {
      byGraph[graphId] = [];
    }
    byGraph[graphId].push(resource);
  }

  const graphCount = Object.keys(byGraph).length;
  const totalResources = Object.values(byGraph).reduce((sum, arr) => sum + arr.length, 0);
  console.log(`[ros-madair] ${totalResources} resources across ${graphCount} graphs`);

  // Create temp prebuild directory matching the layout build_from_prebuild expects:
  //   tmpdir/graphs/resource_models/*.json   (symlinked from real prebuild)
  //   tmpdir/business_data/<graph_id>.json   (grouped resources)
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ros-madair-'));

  try {
    // Symlink the graph definitions (schema is unaffected by permissions)
    const tmpGraphsDir = path.join(tmpDir, 'graphs', 'resource_models');
    await fs.promises.mkdir(tmpGraphsDir, { recursive: true });

    const absGraphsDir = path.resolve(graphsDir);
    const graphFiles = await fs.promises.readdir(absGraphsDir);
    for (const gf of graphFiles) {
      if (gf.endsWith('.json')) {
        await fs.promises.symlink(
          path.join(absGraphsDir, gf),
          path.join(tmpGraphsDir, gf),
        );
      }
    }

    // Symlink reference_data so the binary can find SKOS collections/concepts
    if (referenceDataDir) {
      const absRefDir = path.resolve(referenceDataDir);
      if (fs.existsSync(absRefDir)) {
        await fs.promises.symlink(absRefDir, path.join(tmpDir, 'reference_data'));
      }
    }

    // Write prebuild-format business_data files (one per graph)
    const tmpBdDir = path.join(tmpDir, 'business_data');
    await fs.promises.mkdir(tmpBdDir, { recursive: true });

    for (const [graphId, resources] of Object.entries(byGraph)) {
      const prebuildJson = {
        business_data: {
          resources,
        },
      };
      await fs.promises.writeFile(
        path.join(tmpBdDir, `${graphId}.json`),
        JSON.stringify(prebuildJson),
      );
    }

    // Ensure output directory exists
    await fs.promises.mkdir(outputDir, { recursive: true });

    // Shell out to ros-madair-build
    // Args: <prebuild_dir> <output_dir> [page_size] [base_uri]
    const args = [tmpDir, outputDir];
    if (baseUri) {
      args.push('2000', baseUri);  // page_size is positional, must be provided to reach base_uri
    }
    console.log(`[ros-madair] Running: ${bin} ${args.join(' ')}`);
    execFileSync(bin, args, { stdio: 'inherit' });
  } finally {
    // Cleanup temp directory
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}
