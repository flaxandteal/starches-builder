import fs from "fs";
import path from "path";
import { reindex } from "../reindex.ts";

export async function cli_index(definitions: string, site: string) {
  const resourceFiles: string[] = [];
  const resources = path.join(definitions, "business_data");
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
          } else if (stat.isFile() && path.extname(filePath) === ".json") {
            resourceFiles.push(filePath);
          }
        });
      });
    });
  };
  walk(resources);
  return reindex(resourceFiles, definitions, site);
}
