import { createAvatar } from "@dicebear/core";
import * as collection from "@dicebear/collection";

/**
 * Deterministic customer avatars, generated locally.
 *
 * PRIVACY, and the reason this file exists rather than an <img> pointing at an
 * avatar service: the seed is the customer's UUID and NOTHING else. Never the
 * email, never the phone, never the name. A hosted avatar API would put a
 * customer's email hash in a URL leaving our servers; DiceBear runs in-process,
 * so no customer data crosses a network boundary and none appears in any URL.
 *
 * Deterministic means a customer's face is permanent — the same person is
 * recognisable across sessions, ranges and clients — with no storage at all.
 * That property is what makes the top-customers strip readable rather than
 * decorative.
 *
 * These are illustrated characters, deliberately not photographs of real
 * people: nothing here should ever be mistaken for a real portrait of the
 * customer it labels.
 */

/**
 * The one place the look is chosen. Every style in @dicebear/collection renders
 * from the same seed, so swapping this constant restyles the entire app and
 * nothing else changes. notionists picked by Sharan 2026-08-16: black line art
 * over white fills, which reads cleanly on any mid-to-deep background.
 */
const STYLE = collection.notionists;

/**
 * A cool jewel-tone spread, so a row of customers reads as a row of distinct
 * people rather than one repeated chip. DiceBear picks from this list by seed,
 * so a customer's colour is as permanent as their face.
 *
 * EMERALD AND RED ARE DELIBERATELY ABSENT. The design system reserves them for
 * status, and this app uses them nowhere else — a red-backed avatar beside a
 * revenue figure would read as "problem customer", inventing a signal that does
 * not exist. Everything here stays in the indigo → violet → blue → cyan family
 * the accent already lives in, which is also why the strip still looks like one
 * system rather than a confetti of brand colours.
 */
const BACKGROUND_COLORS = [
  "4f46e5", // indigo-600
  "3730a3", // indigo-800
  "7c3aed", // violet-600
  "5b21b6", // violet-800
  "9333ea", // purple-600
  "a21caf", // fuchsia-700
  "2563eb", // blue-600
  "1e40af", // blue-800
  "0369a1", // sky-700
  "0e7490", // cyan-700
  "475569", // slate-600
];

/**
 * SVG generation is pure but not free (~10ms, ~12KB each), and the same
 * customers reappear on every render of every range. Cache on the seed, which
 * is the entire input. Bounded so a long-running server cannot grow unboundedly
 * on a large tenant.
 */
const CACHE_LIMIT = 500;
const cache = new Map<string, string>();

/**
 * A data URI for one customer's avatar, ready for an <img src>.
 * `customerId` must be the customer's UUID — see the privacy note above.
 */
export function avatarDataUri(customerId: string): string {
  const hit = cache.get(customerId);
  if (hit != null) return hit;

  const uri = createAvatar(STYLE, {
    seed: customerId,
    size: 96,
    backgroundColor: BACKGROUND_COLORS,
    backgroundType: ["solid"],
    radius: 50,
  }).toDataUri();

  // Simple bound: drop the oldest insertion once full. Map preserves insertion
  // order, so the first key is the oldest.
  if (cache.size >= CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest != null) cache.delete(oldest);
  }
  cache.set(customerId, uri);
  return uri;
}

/** Test seam: lets the determinism test prove caching is not what makes it stable. */
export function clearAvatarCache(): void {
  cache.clear();
}
