import { createClientWithJwt } from "@/lib/supabase/server";
import { getDevJwt } from "@/lib/auth/dev-identity";
import { BentoGrid } from "@/components/ui/bento-grid";
import { BentoTile } from "@/components/ui/bento-tile";
import { StatusBadge } from "@/components/ui/status-badge";

type CountResult = { count: number | null; error: string | null };

async function getPaymentsCount(role: "admin" | "client"): Promise<CountResult> {
  const jwt = await getDevJwt(role);
  const supabase = createClientWithJwt(jwt);
  const { count, error } = await supabase
    .from("payments")
    .select("*", { count: "exact", head: true });
  if (error) return { count: null, error: error.message };
  return { count, error: null };
}

function CountTile({ label, result }: { label: string; result: CountResult }) {
  return (
    <BentoTile className="flex flex-col justify-between gap-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{label}</p>
        <StatusBadge
          status={result.error ? "danger" : "success"}
          label={result.error ? "Error" : "RLS scoped"}
        />
      </div>
      <p className="font-heading text-4xl font-semibold tabular-nums text-foreground">
        {result.error ? "—" : result.count}
      </p>
      {result.error && (
        <p className="text-xs text-danger-foreground">{result.error}</p>
      )}
    </BentoTile>
  );
}

export default async function Home() {
  const [admin, client] = await Promise.all([
    getPaymentsCount("admin"),
    getPaymentsCount("client"),
  ]);

  return (
    <div className="min-h-screen bg-background p-16">
      <div className="mx-auto flex max-w-2xl flex-col gap-8">
        <h1 className="font-heading text-2xl font-semibold text-foreground">
          Trace Dashboard — Phase 0 RLS Proof
        </h1>
        <BentoGrid className="sm:grid-cols-2">
          <CountTile label="Admin (is_admin claim)" result={admin} />
          <CountTile label="Test client (client_id claim)" result={client} />
        </BentoGrid>
        <p className="max-w-md text-sm text-muted-foreground">
          Both counts are read through RLS-scoped Supabase clients — the admin JWT
          carries <code>is_admin: true</code>, the test-client JWT carries a
          specific <code>client_id</code>. If RLS is working, the test-client
          count should be strictly smaller than the admin count.
        </p>
      </div>
    </div>
  );
}
