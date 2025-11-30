import Handlebars from 'handlebars';
import fs from "fs";
import type { PrebuildConfiguration } from "./types";

export class TemplateManager {
  templates: {[key: string]: HandlebarsTemplateDelegate<any>} = {};

  async initialize(config: PrebuildConfiguration) {
    const templates = await Promise.all(Object.entries(config.indexTemplates).map(
      async ([mdl, file]: [string, string]): Promise<[string, HandlebarsTemplateDelegate<any>]> => {
        let template = await fs.promises.readFile(`prebuild/indexTemplates/${file}`, { encoding: "utf8" })
        return [
          mdl,
          Handlebars.compile(template)
        ];
      }
    ));
    this.templates = Object.fromEntries(templates);
  }

  getTemplate(modelType: string): HandlebarsTemplateDelegate<any> | undefined {
    return this.templates[modelType];
  }
}
