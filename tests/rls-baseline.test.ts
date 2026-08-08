import { describe, expect, it } from "vitest";
import { adminClient, clientClient, countRows } from "./helpers/supabase";

describe("RLS baseline", () => {
  it("scopes the client identity strictly below admin on payments", async () => {
    const [admin, client] = await Promise.all([adminClient(), clientClient()]);
    const [adminCount, clientCount] = await Promise.all([
      countRows(admin, "payments"),
      countRows(client, "payments"),
    ]);

    expect(adminCount).toBeGreaterThan(0);
    expect(clientCount).toBeGreaterThan(0);
    expect(clientCount).toBeLessThan(adminCount);
  });
});
