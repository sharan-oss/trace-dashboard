"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getIdentity } from "@/lib/auth/session";
import { createServerClient } from "@/lib/supabase/server";

/**
 * Add and remove rows in the app_users allowlist.
 *
 * Both go through the caller's own RLS-scoped client, so app_users' policies
 * are the authorization — a team member's delete of someone else's row matches
 * no policy and simply affects nothing. Nothing here re-implements the
 * permission matrix.
 */

export type ActionState = { error?: string; ok?: boolean };

const AddInput = z.object({
  email: z.email().transform((value) => value.toLowerCase()),
  clientId: z.uuid(),
});

export async function addClientUser(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = AddInput.safeParse({
    email: formData.get("email"),
    clientId: formData.get("clientId"),
  });
  if (!parsed.success) {
    return { error: "Enter a valid email address and choose a client." };
  }

  const identity = await getIdentity();
  if (!identity) return { error: "Your session expired — sign in again." };

  const supabase = await createServerClient();
  const { error } = await supabase.from("app_users").insert({
    email: parsed.data.email,
    role: "client",
    client_id: parsed.data.clientId,
    // Must equal the caller's own address or the insert policy rejects it.
    invited_by: identity.email,
  });

  if (error) {
    return {
      error:
        error.code === "23505"
          ? "That email already has access."
          : error.message,
    };
  }

  revalidatePath("/settings/users");
  return { ok: true };
}

export async function removeUser(formData: FormData): Promise<void> {
  const id = z.uuid().safeParse(formData.get("id"));
  if (!id.success) return;

  const supabase = await createServerClient();
  await supabase.from("app_users").delete().eq("id", id.data);

  revalidatePath("/settings/users");
}
