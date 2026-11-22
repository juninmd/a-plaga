import { describe, expect, it } from "vitest";
import { clientIp } from "../src/server/clientIp";

describe("clientIp", () => {
  it("uses the entry appended by the nearest proxy, not a client-forged one", () => {
    // Client sent "X-Forwarded-For: 1.2.3.4"; the ingress appended the real peer.
    expect(clientIp("1.2.3.4, 203.0.113.7", "10.0.0.5")).toBe("203.0.113.7");
  });

  it("forged left-most entries cannot spread one client across many IP buckets", () => {
    const ips = new Set([1, 2, 3].map((n) => clientIp(`9.9.9.${n}, 203.0.113.7`, "10.0.0.5")));
    expect([...ips]).toEqual(["203.0.113.7"]);
  });

  it("handles a single entry, repeated headers and whitespace", () => {
    expect(clientIp(" 203.0.113.7 ", "10.0.0.5")).toBe("203.0.113.7");
    expect(clientIp(["1.2.3.4", "203.0.113.7"], "10.0.0.5")).toBe("203.0.113.7");
  });

  it("falls back to the socket address, then to a placeholder", () => {
    expect(clientIp(undefined, "10.0.0.5")).toBe("10.0.0.5");
    expect(clientIp(" , ", "10.0.0.5")).toBe("10.0.0.5");
    expect(clientIp(undefined, undefined)).toBe("?");
  });
});
