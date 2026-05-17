#!/usr/bin/env node

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { cli_index, cli_etl, cli_precompile, cli_build_ros_madair } from './cli/index.ts';
import { init } from './init.ts';
import { createRequire } from 'module';
import { version as alizarinVersion, autoDetectBackend, setBackend, setNapiModule, getBackend } from 'alizarin/inline';

// Version injected at build time by tsup
declare const __STARCHES_BUILDER_VERSION__: string;
export const version: string = __STARCHES_BUILDER_VERSION__;

// Global error handlers to ensure stack traces are always printed
process.on('uncaughtException', (error) => {
  console.error('\nUncaught Exception:');
  console.error(error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, _promise) => {
  console.error('\nUnhandled Promise Rejection:');
  console.error(reason);
  process.exit(1);
});

// Pre-load the NAPI module so alizarin can find it (require() inside alizarin's
// bundled dist may not resolve @alizarin/napi from the consumer's node_modules).
try {
  const require_ = createRequire(import.meta.url);
  setNapiModule(require_('@alizarin/napi'));
} catch {
  // NAPI not available — autoDetectBackend will fall back to WASM
}

// Auto-detect best backend (NAPI in Node.js when available, WASM fallback).
// Can be overridden with ALIZARIN_BACKEND=wasm|napi env var.
const detectedBackend = autoDetectBackend();
setBackend(detectedBackend);

yargs(hideBin(process.argv))
  .middleware(() => {
    console.log(`starches-builder v${version} (alizarin v${alizarinVersion}, backend: ${getBackend()})\n`);
  }, true)
  .command("init", "initialize a new starches-builder project", function (yargs) {
    return yargs
      .option("dir", {
        default: ".",
        description: "target directory for initialization (defaults to current directory)",
        demandOption: false
      })
  }, async (argv) => {
    await init(argv.dir as string);
  })
  .command(["index", "$0"], "build Alizarin-compatible JSON files into indexes", function (yargs) {
    return yargs
      .option("definitions", {
        default: "./prebuild",
        description: "location of definitions (usu. under ./prebuild/)",
        demandOption: true
      })
      .option("preindex", {
        default: "./prebuild/preindex",
        description: "location of pre-index output (created by individual starches-builder preindex runs)",
        demandOption: true
      })
      .option("site", {
        default: "./public",
        description: "output directory for the site (usu. public or docs)",
        demandOption: true
      })
      .option("include-private", {
        description: "include private (non-public) nodegroups and entries",
        type: "boolean",
        default: false
      })
      .option("minify", {
        description: "output individual JSONs without unnecessary whitespace",
        type: "boolean",
        default: false
      })
  }, async (argv) => {
    await cli_index(argv.definitions as string, argv.preindex as string, argv.site as string, argv.includePrivate as boolean, argv.minify as boolean);
  })
  .command(["etl"], "build Alizarin-compatible JSON from Arches data", function (yargs) {
    return yargs
      .option("file", {
        description: "file to load preindex data from",
        demandOption: true
      })
      .option("prefix", {
        description: "prefix to use for this preindex set",
        demandOption: true
      })
      .option("include-private", {
        description: "include private (non-public) nodegroups and entries",
      })
      .option("tui", {
        description: "enable split-view TUI with progress bars",
        type: "boolean",
        default: false
      })
      .option("lazy", {
        description: "use lazy tile loading (default: false for ETL where tiles are in the JSON)",
        type: "boolean",
        default: false
      })
      .option("summary", {
        description: "print timing summary at the end of the run",
        type: "boolean",
        default: false
      })
      .option("verbose", {
        alias: 'v',
        description: "print per-resource warnings during ETL",
        type: "boolean",
        default: false
      })
      .option("minify", {
        description: "output individual JSONs without unnecessary whitespace",
        type: "boolean",
        default: false
      })
      .option("build-ros-madair", {
        description: "build a Rós Madair SPARQL index from the filtered business data",
        type: "boolean",
        default: false
      })
      .option("ros-madair-bin", {
        description: "path to the build_from_prebuild binary (default: search PATH)",
        type: "string",
        default: "build_from_prebuild"
      })
      .option("ros-madair-output", {
        description: "output directory for the Rós Madair index",
        type: "string",
        default: "docs/static/ros-madair"
      })
  }, async (argv) => {
    await cli_etl(argv.file as string, argv.prefix as string, argv.includePrivate as boolean, argv.tui as boolean, argv.lazy as boolean, argv.summary as boolean, argv.verbose as boolean, argv.minify as boolean, argv.buildRosMadair as boolean, argv.rosMadairBin as string, argv.rosMadairOutput as string);
  })
  .command("build-ros-madair", "build Rós Madair SPARQL index from a prebuild-layout directory", function (yargs) {
    return yargs
      .option("prebuild-dir", {
        description: "prebuild-layout directory (graphs/, business_data/, reference_data/)",
        type: "string",
        default: "docs/definitions"
      })
      .option("output", {
        description: "output directory for the Rós Madair index",
        type: "string",
        default: "docs/static/ros-madair"
      })
      .option("bin", {
        description: "path to the ros-madair-build binary",
        type: "string",
        default: "ros-madair-build"
      })
      .option("base-uri", {
        description: "RDF base URI for the index (must match hugo.yaml ros_madair.rdf_base_uri)",
        type: "string",
        default: "https://example.org/"
      })
  }, async (argv) => {
    await cli_build_ros_madair(argv.prebuildDir as string, argv.output as string, argv.bin as string, argv.baseUri as string);
  })
  .command("precompileTemplates", "precompile Handlebars templates for faster client-side rendering", function (yargs) {
    return yargs
  }, async (_argv) => {
    await cli_precompile();
  })
  .help()
  .fail((msg, err, yargs) => {
    if (err) {
      throw err;
    }
    console.error(msg);
    yargs.showHelp();
    process.exit(1);
  })
  .parseAsync()
