import { redirect } from "next/navigation";
import { getIdentity, hasAccess } from "@/lib/auth/session";
import { GoogleButton } from "./google-button";

export const metadata = { title: "Sign in · Trace" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const identity = await getIdentity();
  if (identity) {
    redirect(hasAccess(identity) ? "/" : "/no-access");
  }
  const { error } = await searchParams;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <span className="text-lg font-bold tracking-tight text-white">
            Trace
          </span>
          <span className="rounded bg-white/5 px-2 py-0.5 text-xs font-medium text-slate-500">
            dashboard
          </span>
        </div>
        <p className="text-sm text-muted-foreground">
          Sign in with the Google account your access was set up under.
        </p>
      </div>

      <GoogleButton />

      {error && (
        <p className="text-xs text-danger-foreground">
          That sign-in didn&apos;t complete. Please try again.
        </p>
      )}
    </div>
  );
}
