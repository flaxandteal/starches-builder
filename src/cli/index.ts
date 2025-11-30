import fs from "fs";
import path from "path";
import { reindex } from "../reindex.ts";
import { etl } from "../etl.ts";

export async function cli_index(definitions: string, preIndexDirectory: string, site: string, includePrivate: boolean) {
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
  return reindex(preIndexFiles, definitions, site, includePrivate);
}

export async function cli_etl(resourceFile: string, resourcePrefix: string | undefined, includePrivate: boolean, useTui: boolean = false) {
  return etl(resourceFile, resourcePrefix, includePrivate, useTui);
}
