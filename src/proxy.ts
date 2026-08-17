import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Session refresh + the signed-out redirect. (Next 16 renamed Middleware to
 * Proxy; same mechanism, same file position.)
 *
 * Deliberately an optimistic check, per Next's own guidance — it answers "is
 * there a session at all", nothing more. Whether an identity may see a given
 * row is RLS's job, and whether it may see the app at all is re-checked
 * server-side in the dashboard layout. Getting past this file buys a visitor
 * nothing.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (toSet) => {
          // Rotated tokens have to reach both the Server Components rendering
          // this request and the browser, hence the double write.
          for (const { name, value } of toSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of toSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    }
  );

  const { data } = await supabase.auth.getClaims();

  if (!data?.claims) {
    const login = request.nextUrl.clone();
    login.pathname = "/login";
    login.search = "";
    return NextResponse.redirect(login);
  }

  return response;
}

export const config = {
  // Everything except: Next's own assets, the API routes (they carry their own
  // guards, and the nightly cron authenticates with a bearer secret and no
  // cookies), and the pages a signed-out visitor must be able to reach.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api|auth|login|no-access|landing|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
