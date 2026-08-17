import { redirect } from "next/navigation";
import { signOut } from "@/lib/auth/actions";
import { getIdentity, hasAccess } from "@/lib/auth/session";
import { Button } from "@/components/ui/button";

export const metadata = { title: "No access · Trace" };

/**
 * Where a signed-in Google account with no claims lands: not on the team
 * domain, and not on the allowlist. They can see this page and nothing else —
 * RLS would return empty everywhere anyway, so saying so plainly beats
 * rendering a dashboard full of zeroes.
 */
export default async function NoAccessPage() {
  const identity = await getIdentity();
  if (!identity) redirect("/login");
  if (hasAccess(identity)) redirect("/");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-base font-semibold text-white">
          This account has no access
        </h1>
        <p className="text-sm text-muted-foreground">
          You&apos;re signed in as{" "}
          <span className="font-medium text-slate-300">{identity.email}</span>,
          but it isn&apos;t set up for any dashboard yet. Ask your Alttred Miinds
          contact to add this address.
        </p>
      </div>
      <form action={signOut}>
        <Button type="submit" size="lg" variant="outline" className="w-full">
          Sign out
        </Button>
      </form>
    </div>
  );
}
