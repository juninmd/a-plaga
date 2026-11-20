import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { decodeRequestPath, resolveInside } from "../src/server/staticPath";

const root = join("/app", "dist");

describe("resolveInside", () => {
  it("resolves files under the root", () => {
    expect(resolveInside(root, "/assets/app.js")).toBe(join(root, "assets", "app.js"));
  });

  it("rejects traversal into a sibling directory sharing the root prefix", () => {
    expect(resolveInside(root, "/../dist-server/server/index.js")).toBeNull();
  });

  it("rejects traversal out of the root", () => {
    expect(resolveInside(root, "/../../etc/passwd")).toBeNull();
  });
});

describe("decodeRequestPath", () => {
  it("decodes a valid pathname and drops the query string", () => {
    expect(decodeRequestPath("/models/a%20b.glb?v=1")).toBe("/models/a b.glb");
  });

  it("returns null for a malformed %-escape instead of throwing", () => {
    expect(decodeRequestPath("/%E0%A4%A")).toBeNull();
  });

  it("returns null for an encoded NUL byte", () => {
    expect(decodeRequestPath("/index.html%00.png")).toBeNull();
  });
});
