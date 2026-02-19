// utils/precompile-templates.ts
import Handlebars from 'handlebars';
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { execSync } from 'child_process';

interface TemplateSource {
  module?: string;
  localPath?: string;
  dir?: string;
  htmlTemplates?: string[];
  mdTemplates?: string[];
}

interface ComponentSource {
  name: string;
  partials?: string[];
}

interface TemplateConfig {
  templateSources: TemplateSource[];
  outputDir?: string;
  outputFile?: string;
  cdnBase?: string;
  components?: ComponentSource[];
}

interface HugoMount {
  path: string;
  dir: string;
}

function loadConfig(): TemplateConfig {
  const configPath = join(process.cwd(), 'starches.templates.json');
  const raw = readFileSync(configPath, 'utf-8');
  return JSON.parse(raw) as TemplateConfig;
}

function resolveHugoModulePaths(): Map<string, string> {
  const moduleMap = new Map<string, string>();

  // Ensure Go is on PATH (common install location)
  const env = { ...process.env };
  const goPath = '/usr/local/go/bin';
  if (existsSync(join(goPath, 'go')) && !env.PATH?.includes(goPath)) {
    env.PATH = `${goPath}:${env.PATH}`;
  }

  const output = execSync('hugo config mounts', { encoding: 'utf-8', env });

  // hugo config mounts outputs multiple JSON objects concatenated (not an array)
  const jsonBlocks = output
    .trim()
    .split(/\}\s*\{/)
    .map((block, i, arr) => {
      if (arr.length === 1) return block;
      if (i === 0) return block + '}';
      if (i === arr.length - 1) return '{' + block;
      return '{' + block + '}';
    });

  for (const block of jsonBlocks) {
    try {
      const mount = JSON.parse(block) as HugoMount;
      if (mount.path && mount.dir) {
        moduleMap.set(mount.path, mount.dir);
      }
    } catch {
      console.warn('Failed to parse Hugo mount block:', block.slice(0, 100));
    }
  }

  return moduleMap;
}

function resolveTemplateDir(source: TemplateSource, hugoModules: Map<string, string>): string {
  if (source.localPath) {
    return resolve(process.cwd(), source.localPath);
  }
  if (source.module) {
    if (!source.dir) {
      throw new Error(`Template source with module "${source.module}" must also specify "dir"`);
    }
    const moduleDir = hugoModules.get(source.module);
    if (!moduleDir) {
      throw new Error(
        `Hugo module "${source.module}" not found. Available modules: ${[...hugoModules.keys()].join(', ')}`
      );
    }
    return join(moduleDir, source.dir);
  }
  if (!source.dir) {
    throw new Error('Template source must specify "localPath", "module", or "dir"');
  }
  return resolve(process.cwd(), source.dir);
}

async function fetchTemplate(name: string, dir: string, cdnBase: string): Promise<string> {
  const url = `${cdnBase}${dir}/${name}.hbs`;
  console.log(`Fetching template: ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  return await res.text();
}

export async function precompileTemplates() {
  const config = loadConfig();
  const output: Record<string, { template?: string; partials?: Record<string, string> }> = {};

  const cdnBase = config.cdnBase ?? '';

  // Resolve Hugo module paths (only if any source uses a module)
  const needsHugo = config.templateSources.some(s => s.module);
  const hugoModules = needsHugo ? resolveHugoModulePaths() : new Map<string, string>();

  // Precompile CDN components
  for (const comp of config.components ?? []) {
    console.log(`Processing component: ${comp.name}`);
    output[comp.name] = {};

    if (comp.partials) {
      output[comp.name].partials = {};
      for (const partial of comp.partials) {
        const txt = await fetchTemplate(partial, comp.name, cdnBase);
        const compiled = Handlebars.precompile(txt) as unknown as string;
        output[comp.name].partials![partial] = compiled;
      }
    }

    const tplText = await fetchTemplate(comp.name, comp.name, cdnBase);
    const compiled = Handlebars.precompile(tplText) as unknown as string;
    output[comp.name].template = compiled;
  }

  // Precompile local templates from config
  for (const source of config.templateSources) {
    const templateDir = resolveTemplateDir(source, hugoModules);
    console.log(`Resolved template directory: ${templateDir}`);

    for (const templateFile of source.htmlTemplates ?? []) {
      const templateName = templateFile.replace('.html', '');
      const filePath = join(templateDir, templateFile);
      console.log(`Processing HTML template: ${filePath}`);
      const txt = readFileSync(filePath, 'utf-8');
      const compiled = Handlebars.precompile(txt) as unknown as string;
      output[templateName] = { template: compiled };
    }

    for (const templateFile of source.mdTemplates ?? []) {
      const templateName = templateFile.replace('.md', '');
      const filePath = join(templateDir, templateFile);
      console.log(`Processing MD template: ${filePath}`);
      const txt = readFileSync(filePath, 'utf-8');
      const compiled = Handlebars.precompile(txt) as unknown as string;
      output[templateName] = { template: compiled };
    }
  }

  // Write output
  const outputDir = config.outputDir ?? 'static/js';
  const outputFile = config.outputFile ?? 'precompiled-templates.js';
  mkdirSync(join(process.cwd(), outputDir), { recursive: true });

  const outputPath = join(process.cwd(), outputDir, outputFile);

  let jsContent = '// Auto-generated precompiled Handlebars templates\n';
  jsContent += 'window.__PRECOMPILED_TEMPLATES = {};\n\n';

  for (const [compName, compData] of Object.entries(output)) {
    jsContent += `// Component: ${compName}\n`;
    jsContent += `window.__PRECOMPILED_TEMPLATES['${compName}'] = {};\n`;

    if (compData.partials) {
      jsContent += `window.__PRECOMPILED_TEMPLATES['${compName}'].partials = {};\n`;
      for (const [partialName, compiledCode] of Object.entries(compData.partials)) {
        jsContent += `window.__PRECOMPILED_TEMPLATES['${compName}'].partials['${partialName}'] = Handlebars.template(${compiledCode});\n`;
      }
    }

    if (compData.template) {
      jsContent += `window.__PRECOMPILED_TEMPLATES['${compName}'].template = Handlebars.template(${compData.template});\n`;
    }
    jsContent += '\n';
  }

  writeFileSync(outputPath, jsContent, 'utf-8');
  console.log(`Precompiled templates written to ${outputPath}`);
}
