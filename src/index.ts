#!/usr/bin/env node

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { cli_index, cli_etl } from './cli/index.ts';
import { init } from './init.ts';

yargs(hideBin(process.argv))
  .command("init", "initialize a new starches-builder project", function (yargs) {
    return yargs
      .option("dir", {
        default: ".",
        description: "target directory for initialization (defaults to current directory)",
        demandOption: false
      })
  }, (argv) => {
    return init(argv.dir as string);
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
  }, (argv) => {
    return cli_index(argv.definitions as string, argv.preindex as string, argv.site as string);
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
  }, (argv) => {
    return cli_etl(argv.file as string, argv.prefix as string);
  })
  .fail((msg, err, yargs) => {
    if (err) {
      console.error('\nError:', err.message);
      if (process.env.DEBUG) {
        console.error('\nStack trace:');
        console.error(err.stack);
      }
    } else if (msg) {
      console.error('\n' + msg);
      console.error('\nUse --help for usage information');
    }
    process.exit(1);
  })
  .help()
  .parseAsync()
