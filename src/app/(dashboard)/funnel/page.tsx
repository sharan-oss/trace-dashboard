import { cookies } from "next/headers";
import { Filter } from "lucide-react";
import { FunnelSegments } from "@/components/funnel/funnel-segments";
import { FunnelStages } from "@/components/funnel/funnel-stages";
import { WastedClicksStrip } from "@/components/funnel/wasted-clicks-strip";
import { DateRangePicker } from "@/components/date-range-picker";
import { CLIENT_COOKIE, resolveSelectedClient } from "@/lib/client-selection";
import { getAdCreativeMeta, type AdCreativeMeta } from "@/lib/creatives";
import {
  getFunnelBreakdown,
  getFunnelOverview,
  type FunnelLens,
} from "@/lib/queries/funnel";
import { getClients } from "@/lib/queries/overview";
import { parseRangeParam, presetState } from "@/lib/range";
import { createServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/**
 * Funnel — where do people leak between click and payment, and whose fault is
 * it? The stage card names the biggest leak; the lens table assigns blame
 * structurally: campaign lens = same page, different traffic (the ad's fault),
 * page lens = same traffic, different page (the page's fault).
 *
 * URL state: ?range, ?lens=campaign|page|product (default campaign), and
 * ?lens=ad&campaign=<key> for the drill inside one campaign. An ad lens
 * without a campaign falls back to the campaign lens rather than erroring —
 * a shared URL should degrade, not break.
 */
export default async function FunnelPage({
  searchParams,
}: {
  searchParams: Promise<{
    range?: string | string[];
    lens?: string | string[];
    campaign?: string | string[];
  }>;
}) {
  const params = await searchParams;
  const preset = parseRangeParam(params.range);
  const campaignParam = first(params.campaign) || null;
  const lensParam = first(params.lens);
  const lens: FunnelLens =
    lensParam === "page" || lensParam === "product"
      ? lensParam
      : lensParam === "ad" && campaignParam != null
        ? "ad"
        : "campaign";

  const supabase = await createServerClient();
  const clients = await getClients(supabase);
  const cookieStore = await cookies();
  const selected = resolveSelectedClient(
    clients,
    cookieStore.get(CLIENT_COOKIE)?.value,
  );

  if (selected == null) {
    return (
      <div className="flex flex-col gap-6 p-6 sm:p-8">
        <h1 className="text-2xl font-bold text-white">Funnel</h1>
        <div className="rounded-2xl border border-border bg-card p-10 text-center backdrop-blur-md">
          <Filter size={24} className="mx-auto mb-3 text-slate-600" />
          <p className="text-sm text-slate-400">
            No clients are visible to this identity.
          </p>
        </div>
      </div>
    );
  }

  const [overview, segments] = await Promise.all([
    getFunnelOverview(supabase, selected.id, preset),
    getFunnelBreakdown(
      supabase,
      selected.id,
      preset,
      lens,
      lens === "ad" ? (campaignParam as string) : undefined,
    ),
  ]);

  // Creative previews and the drill header's campaign name — only needed on
  // the ad lens, where the segment keys ARE meta ad ids.
  let creativeMeta: Record<string, AdCreativeMeta> = {};
  let campaignLabel: string | null = null;
  if (lens === "ad") {
    const keys = segments
      .map((r) => r.segment_key)
      .filter((k): k is string => k != null);
    creativeMeta = Object.fromEntries(
      await getAdCreativeMeta(supabase, selected.id, keys),
    );
    const { data } = await supabase
      .from("ads")
      .select("campaign_name")
      .eq("client_id", selected.id)
      .eq("meta_campaign_id", campaignParam as string)
      .not("campaign_name", "is", null)
      .limit(1)
      .maybeSingle();
    campaignLabel = (data?.campaign_name as string | null) ?? campaignParam;
  }

  return (
    <div className="flex flex-col gap-6 p-6 sm:p-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Funnel</h1>
          <p className="mt-0.5 text-sm text-slate-400">
            {selected.name} · from click to payment, stage by stage
          </p>
        </div>
        <DateRangePicker state={presetState(preset)} />
      </header>

      <FunnelStages overview={overview} />

      <WastedClicksStrip overview={overview} />

      <FunnelSegments
        lens={lens}
        rows={segments}
        range={preset}
        campaignKey={lens === "ad" ? campaignParam : null}
        campaignLabel={campaignLabel}
        creativeMeta={creativeMeta}
      />
    </div>
  );
}
