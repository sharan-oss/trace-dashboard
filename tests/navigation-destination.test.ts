import { describe, expect, it } from "vitest";
import {
  activeTabKey,
  isNavItemActive,
  parseDestination,
  type Destination,
} from "@/lib/navigation/destination";

/**
 * Pure tests for the pending layer's destination logic — what makes a clicked
 * tab, pill or sidebar item show as active before the server answers.
 */

const TAB = {
  basePath: "/customers",
  param: "tab",
  keys: ["value", "people"] as const,
  defaultKey: "value" as const,
  current: "value" as const,
};

describe("parseDestination", () => {
  it("returns the current URL, not pending, when nothing is in flight", () => {
    const d = parseDestination(null, "/customers", "tab=people&range=7d");
    expect(d.pending).toBe(false);
    expect(d.pathname).toBe("/customers");
    expect(d.searchParams.get("tab")).toBe("people");
  });

  it("parses an absolute destination href and marks it pending", () => {
    const d = parseDestination("/ads?tab=ads&range=7d", "/", "");
    expect(d.pending).toBe(true);
    expect(d.pathname).toBe("/ads");
    expect(d.searchParams.get("tab")).toBe("ads");
  });

  it("resolves a query-only href against the current path", () => {
    const d = parseDestination("?range=all", "/funnel", "range=7d");
    expect(d.pathname).toBe("/funnel");
    expect(d.searchParams.get("range")).toBe("all");
  });
});

describe("activeTabKey", () => {
  const at = (href: string | null, path = "/customers", search = "tab=value"): Destination =>
    parseDestination(href, path, search);

  it("uses the server's active tab when nothing is in flight", () => {
    expect(activeTabKey(at(null), TAB)).toBe("value");
  });

  it("uses the server's active tab when heading to a different page", () => {
    expect(activeTabKey(at("/funnel?tab=people"), TAB)).toBe("value");
  });

  it("shows the clicked tab while its navigation is in flight", () => {
    expect(activeTabKey(at("/customers?tab=people&range=7d"), TAB)).toBe("people");
  });

  it("falls back to the page default when the destination names no tab", () => {
    expect(activeTabKey(at("/customers", "/customers", "tab=people"), { ...TAB, current: "people" })).toBe("value");
  });

  it("falls back to the page default for an unknown tab value", () => {
    expect(activeTabKey(at("/customers?tab=bogus"), TAB)).toBe("value");
  });
});

describe("isNavItemActive", () => {
  it("matches Overview only on the root path", () => {
    expect(isNavItemActive("/", "/")).toBe(true);
    expect(isNavItemActive("/", "/ads")).toBe(false);
  });

  it("matches a section and its sub-pages", () => {
    expect(isNavItemActive("/ads", "/ads")).toBe(true);
    expect(isNavItemActive("/ads", "/ads/sync-log")).toBe(true);
    expect(isNavItemActive("/ads", "/customers")).toBe(false);
  });
});
