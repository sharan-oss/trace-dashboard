import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Structural guards for the instant-feedback design
 * (docs/superpowers/specs/2026-10-05-instant-feedback-design.md). Static file
 * scans — no database, no browser.
 */

const SRC = join(process.cwd(), "src");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const FILES = walk(SRC).filter((f) => /\.(ts|tsx)$/.test(f));
const rel = (f: string) => relative(SRC, f).split(sep).join("/");

describe("every dashboard page has its own loading skeleton", () => {
  it("has a loading.tsx beside each (dashboard) page.tsx", () => {
    const missing = FILES.filter(
      (f) => rel(f).startsWith("app/(dashboard)/") && rel(f).endsWith("/page.tsx"),
    )
      .filter((f) => !existsSync(join(dirname(f), "loading.tsx")))
      .map(rel);
    expect(
      missing,
      "Add a loading.tsx next to each page, composed from @/components/page-skeleton — without one, navigating here shows nothing until the server answers.",
    ).toEqual([]);
  });

  it("puts no loading.tsx directly in (dashboard)/, which would shadow every page's own", () => {
    expect(existsSync(join(SRC, "app/(dashboard)/loading.tsx"))).toBe(false);
  });
});
