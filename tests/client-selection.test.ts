import { describe, expect, it } from "vitest";
import {
  DEFAULT_CLIENT_NAME,
  resolveSelectedClient,
} from "@/lib/client-selection";

const clients = [
  { id: "aaaaaaaa-0000-0000-0000-000000000001", name: "Batra" },
  { id: "aaaaaaaa-0000-0000-0000-000000000002", name: "Love School" },
  { id: "aaaaaaaa-0000-0000-0000-000000000003", name: "Occultyogis Vastu" },
];

describe("resolveSelectedClient", () => {
  it("honors a cookie that matches a real client", () => {
    // Catches: ignoring the cookie and always landing on the default.
    expect(resolveSelectedClient(clients, clients[2].id)).toBe(clients[2]);
  });

  it("falls back to Love School when the cookie is stale or absent", () => {
    // Catches: trusting a stale cookie id (deleted client → broken page).
    expect(resolveSelectedClient(clients, "bbbbbbbb-dead-dead-dead-000000000000")?.name).toBe(
      DEFAULT_CLIENT_NAME
    );
    expect(resolveSelectedClient(clients, undefined)?.name).toBe(DEFAULT_CLIENT_NAME);
  });

  it("falls back to the first client when Love School is absent", () => {
    // Catches: hardcoding Love School so a client-scoped login (which can't
    // see Love School) resolves nothing.
    const others = clients.filter((c) => c.name !== DEFAULT_CLIENT_NAME);
    expect(resolveSelectedClient(others, undefined)).toBe(others[0]);
  });

  it("returns null for an empty client list", () => {
    expect(resolveSelectedClient([], undefined)).toBeNull();
  });
});
