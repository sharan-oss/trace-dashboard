/*
 * Section 4 — the product shot, built as code (decided 2026-08-10: no
 * Gemini image; a coded mock matches the page and the real product).
 * Mirrors the real dashboard's dark-glass system: slate gradient canvas,
 * white-alpha cards, indigo-400 hero series / slate-400 baseline, emerald
 * strictly for money-up moments. Numbers are illustrative.
 */

const KPIS = [
  { label: "L2 Revenue", value: "₹42.8L", delta: "+23%", hero: true },
  { label: "L1 Revenue", value: "₹6.2L", delta: "+8%", hero: false },
  { label: "Sessions", value: "12,873", delta: "+11%", hero: false },
  { label: "L2 ROAS", value: "6.4×", delta: "+1.2", hero: true },
];

const TOP_ADS = [
  { name: "Webinar – Hook A", value: "₹3.2L", bar: "w-full", win: true },
  { name: "Reel – Story 02", value: "₹1.1L", bar: "w-2/5", win: false },
  { name: "Static – Broad", value: "₹40k", bar: "w-[15%]", win: false },
];

const NAV = ["Overview", "Ads", "Funnel", "Customers"];

export function DashboardMock() {
  return (
    <div
      aria-hidden
      className="flex aspect-video flex-col overflow-hidden border border-white/10 bg-linear-to-br from-slate-950 via-slate-900 to-slate-950 text-left"
    >
      {/* Browser chrome */}
      <div className="flex shrink-0 items-center gap-1.5 border-b border-white/10 px-5 py-3">
        <span className="size-2.5 rounded-full bg-white/15" />
        <span className="size-2.5 rounded-full bg-white/15" />
        <span className="size-2.5 rounded-full bg-white/15" />
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Sidebar */}
        <aside className="hidden w-36 shrink-0 flex-col gap-1 border-r border-white/10 bg-black/30 p-4 sm:flex">
          <span className="mb-3 text-sm font-bold tracking-tight text-white">
            Trace
          </span>
          {NAV.map((item, i) => (
            <span
              key={item}
              className={`rounded-md px-2.5 py-1.5 text-[11px] ${
                i === 0
                  ? "bg-indigo-500/10 font-medium text-indigo-300"
                  : "text-slate-400"
              }`}
            >
              {item}
            </span>
          ))}
        </aside>

        {/* Main */}
        <div className="flex min-w-0 flex-1 flex-col gap-3 p-4 sm:p-5">
          {/* Header */}
          <div className="flex items-center justify-between">
            <span className="text-sm font-bold text-white">Overview</span>
            <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] text-slate-400">
              Last 30 days
            </span>
          </div>

          {/* KPI row */}
          <div className="grid shrink-0 grid-cols-4 gap-2.5">
            {KPIS.map(({ label, value, delta, hero }) => (
              <div
                key={label}
                className="rounded-xl border border-white/10 bg-white/5 p-2.5 backdrop-blur-md sm:p-3"
              >
                <p className="truncate text-[9px] tracking-wider text-slate-400 uppercase sm:text-[10px]">
                  {label}
                </p>
                <p className="mt-1 font-mono text-xs font-bold text-white sm:text-base">
                  {value}
                </p>
                <p
                  className={`mt-0.5 font-mono text-[9px] sm:text-[10px] ${
                    hero ? "text-emerald-400" : "text-slate-500"
                  }`}
                >
                  {delta}
                </p>
              </div>
            ))}
          </div>

          {/* Chart + top ads */}
          <div className="grid min-h-0 flex-1 grid-cols-3 gap-2.5">
            <div className="col-span-3 flex min-h-0 flex-col rounded-xl border border-white/10 bg-white/5 p-3 backdrop-blur-md sm:col-span-2">
              <div className="flex items-center gap-4 text-[10px] text-slate-400">
                <span className="flex items-center gap-1.5">
                  <span className="size-1.5 rounded-full bg-indigo-400" />
                  L2 revenue
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="size-1.5 rounded-full bg-slate-400" />
                  L1
                </span>
              </div>
              <svg
                viewBox="0 0 600 200"
                preserveAspectRatio="none"
                className="mt-2 min-h-0 w-full flex-1"
              >
                <defs>
                  <linearGradient id="lpMockFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="rgb(129 140 248)" stopOpacity="0.25" />
                    <stop offset="100%" stopColor="rgb(129 140 248)" stopOpacity="0" />
                  </linearGradient>
                </defs>
                {[50, 100, 150].map((y) => (
                  <line
                    key={y}
                    x1="0"
                    y1={y}
                    x2="600"
                    y2={y}
                    stroke="rgb(255 255 255 / 6%)"
                    strokeWidth="1"
                  />
                ))}
                <path
                  d="M0,170 C60,164 95,152 130,140 C180,124 205,132 250,110 C300,84 325,94 380,70 C440,44 480,54 520,34 C560,18 585,16 600,14 L600,200 L0,200 Z"
                  fill="url(#lpMockFill)"
                />
                <path
                  d="M0,170 C60,164 95,152 130,140 C180,124 205,132 250,110 C300,84 325,94 380,70 C440,44 480,54 520,34 C560,18 585,16 600,14"
                  fill="none"
                  stroke="rgb(129 140 248)"
                  strokeWidth="2.5"
                  vectorEffect="non-scaling-stroke"
                />
                <path
                  d="M0,182 C100,178 200,172 300,166 C400,160 500,156 600,150"
                  fill="none"
                  stroke="rgb(148 163 184 / 60%)"
                  strokeWidth="1.5"
                  vectorEffect="non-scaling-stroke"
                />
              </svg>
            </div>

            <div className="hidden min-h-0 flex-col rounded-xl border border-white/10 bg-white/5 p-3 backdrop-blur-md sm:flex">
              <p className="text-[10px] tracking-wider text-slate-400 uppercase">
                Top ads · L2
              </p>
              <div className="mt-2.5 flex flex-col gap-2.5">
                {TOP_ADS.map(({ name, value, bar, win }) => (
                  <div key={name}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-[10px] text-slate-300">
                        {name}
                      </span>
                      <span
                        className={`font-mono text-[10px] ${
                          win ? "text-emerald-300" : "text-slate-400"
                        }`}
                      >
                        {value}
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 rounded-full bg-white/8">
                      <span
                        className={`block h-full rounded-full ${bar} ${
                          win ? "bg-emerald-400/80" : "bg-indigo-400/50"
                        }`}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
