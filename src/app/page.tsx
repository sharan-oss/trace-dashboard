import { createClientWithJwt } from "@/lib/supabase/server";
import { getDevJwt } from "@/lib/auth/dev-identity";

async function getPaymentsCount(role: "admin" | "client") {
  const jwt = await getDevJwt(role);
  const supabase = createClientWithJwt(jwt);
  const { count, error } = await supabase
    .from("payments")
    .select("*", { count: "exact", head: true });
  if (error) return { count: null, error: error.message };
  return { count, error: null };
}

export default async function Home() {
  const [admin, client] = await Promise.all([
    getPaymentsCount("admin"),
    getPaymentsCount("client"),
  ]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 bg-zinc-50 p-16 font-sans dark:bg-black">
      <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">
        Trace Dashboard — Phase 0 RLS Proof
      </h1>
      <div className="grid w-full max-w-lg grid-cols-2 gap-4">
        <div className="rounded-lg border border-black/10 bg-white p-6 dark:border-white/10 dark:bg-zinc-900">
          <p className="text-sm text-zinc-500">Admin (is_admin claim)</p>
          <p className="text-3xl font-bold text-black dark:text-zinc-50">
            {admin.error ? "error" : admin.count}
          </p>
          {admin.error && <p className="text-xs text-red-500">{admin.error}</p>}
        </div>
        <div className="rounded-lg border border-black/10 bg-white p-6 dark:border-white/10 dark:bg-zinc-900">
          <p className="text-sm text-zinc-500">Test client (client_id claim)</p>
          <p className="text-3xl font-bold text-black dark:text-zinc-50">
            {client.error ? "error" : client.count}
          </p>
          {client.error && <p className="text-xs text-red-500">{client.error}</p>}
        </div>
      </div>
      <p className="max-w-md text-center text-sm text-zinc-500">
        Both counts are read through RLS-scoped Supabase clients — the admin JWT
        carries <code>is_admin: true</code>, the test-client JWT carries a
        specific <code>client_id</code>. If RLS is working, the test-client
        count should be strictly smaller than the admin count.
      </p>
    </div>
  );
}
