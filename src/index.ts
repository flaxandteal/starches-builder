#!/usr/bin/env node

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { cli_index, cli_etl } from './cli/index.ts';
import { init } from './init.ts';

// Global error handlers to ensure stack traces are always printed
process.on('uncaughtException', (error) => {
  console.error('\nUncaught Exception:');
  console.error(error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('\nUnhandled Promise Rejection:');
  console.error(reason);
  process.exit(1);
});

yargs(hideBin(process.argv))
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
  }, async (argv) => {
    await cli_index(argv.definitions as string, argv.preindex as string, argv.site as string, argv.includePrivate as boolean);
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
  }, async (argv) => {
    await cli_etl(argv.file as string, argv.prefix as string, argv.includePrivate as boolean, argv.tui as boolean);
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
