import Handlebars from 'handlebars';
import fs from "fs";
import { registerHandlebarsHelpers } from "./utils";
import type { PrebuildConfiguration } from "./types";

export class TemplateManager {
  config?: PrebuildConfiguration;
  templates: {[key: string]: HandlebarsTemplateDelegate<any>} = {};
  // Cache for per-graph template overrides (keyed by graphId)
  private graphTemplateCache: {[graphId: string]: HandlebarsTemplateDelegate<any>} = {};

  async initialize(config: PrebuildConfiguration) {
    this.config = config;
    registerHandlebarsHelpers();
    const templates = await Promise.all(Object.entries(config.indexTemplates).map(
      async ([mdl, file]: [string, string]): Promise<[string, HandlebarsTemplateDelegate<any>]> => {
        const template = await fs.promises.readFile(`prebuild/indexTemplates/${file}`, { encoding: "utf8" })
        return [
          mdl,
          Handlebars.compile(template)
        ];
      }
    ));
    this.templates = Object.fromEntries(templates);
  }

  getTemplate(modelType: string): HandlebarsTemplateDelegate<any> | undefined {
    return this.templates[modelType] || this.templates["_unknown"];
  }

  getTemplateForGraph(graphId: string, modelType: string): HandlebarsTemplateDelegate<any> | undefined {
    const overrideFile = this.config?.graphSettings?.[graphId]?.indexTemplate;
    if (!overrideFile) {
      return this.getTemplate(modelType);
    }
    if (!this.graphTemplateCache[graphId]) {
      const templateSource = fs.readFileSync(`prebuild/indexTemplates/${overrideFile}`, { encoding: "utf8" });
      this.graphTemplateCache[graphId] = Handlebars.compile(templateSource);
    }
    return this.graphTemplateCache[graphId];
  }
}
