import fs from "fs";
import path from "path";
import { reindex } from "../reindex.ts";
import { etl } from "../etl.ts";
import { precompileTemplates } from "../precompile-templates.ts";
import { buildRosMadairIndex } from "../ros-madair.ts";

export async function cli_index(definitions: string, preIndexDirectory: string, site: string, includePrivate: boolean, minify: boolean) {
  const preIndexFiles: string[] = [];

  const walk = async (dir: string): Promise<void> => {
    const files = await fs.promises.readdir(dir);
    await Promise.all(files.map(async (file: string) => {
      if (file.startsWith(".")) return;
      const filePath = path.join(dir, file);
      const stat = await fs.promises.stat(filePath);

      if (stat.isDirectory()) {
        await walk(filePath);
      } else if (stat.isFile() && path.extname(filePath).endsWith(".pi")) {
        console.log("Added", filePath, "from pre-index");
        preIndexFiles.push(filePath);
      }
    }));
  };

  await walk(preIndexDirectory);
  return reindex(preIndexFiles, definitions, site, includePrivate, minify);
}

export async function cli_etl(resourceFile: string, resourcePrefix: string | undefined, includePrivate: boolean, useTui: boolean = false, lazy: boolean = false, summary: boolean = false, verbose: boolean = false, minify: boolean = false, buildRosMadair: boolean = false, rosMadairBin: string = "build_from_prebuild", rosMadairOutput: string = "docs/static/ros-madair") {
  return etl(resourceFile, resourcePrefix, includePrivate, useTui, lazy, summary, verbose, minify, buildRosMadair, rosMadairBin, rosMadairOutput);
}

export async function cli_precompile() {
  return precompileTemplates();
}

export async function cli_build_ros_madair(businessDataDir: string, graphsDir: string, outputDir: string, bin: string) {
  return buildRosMadairIndex({ businessDataDir, graphsDir, outputDir, bin });
}
