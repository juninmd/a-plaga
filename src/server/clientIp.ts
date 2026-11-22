/** Real client IP for per-IP limits. Behind a proxy/ingress (Traefik, Fly, Render) the
 *  nearest proxy appends the peer it saw to X-Forwarded-For, so the right-most entry is the
 *  trustworthy one; left-most entries come from the client and can be forged. */
export function clientIp(forwardedFor: string | string[] | undefined, remoteAddress: string | undefined): string {
  const raw = Array.isArray(forwardedFor) ? forwardedFor.join(",") : forwardedFor;
  const last = raw?.split(",").map((s) => s.trim()).filter(Boolean).pop();
  return last || remoteAddress || "?";
}
