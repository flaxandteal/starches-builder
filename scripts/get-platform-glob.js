#!/usr/bin/env node

import os from 'os';

// TODO: test on windows.
const glob = os.machine()
  + "-*-"
  + process.platform.replace('win32', 'windows')
  + "*";

console.log(glob)
