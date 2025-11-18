import fs from "fs";
import path from "path";
import * as pagefind from "pagefind";
import { serialize as fgbSerialize } from 'flatgeobuf/lib/mjs/geojson.js';
import { type FeatureCollection, type Feature } from "geojson";
import { WKRM, ResourceModelWrapper, staticTypes } from 'alizarin';

import { IndexEntry } from "./types";
import { getLocations } from "./locations";
import { buildPagefind } from "./pagefind";
import { buildFlatbush } from "./flatbush";
import { Asset } from "./types";
import { registriesToRegcode } from "./utils";
import { FOR_ARCHES, CHUNK_SIZE_CHARS, PUBLIC_MODELS } from "./config";
import { safeJsonParseFile, safeJsonParseFileSync, slugify, safeJoinPath } from "./safe-utils";
import { assetFunctions } from "./assets";

interface GraphInfo {
    type: string;
    filepath: string;
    graph: staticTypes.StaticGraph;
    location: string;
}

/**
 * Load graph definitions from the definitions directory
 */
async function loadGraphsFromDefinitions(definitionsDir: string, outputDir: string): Promise<GraphInfo[]> {
    const destination = `${outputDir}/definitions`;
    const dir: [string, string][] = [
        ['models', path.join(definitionsDir, 'graphs', 'resource_models')],
    ];
    if (FOR_ARCHES) {
        dir.push(['branches', path.join(definitionsDir, 'graphs', 'branches')]);
    }

    const graphs: GraphInfo[] = [];
    for (const [type, location] of dir) {
        for (const filename of (await fs.promises.readdir(location))) {
            if (!filename.endsWith('json') || filename.startsWith('_')) {
                continue;
            }
            const filePath = `${location}/${filename}`;
            const graphData = await safeJsonParseFile<{ graph: any[] }>(filePath);

            if (!graphData.graph || !Array.isArray(graphData.graph)) {
                throw new Error(`Invalid graph file ${filePath}: missing or invalid 'graph' array`);
            }
            if (graphData.graph.length !== 1) {
                throw new Error(`Invalid graph file ${filePath}: expected exactly 1 graph element, found ${graphData.graph.length}`);
            }

            const graph = graphData.graph[0];

            graphs.push({
                type: type,
                filepath: filePath,
                graph: new staticTypes.StaticGraph(graph),
                location: location
            });
        }
        const target = `${destination}/graphs/${path.basename(location)}`;
        await fs.promises.rm(target, {recursive: true, force: true});
        await fs.promises.mkdir(target, {"recursive": true});
    }

    return graphs;
}

/**
 * Build metadata object from graph
 */
function buildGraphMetadata(graph: any): staticTypes.StaticGraphMeta {
    return {
        author: graph["author"],
        cards: graph["cards"].length,
        cards_x_nodes_x_widgets: graph["cards_x_nodes_x_widgets"].length,
        color: graph["color"],
        config: graph["config"],
        deploymentdate: graph["deploymentdate"],
        deploymentfile: graph["deploymentfile"],
        functions_x_graphs: (graph["functions_x_graphs"] ?? []).length,
        description: graph["description"],
        edges: graph["edges"].length,
        graphid: graph["graphid"],
        iconclass: graph["iconclass"],
        is_editable: graph["is_editable"],
        isresource: graph["isresource"],
        jsonldcontext: graph["jsonldcontext"],
        name: graph["name"],
        nodegroups: graph["nodegroups"].length,
        nodes: graph["nodes"].length,
        ontology_id: graph["ontology_id"],
        publication: graph["publication"],
        relatable_resource_model_ids: graph["relatable_resource_model_ids"],
        resource_2_resource_constraints: graph["resource_2_resource_constraints"],
        root: graph["root"],
        slug: graph["slug"],
        subtitle: graph["subtitle"],
        template_id: graph["template_id"],
        version: graph["version"]
    };
}

/**
 * Process graphs with permission filtering and pruning
 */
