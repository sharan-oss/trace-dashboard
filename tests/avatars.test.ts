/**
 * Avatar generation. Pure and local, so this is one of the few suites here that
 * touches no database at all.
 */
import { describe, expect, it } from "vitest";
import { avatarDataUri, clearAvatarCache } from "@/lib/avatars";

const UUID_A = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const UUID_B = "9c858901-8a57-4791-81fe-4c455b099bc9";

describe("avatarDataUri", () => {
  it("is deterministic for a given customer, independent of the cache", () => {
    clearAvatarCache();
    const first = avatarDataUri(UUID_A);
    clearAvatarCache();
    const afterClear = avatarDataUri(UUID_A);
    // Identical with a cold cache too, so stability is a property of the seed
    // rather than an artefact of memoisation — which is what makes a customer's
    // face survive restarts and deploys.
    expect(afterClear).toBe(first);
  });

  it("gives different customers different avatars", () => {
    expect(avatarDataUri(UUID_A)).not.toBe(avatarDataUri(UUID_B));
  });

  it("returns an inline SVG data URI, fetching nothing", () => {
    const uri = avatarDataUri(UUID_A);
    expect(uri.startsWith("data:image/svg+xml")).toBe(true);
    expect(uri).not.toMatch(/https?:\/\//);
  });

  it("never embeds the seed, so a customer id cannot be read back off the page", () => {
    const uri = decodeURIComponent(avatarDataUri(UUID_A));
    expect(uri).not.toContain(UUID_A);
  });

  it("draws backgrounds only from the approved palette, never a status colour", () => {
    // Emerald and red carry meaning in this app. An avatar tinted with one
    // would invent a signal, so the palette must stay inside the cool family.
    const forbidden = [/#?10b981/i, /#?ef4444/i, /#?dc2626/i, /#?059669/i];
    for (let i = 0; i < 40; i += 1) {
      const uri = decodeURIComponent(
        avatarDataUri(`00000000-0000-4000-8000-${String(i).padStart(12, "0")}`),
      );
      for (const pattern of forbidden) {
        expect(uri).not.toMatch(pattern);
      }
    }
  });
});
