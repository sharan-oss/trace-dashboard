import { Filter } from "lucide-react";

export default function FunnelPage() {
  return (
    <div className="flex flex-col gap-6 p-6 sm:p-8">
      <h1 className="text-2xl font-bold text-white">Funnel</h1>
      <div className="rounded-2xl border border-border bg-card p-10 text-center backdrop-blur-md">
        <Filter size={24} className="mx-auto mb-3 text-slate-600" />
        <p className="text-sm text-slate-400">
          Coming soon — stage-by-stage drop-off per product.
        </p>
      </div>
    </div>
  );
}
