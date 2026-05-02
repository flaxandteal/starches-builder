import { describe, it, expect, jest } from "@jest/globals";
import { setTileDataForNode } from "../../src/etl.ts";

describe("setTileDataForNode", () => {
  it("calls wasmWrapper.setTileDataForNode (writes to wrapper's tile store)", () => {
    const resource = {
      setTileDataForNode: jest.fn().mockReturnValue(true),
    };
    const wasmWrapper = {
      setTileDataForNode: jest.fn().mockReturnValue(true),
    };

    const result = setTileDataForNode(resource, wasmWrapper, "tile-1", "node-1", "value");
    expect(result).toBe(true);
    expect(wasmWrapper.setTileDataForNode).toHaveBeenCalledWith("tile-1", "node-1", "value");
    // Must NOT use resource — resource copy is independent in WASM mode
    expect(resource.setTileDataForNode).not.toHaveBeenCalled();
  });

  it("throws when wrapper lacks the method", () => {
    const resource = {};
    const wasmWrapper = {};

    expect(() => {
      setTileDataForNode(resource, wasmWrapper, "tile-2", "node-2", null);
    }).toThrow(/not available on instance wrapper/);
  });
});
