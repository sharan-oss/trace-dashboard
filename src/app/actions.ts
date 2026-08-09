"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { z } from "zod";
import { CLIENT_COOKIE } from "@/lib/client-selection";

const ONE_YEAR_S = 60 * 60 * 24 * 365;

/**
 * Persist the sidebar's client selection. The cookie stores only a client
 * id; every page re-resolves it against the caller's RLS-visible client
 * list, so a forged or stale cookie can never widen access.
 */
export async function selectClient(clientId: string): Promise<void> {
  const id = z.uuid().parse(clientId);
  (await cookies()).set(CLIENT_COOKIE, id, {
    path: "/",
    maxAge: ONE_YEAR_S,
    sameSite: "lax",
  });
  revalidatePath("/", "layout");
}
