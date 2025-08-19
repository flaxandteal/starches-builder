import fs from "fs";
import * as pagefind from "pagefind";
import { slugify, PUBLIC_MODELS, DEFAULT_LANGUAGE, REGISTRIES } from "./utils";

export async function buildPagefind(files: string[] | null, publicFolder: string, includePrivate: boolean = false) {
    const { index } = await pagefind.createIndex();
    if (!index) {
      throw Error("Could not create pagefind index");
    }
    await index.addDirectory({
        path: publicFolder
    });
    console.log("loading", files ? `${files.length} files` : 'all');
    const loadedFiles = files ? files : await fs.promises.readdir('prebuild/preindex').then(
      (files) => files.filter(f => f.endsWith('.pi')).map(f => `prebuild/preindex/${f}`)
    );
    const assetMetadata = (await Promise.all(
      loadedFiles.map(
        f => fs.promises.readFile(f)
      ).map(
        async f => JSON.parse((await f).toString())
      ))).flat();
    console.log("loaded", assetMetadata.length);

    const language = DEFAULT_LANGUAGE ?? "en";
    const registriesSet: Set<string> = new Set();
    let recordCount = 0;
    for (const asset of assetMetadata) {
        if (includePrivate || PUBLIC_MODELS.includes(asset.type)) {
            const registries = asset.meta.registries ? JSON.parse(asset.meta.registries) : [];
            for (const registry of registries) {
                registriesSet.add(registry);
            }
            const designations = asset.meta.designations ? JSON.parse(asset.meta.designations) : [];
            // const regcode = registriesToRegcode(registries);
            await index.addCustomRecord({
                url: `/asset/?slug=${asset.meta.slug}`,
                // Only taking a bit of the plaintext for now... RMV
                content: asset.content,
                language: language,
                // regcode: regcode, TODO
                filters: {
                    tags: registries,
                    designations: designations
                },
                meta: asset.meta
            });
            recordCount += 1;
        }
    }
    for (const registry of registriesSet) {
        const slug = slugify(registry);
        if (!REGISTRIES.includes(slug)) {
            REGISTRIES.push(slug);
        }
    }

    console.log(`Indexed ${recordCount} assets in pagefind`);

    await fs.promises.rm(`${publicFolder}/pagefind`, { recursive: true, force: true });
    await index.writeFiles({
        outputPath: `${publicFolder}/pagefind`
    });

    return { index, assetMetadata };
}
