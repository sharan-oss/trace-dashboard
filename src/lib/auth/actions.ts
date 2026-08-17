"use server";

import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";

/** Clears the session cookies and returns to the login screen. */
export async function signOut(): Promise<void> {
  const supabase = await createServerClient();
  await supabase.auth.signOut();
  redirect("/login");
}
