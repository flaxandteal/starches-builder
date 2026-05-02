import { describe, it, expect } from "@jest/globals";
import { mapsToObjects } from "../../src/metadata-extractor.ts";

describe("mapsToObjects", () => {
  it("converts a Map to a plain object", () => {
    const map = new Map([["a", 1], ["b", 2]]);
    expect(mapsToObjects(map)).toEqual({ a: 1, b: 2 });
  });

  it("passes through a plain object unchanged", () => {
    const obj = { a: 1, b: 2 };
    expect(mapsToObjects(obj)).toEqual({ a: 1, b: 2 });
  });

  it("handles nested Maps", () => {
    const inner = new Map([["x", 10]]);
    const outer = new Map([["child", inner]]);
    expect(mapsToObjects(outer)).toEqual({ child: { x: 10 } });
  });

  it("handles arrays containing Maps", () => {
    const map = new Map([["key", "val"]]);
    const arr = [map, "plain", 42];
    const result = mapsToObjects(arr);
    expect(result).toEqual([{ key: "val" }, "plain", 42]);
  });

  it("handles null and primitive values", () => {
    expect(mapsToObjects(null)).toBe(null);
    expect(mapsToObjects(undefined)).toBe(undefined);
    expect(mapsToObjects(42)).toBe(42);
    expect(mapsToObjects("str")).toBe("str");
    expect(mapsToObjects(true)).toBe(true);
  });

  it("handles mixed Map and plain object nesting in arrays", () => {
    const map = new Map([["nested", { plain: true }]]);
    const arr = [map, { also: "plain" }];
    const result = mapsToObjects(arr);
    expect(result).toEqual([
      { nested: { plain: true } },
      { also: "plain" },
    ]);
  });
});
