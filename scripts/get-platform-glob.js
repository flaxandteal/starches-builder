#!/usr/bin/env node

import os from 'os';

// TODO: test on windows.
const glob = process.platform
  + "-"
  + process.arch
  + "*";

console.log(glob)
