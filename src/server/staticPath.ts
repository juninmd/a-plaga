import { join, normalize, sep } from "node:path";

/** Resolves a request path inside `root`; null when it escapes (a sibling such as `dist-server` shares the `dist` prefix). */
export function resolveInside(root: string, requestPath: string): string | null {
  const file = normalize(join(root, requestPath));
  return file === root || file.startsWith(root + sep) ? file : null;
}
