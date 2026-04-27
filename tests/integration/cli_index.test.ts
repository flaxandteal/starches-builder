import path from "path";
import { fileURLToPath } from "url";

import { cli_index } from "../../src/cli/index";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("indexing can be done", () => {
  it("runs for a group of files", async () => {
    await cli_index(
      path.join(__dirname, "definitions"),
      path.join(__dirname, "output"),
      path.join(__dirname, "output"),
      false,
      false
    );
  })
})
