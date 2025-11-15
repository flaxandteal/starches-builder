import fs from "fs";
import path from "path";
import { reindex } from "../reindex.ts";
import { etl } from "../etl.ts";

export async function cli_index(definitions: string, preIndexDirectory: string, site: string) {
  const preIndexFiles: string[] = [];
  const walk = (dir: string): void => {
    fs.readdir(dir, (err: Error | null, files: string[]) => {
      if (err) {
        throw err;
      }
      files.forEach((file: string) => {
        const filePath = path.join(dir, file);
        if (file.startsWith(".")) return;
        fs.stat(filePath, (err: Error | null, stat: fs.Stats) => {
          if (err) {
            throw err;
          }
          if (stat.isDirectory()) {
            walk(filePath);
          } else if (stat.isFile() && path.extname(filePath).endsWith(".pi")) {
            console.log("Added", filePath, "from pre-index");
            preIndexFiles.push(filePath);
          }
        });
      });
    });
  };
  walk(preIndexDirectory);
  return reindex(preIndexFiles, definitions, site);
}

export async function cli_etl(resourceFile: string, resourcePrefix: string | undefined) {
  return etl(resourceFile, resourcePrefix);
}