async function processGraphs(
    graphs: GraphInfo[],
    destination: string,
    includePrivate: boolean
): Promise<{
    models: ResourceModelWrapper<any>[],
    branches: Set<string>,
    branchesFound: Set<string>,
    allMeta: {[k: string]: {[k2: string]: staticTypes.StaticGraphMeta}}
}> {
    const models: ResourceModelWrapper<any>[] = [];
    const branches: Set<string> = new Set();
    const branchesFound: Set<string> = new Set();
    const all: {[k: string]: {[k2: string]: staticTypes.StaticGraphMeta}} = {"models": {}};

    for (const {type, filepath, graph, location} of graphs) {
        const target = `${destination}/graphs/${path.basename(location)}`;
        const filename = path.basename(filepath);
        const wkrm = new WKRM(graph);
        const rmw = new ResourceModelWrapper(wkrm, graph, undefined);
        let publicationId;

        if (!includePrivate) {
            switch (type.toString()) {
                case 'models':
                    if (!PUBLIC_MODELS.includes(wkrm.modelClassName)) {
                        continue;
                    }
                    break;
                case 'branches':
                    publicationId = graph.publication.publicationid;
                    if (!publicationId) {
                        console.warn("Branch", filename, "has no publication ID");
                    }
                    if (!branches.has(publicationId)) {
                        continue;
                    }
                    branchesFound.add(publicationId);
                    break;
                default:
                    throw Error(`Unknown graph type: ${type}`);
            }
        } else {
            console.warn("Building NON-PUBLIC reindex so including", type, wkrm.modelClassName);
        }

        const meta: staticTypes.StaticGraphMeta = buildGraphMetadata(graph);

        if (includePrivate || type == "branches") {
            // This does not require node filtering.
        } else {
            const ngs = assetFunctions.getPermittedNodegroups(wkrm.modelClassName);
            if (!ngs) {
                console.warn("Not exporting", wkrm.modelClassName, "as no nodes available");
                continue;
            }
            rmw.setPermittedNodegroups(ngs);
        }

        rmw.pruneGraph(["e7362891-3b9a-46a9-a39d-2f03222771c4", "60000000-0000-0000-0000-000000000001"]);
        const prunedGraph = rmw.graph.copy();
        console.log("Loaded graph", target, filename);
        await fs.promises.writeFile(`${target}/${filename}`, JSON.stringify({
            graph: [prunedGraph],
            __scope: ['public']
        }, undefined, 2));

        if (type === "models") {
            models.push(rmw);
            all["models"][meta.graphid] = meta;
        }
        rmw.getBranchPublicationIds().forEach((branchId: string) => branchId && branches.add(branchId));
    }

    return { models, branches, branchesFound, allMeta: all };
}

/**
 * Copy reference data collections to output directory
 */
async function copyReferenceData(
    models: ResourceModelWrapper<any>[],
    outputDir: string,
    includePrivate: boolean
): Promise<void> {
    const collections = 'prebuild/reference_data/collections';

    await fs.promises.rm(`${outputDir}/definitions/reference_data`, {recursive: true, force: true});
    await fs.promises.mkdir(`${outputDir}/definitions/reference_data/collections`, {"recursive": true});

    if (includePrivate && !FOR_ARCHES) {
        console.warn("Running without --include-xml as a NON-PUBLIC build, so including even unused collections");
        fs.cpSync(collections, `${outputDir}/definitions/reference_data/collections`, {recursive: true, dereference: true});
    } else {
        const xmls: {[key: string]: Set<string>} = {
            concepts: new Set(),
            collections: new Set()
        };
        const collectionCount = (await Promise.all(models.map((model: ResourceModelWrapper<any>) => {
            return model.getCollections(true).map(async (collectionId: string) => {
                const collectionFile = `${collections}/${collectionId}.json`;
                const collection = await safeJsonParseFile(collectionFile);
                if (FOR_ARCHES && collection.__source) {
                    const collectionSource = collection.__source.collection;
                    xmls.collections.add(collectionSource);
                    collection.__source = {
                        collection: path.basename(collectionSource),
                        concepts: [...collection.__source.concepts].map((s: string) => {
                            xmls.concepts.add(s);
                            return path.basename(s);
                        })
                    };
                }
                return fs.promises.writeFile(
                    `${outputDir}/definitions/reference_data/collections/${collectionId}.json`,
                    JSON.stringify(collection, undefined, 2),
                );
            });
        }).flat())).length;

        if (includePrivate && FOR_ARCHES) {
            console.warn(`Running with --for-arches, so only copying the (${collectionCount}) referenced collections, included in used graphs`);
        } else {
            console.warn(`Building for PUBLIC, only including (${collectionCount}) referenced collections, but these are not essential, as required values should be cached`);
        }

        for (const [type, xmlSet] of Object.entries(xmls)) {
            await fs.promises.mkdir(`${outputDir}/definitions/reference_data/${type}`, {"recursive": true});
            await Promise.all([...xmlSet].map(async (xml: string): Promise<void> => {
                const xmlName = path.basename(xml);
                const xmlPath = path.join(collections, xml);
                if (!fs.existsSync(xmlPath)) {
                    console.log("Referenced", type, "missing, assuming in an upstream repo:", xml);
                } else {
                    fs.cpSync(xmlPath, `${outputDir}/definitions/reference_data/${type}/${xmlName}`);
                }
            }));
        }
    }
}

/**
 * Generate Arches business data files (chunked by model)
 */
