import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
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

describe("the error page's Try again is itself acknowledged", () => {
  // unstable_retry re-fetches inside Next's own transition, which nothing
  // observes — routed through runPending, the page dims and the bar runs.
  it("routes unstable_retry through useRunPending", () => {
    const source = readFileSync(join(SRC, "app/(dashboard)/error.tsx"), "utf8");
    expect(source).toMatch(/useRunPending\(\)/);
    expect(source).toMatch(/runPending\(\s*\(\)\s*=>\s*unstable_retry\(\)\s*\)/);
  });
});

describe("dashboard navigation goes through the pending layer", () => {
  // Outside the dashboard shell there is no PendingNavigationProvider, so these
  // may keep using Next's primitives directly.
  const ALLOWED = [
    "components/navigation/pending-navigation.tsx",
    "app/(auth)/",
    "app/auth/",
    "app/(marketing)/",
    "app/new/",
  ];
  const DIRECT_LINK = /from\s+["']next\/link["']/;
  const DIRECT_ROUTER = /import\s*\{[^}]*\buseRouter\b[^}]*\}\s*from\s+["']next\/navigation["']/;

  it("imports neither next/link nor useRouter outside the layer", () => {
    const offenders = FILES.filter((f) => !ALLOWED.some((a) => rel(f).startsWith(a)))
      .filter((f) => {
        const source = readFileSync(f, "utf8");
        return DIRECT_LINK.test(source) || DIRECT_ROUTER.test(source);
      })
      .map(rel);
    expect(
      offenders,
      "Use PendingLink / usePendingRouter from @/components/navigation/pending-navigation — a direct Link or router gives no feedback while the next page loads.",
    ).toEqual([]);
  });
});
