import { join, normalize, sep } from "node:path";

/** Resolves a request path inside `root`; null when it escapes (a sibling such as `dist-server` shares the `dist` prefix). */
export function resolveInside(root: string, requestPath: string): string | null {
  const file = normalize(join(root, requestPath));
  return file === root || file.startsWith(root + sep) ? file : null;
}

/** Decoded pathname of a request URL; null when it is malformed (bad %-escape, NUL byte) and must get a 400, not a 500. */
export function decodeRequestPath(rawUrl: string): string | null {
  try {
    const path = decodeURIComponent(new URL(rawUrl, "http://localhost").pathname);
    return path.includes("\0") ? null : path;
  } catch {
    return null;
  }
}
