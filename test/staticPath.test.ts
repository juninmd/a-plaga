import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { resolveInside } from "../src/server/staticPath";

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
