import fs from "fs";
import Flatbush from "flatbush";
import { serialize as fgbSerialize } from 'flatgeobuf/lib/mjs/geojson.js';
import { IndexEntry } from "./types";
import { type FeatureCollection, type Feature } from "geojson";
import { reindexFgb } from "./native-reindex";

export async function buildFlatbush(locpairs: [IndexEntry, Feature][], outputDir: string, copyrightTerms?: string) {
    if (locpairs.length === 0) {
        console.warn("No locations found for Flatbush indexing");
        return;
    }
    const locations = locpairs.map((locpair: [IndexEntry, Feature]) => locpair[0]);
    const features = locpairs.map((locpair: [IndexEntry, Feature]) => locpair[1]);
    const geoJsonAll: FeatureCollection = {
      "type": "FeatureCollection",
      "features": features
    };
    fs.writeFileSync(
        `${outputDir}/fgb/nihed-assets-wo-index.fgb`,
        fgbSerialize(geoJsonAll)
    );

    // Re-index using WASM instead of external binary
    await reindexFgb(
        `${outputDir}/fgb/nihed-assets-wo-index.fgb`,
        `${outputDir}/fgb/nihed-assets.fgb`,
        'nihed-assets',
        copyrightTerms || "See site for copyright terms"
    );

    const flatbushIndex = new Flatbush(locations.length);
    locations.forEach((loc: IndexEntry) => {
        flatbushIndex.add(loc.loc[0], loc.loc[1], loc.loc[0], loc.loc[1])
    });
    flatbushIndex.finish();
    // Slow - move to preindex, or to ingestion.
    // const byCounty = groupByCounty(locations.map(loc => loc.loc));

    console.log(`Indexed ${locations.length} assets in flatbush`);

    fs.rmSync(`${outputDir}/flatbush.bin`, {force: true});
    fs.rmSync(`${outputDir}/flatbush.json`, {force: true});
    fs.rmSync(`${outputDir}/flatbushByCounty.json`, {force: true});
    fs.writeFileSync(
        `${outputDir}/flatbush.bin`,
        Buffer.from(flatbushIndex.data)
    );
    fs.writeFileSync(
        `${outputDir}/flatbush.json`,
        JSON.stringify(locations.map((loc: IndexEntry) => [loc.hash, loc.regcode]))
    );
    // fs.writeFileSync(
    //     `${PUBLIC_FOLDER}/flatbushByCounty.json`,
    //     JSON.stringify(byCounty)
    // );
}

