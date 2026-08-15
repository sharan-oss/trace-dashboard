import type { SupabaseClient } from "@supabase/supabase-js";
import { rangeToDays, type RangePreset } from "@/lib/range";

/**
 * Funnel read layer. Both aggregates are computed in Postgres by the RPCs in
 * migration 20260816100000, which compose v_funnel_by_session with sessions
 * and v_sessions_attributed at read time — the funnel view itself stays pure
 * stages-per-session. Counts only; every ratio is computed in TS through the
 * null-safe ratio() family.
 */

export type FunnelLens = "campaign" | "page" | "product" | "ad";

export type FunnelOverview = {
  sessions: number;
  reached_page_load: number;
  reached_form_open: number;
  reached_form_start: number;
  reached_form_submit: number;
  reached_payment_open: number;
  reached_payment_complete: number;
  /** Sessions that fired no page_load — paid clicks that never became visitors. */
  never_loaded: number;
  /** Sessions with no network reading, and how many of those converted (from data, never assumed). */
  no_telemetry: number;
  no_telemetry_converted: number;
};

export type FunnelSegmentRow = {
  /** Null = the bucket (Unattributed / unknown page / no product) — rendered, never dropped. */
  segment_key: string | null;
  segment_label: string | null;
  sessions: number;
  reached_page_load: number;
  reached_form_open: number;
  reached_form_start: number;
  reached_form_submit: number;
  reached_payment_open: number;
  reached_payment_complete: number;
};

export async function getFunnelOverview(
  supabase: SupabaseClient,
  clientId: string,
  preset: RangePreset,
): Promise<FunnelOverview> {
  const { data, error } = await supabase.rpc("funnel_overview", {
    p_client_id: clientId,
    p_days: rangeToDays(preset),
  });
  if (error) throw new Error(`funnel_overview failed: ${error.message}`);
  const rows = (data ?? []) as FunnelOverview[];
  return (
    rows[0] ?? {
      sessions: 0,
      reached_page_load: 0,
      reached_form_open: 0,
      reached_form_start: 0,
      reached_form_submit: 0,
      reached_payment_open: 0,
      reached_payment_complete: 0,
      never_loaded: 0,
      no_telemetry: 0,
      no_telemetry_converted: 0,
    }
  );
}

/**
 * One lens of the segment table. `campaign` is required by the RPC when the
 * lens is "ad" (the drill inside one campaign) and ignored otherwise.
 */
export async function getFunnelBreakdown(
  supabase: SupabaseClient,
  clientId: string,
  preset: RangePreset,
  lens: FunnelLens,
  campaign?: string,
): Promise<FunnelSegmentRow[]> {
  const { data, error } = await supabase.rpc("funnel_breakdown", {
    p_client_id: clientId,
    p_days: rangeToDays(preset),
    p_dimension: lens,
    p_campaign: campaign ?? null,
  });
  if (error) throw new Error(`funnel_breakdown(${lens}) failed: ${error.message}`);
  return (data ?? []) as FunnelSegmentRow[];
}
