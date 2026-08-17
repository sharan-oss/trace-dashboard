import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";

/**
 * Where Google returns the visitor. Exchanges the one-time code for a session
 * and writes the cookies (a Route Handler may, unlike a Server Component).
 * Landing on "/" then re-checks claims and forwards to /no-access if there are
 * none.
 */
export async function GET(request: Request): Promise<Response> {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  // Behind Vercel's proxy the request origin is internal; the forwarded host is
  // the address the browser actually used.
  const forwardedHost = request.headers.get("x-forwarded-host");
  const base =
    process.env.NODE_ENV === "development" || !forwardedHost
      ? origin
      : `https://${forwardedHost}`;

  if (code) {
    const supabase = await createServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${base}/`);
  }

  return NextResponse.redirect(`${base}/login?error=auth`);
}
