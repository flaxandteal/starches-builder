#!/usr/bin/env node

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { cli_index } from './cli/index.ts';

yargs(hideBin(process.argv))
  .command(["index", "$0"], "build Alizarin-compatible JSON files into indexes", function (yargs) {
    return yargs
      .option("definitions", {
        default: "./static/definitions",
        description: "location of definitions (usu. under ./static/)",
        demandOption: true
      })
      .option("site", {
        default: "./public",
        description: "output directory for the site (usu. public or docs)",
        demandOption: true
      })
  }, async (argv) => {
    cli_index(argv.definitions, argv.site)
  })
  .help()
  .parse()
