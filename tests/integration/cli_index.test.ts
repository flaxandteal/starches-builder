import path from "path";

import { cli_index } from "../../src/cli/index";

describe("indexing can be done", () => {
  it("runs for a group of files", done => {
    cli_index(path.join(__dirname, "resources"), path.join(__dirname, "output"))
    done();
  })
})
