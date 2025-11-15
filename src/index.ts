#!/usr/bin/env node

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { cli_index, cli_etl } from './cli/index.ts';

yargs(hideBin(process.argv))
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
    cli_index(argv.definitions, argv.preindex, argv.site)
  })
  .command(["etl", "$0"], "build Alizarin-compatible JSON from Arches data", function (yargs) {
    return yargs
      .option("file", {
        description: "file to load preindex data from",
        demandOption: true
      })
      .option("prefix", {
        description: "prefix to use for this preindex set",
        demandOption: true
      })
  }, async (argv) => {
    cli_etl(argv.file, argv.prefix)
  })
  .help()
  .parse()