async function generateArchesBusinessData(
    assetMetadata: Asset[],
    models: ResourceModelWrapper<any>[],
    outputDir: string
): Promise<void> {
    await fs.promises.mkdir(`${outputDir}/definitions/business_data`, {"recursive": true});
    const modelFileLengths: Map<string, number> = new Map();
    const modelBusinessData = new Map();
    const modelNames = new Map(models.map(rmw => {
        return [
            rmw.wkrm.graphId,
            rmw.wkrm.modelClassName
        ];
    }));
    const resources = await Promise.all(assetMetadata.map(async (asset) => {
        const businessDataDir = 'docs/definitions/business_data';
        const resourceFile = safeJoinPath(businessDataDir, `${asset.slug}.json`);
        if (!fs.existsSync(resourceFile)) {
            console.warn("Missing resource file", resourceFile, "referenced in metadata");
            return [0, undefined];
        }
        const content = await fs.promises.readFile(resourceFile, 'utf-8');
        const resource = await safeJsonParseFile(resourceFile);
        return [content.length, resource];
    }));
    for (const [contentLength, resource] of resources) {
        if (!resource) {
            continue;
        }
        const end = (modelFileLengths.get(resource.resourceinstance.graph_id) || 0) + (contentLength as number);
        modelFileLengths.set(resource.resourceinstance.graph_id, end);
        const chunk = Math.floor(end / CHUNK_SIZE_CHARS);
        let resourceFile = modelBusinessData.get(`${resource.resourceinstance.graph_id}:${chunk}`);
        if (resourceFile === undefined) {
            resourceFile = {
                business_data: {resources: []}
            }
            modelBusinessData.set(`${resource.resourceinstance.graph_id}:${chunk}`, resourceFile);
        }
        resourceFile.business_data.resources.push(resource);
    }
    await Promise.all([...modelBusinessData].map(([code, businessData]) => {
        const [graphId, chunk] = code.split(':');
        if (businessData.business_data.resources.length === 0) {
            return;
        }
        const modelName = modelNames.get(graphId);
        if (!modelName) {
            console.warn("Found business data for unknown model", graphId);
            return;
        }
        return fs.promises.writeFile(`${outputDir}/definitions/business_data/${modelName}_${chunk}.json`, `
            {
                "business_data": {
                    "resources": [
                        ${businessData.business_data.resources.map((res: any) => JSON.stringify(res)).join(",\n")}
                    ]
                }
            }
        `);
    }));
}

/**
 * Generate FlatGeoBuf files for non-Arches mode
 */
async function generateFlatGeoBuf(
    outputDir: string,
    locations: [IndexEntry, Feature][]
): Promise<void> {
    let fgbFiles: {[key: string]: any} = {};
    fgbFiles = (await Promise.all(
      (await fs.promises.readdir('prebuild/fgb').then(
        (files) => files.filter(f => f.endsWith('.json'))
      ))
    )).reduce((acc, file) => {
        const [registry, _] = file.split('---');
        acc[registry] = acc[registry] || [];
        acc[registry].push(file);
        return acc;
    }, fgbFiles);
    await fs.promises.mkdir(`${outputDir}/fgb`, {"recursive": true});
    const registries: {[key: string]: number} = {};
    for (const [registry, filenames] of Object.entries(fgbFiles)) {
        const regcode = registriesToRegcode([registry]);
        registries[registry] = regcode;
        const points = filenames.reduce((acc: string[], filename: string) => {
            const filePath = `prebuild/fgb/${filename}`;
            const filePoints = safeJsonParseFileSync<string[]>(filePath);
            return [...acc, ...filePoints];
        }, []);
        const geoJson: FeatureCollection = {
          "type": "FeatureCollection",
          "features": [{
            "type": "Feature",
            "properties": {
              "registry": registry,
              "regcode": regcode
            },
            "geometry": {
              "type": "MultiPoint",
              "coordinates": points
            }
          }]
        };
        fs.writeFileSync(
            `${outputDir}/fgb/${registry}.fgb`,
            fgbSerialize(geoJson)
        );
    }
    fs.writeFileSync(
        `${outputDir}/fgb/index.json`,
        JSON.stringify(registries)
    );

    await buildFlatbush(locations, outputDir);
}

/**
 * Check and report missing branches
 */
function checkMissingBranches(branches: Set<string>, branchesFound: Set<string>): void {
    const missingBranches = [...branches].filter(pubId => !branchesFound.has(pubId));
    if (missingBranches.length) {
        console.log("Branches missing (publication IDs):", ...missingBranches);
    }
}

/**
 * Main reindex function - coordinates the entire indexing process
 */
export async function reindex(
    files: string[] | null,
    definitionsDir: string,
    outputDir: string,
    includePrivate: boolean = false
): Promise<void> {
    // 1. Build search index and get locations
    const { index, assetMetadata } = await buildPagefind(files, outputDir, includePrivate);
    const locations = assetMetadata.length > 0
        ? await getLocations(index, assetMetadata, includePrivate)
        : [];

    if (assetMetadata.length === 0) {
        console.warn("No asset metadata was found");
    }

    // 2. Load and prepare graphs
    const graphs = await loadGraphsFromDefinitions(definitionsDir, outputDir);
    await assetFunctions.initialize();

    // 3. Process graphs with permissions
    const { models, branches, branchesFound, allMeta } = await processGraphs(
        graphs,
        `${outputDir}/definitions`,
        includePrivate
    );

    // 4. Write graph metadata
    await fs.promises.writeFile(
        `${outputDir}/definitions/graphs/_all.json`,
        JSON.stringify(allMeta, null, 2)
    );

    // 5. Copy reference data
    await copyReferenceData(models, outputDir, includePrivate);

    // 6. Generate format-specific outputs
    if (FOR_ARCHES) {
        await generateArchesBusinessData(assetMetadata, models, outputDir);
        checkMissingBranches(branches, branchesFound);
    } else {
        await generateFlatGeoBuf(outputDir, locations);
    }
}
