/*
 * Section 4 — the product shot, built as code (no Gemini image). This is
 * the client's DREAM MONTH, deliberately dramatic (2026-08-10): hockey-stick
 * L2 curve with annotations, crore numbers, junk ads paused, live payments
 * arriving. Numbers are illustrative, not claims. Visual language mirrors
 * the real dashboard (dark glass, white-alpha cards, indigo series, emerald
 * money) so the product doesn't disappoint after the page.
 */

const KPIS = [
  { label: "L2 Revenue", value: "₹1.2Cr", delta: "+218%", hero: true },
  { label: "L1 Revenue", value: "₹18.4L", delta: "+41%", hero: false },
  { label: "Sessions", value: "48,213", delta: "+64%", hero: false },
  { label: "L2 ROAS", value: "11.4×", delta: "+3.1", hero: true },
];

const TOP_ADS = [
  {
    name: "Webinar – Hook A",
    value: "₹68.4L",
    bar: "w-full",
    state: "scaled" as const,
  },
  {
    name: "Reel – Story 02",
    value: "₹31.2L",
    bar: "w-1/2",
    state: "live" as const,
  },
  {
    name: "Reel – Discount",
    value: "₹0",
    bar: "w-[2%]",
    state: "paused" as const,
  },
];

const FEED = [
  { amount: "₹49,000", tier: "L2", ad: "Webinar – Hook A", when: "just now" },
  { amount: "₹49,000", tier: "L2", ad: "Webinar – Hook A", when: "4m" },
  { amount: "₹4,999", tier: "L1", ad: "Reel – Story 02", when: "6m" },
  { amount: "₹49,000", tier: "L2", ad: "Reel – Story 02", when: "11m" },
];

const NAV = ["Overview", "Ads", "Funnel", "Customers"];

export function DashboardMock() {
  return (
    <div
      aria-hidden
      className="relative flex aspect-video flex-col overflow-hidden border border-white/10 bg-linear-to-br from-slate-950 via-slate-900 to-slate-950 text-left"
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
                className={`rounded-xl border p-2.5 backdrop-blur-md sm:p-3 ${
                  hero
                    ? "border-emerald-400/20 bg-emerald-400/5"
                    : "border-white/10 bg-white/5"
                }`}
              >
                <p className="truncate text-[9px] tracking-wider text-slate-400 uppercase sm:text-[10px]">
                  {label}
                </p>
                <p className="mt-1 font-mono text-xs font-bold text-white sm:text-lg">
                  {value}
                </p>
                <p
                  className={`mt-0.5 font-mono text-[9px] sm:text-[10px] ${
                    hero ? "text-emerald-400" : "text-emerald-400/70"
                  }`}
                >
                  ▲ {delta}
                </p>
              </div>
            ))}
          </div>

          {/* Chart + right column */}
          <div className="grid min-h-0 flex-1 grid-cols-3 gap-2.5">
            {/* Chart with annotations */}
            <div className="relative col-span-3 flex min-h-0 flex-col rounded-xl border border-white/10 bg-white/5 p-3 backdrop-blur-md sm:col-span-2">
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
              <div className="relative mt-2 min-h-0 w-full flex-1">
                <svg
                  viewBox="0 0 600 200"
                  preserveAspectRatio="none"
                  className="h-full w-full"
                >
                  <defs>
                    <linearGradient
                      id="lpMockFill"
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop
                        offset="0%"
                        stopColor="rgb(129 140 248)"
                        stopOpacity="0.35"
                      />
                      <stop
                        offset="100%"
                        stopColor="rgb(129 140 248)"
                        stopOpacity="0"
                      />
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
                  {/* the day the junk ads were killed */}
                  <line
                    x1="290"
                    y1="12"
                    x2="290"
                    y2="200"
                    stroke="rgb(248 113 113 / 45%)"
                    strokeWidth="1"
                    strokeDasharray="4 4"
                    vectorEffect="non-scaling-stroke"
                  />
                  {/* L2: flat grind → hockey stick after the kill */}
                  <path
                    d="M0,180 C70,177 140,174 200,170 C250,166 275,160 290,152 C320,136 340,110 380,84 C420,58 460,40 510,24 C555,12 585,8 600,6 L600,200 L0,200 Z"
                    fill="url(#lpMockFill)"
                  />
                  <path
                    d="M0,180 C70,177 140,174 200,170 C250,166 275,160 290,152 C320,136 340,110 380,84 C420,58 460,40 510,24 C555,12 585,8 600,6"
                    fill="none"
                    stroke="rgb(129 140 248)"
                    strokeWidth="2.5"
                    vectorEffect="non-scaling-stroke"
                  />
                  {/* L1 baseline */}
                  <path
                    d="M0,188 C100,185 200,182 300,178 C400,174 500,170 600,164"
                    fill="none"
                    stroke="rgb(148 163 184 / 60%)"
                    strokeWidth="1.5"
                    vectorEffect="non-scaling-stroke"
                  />
                </svg>
                {/* HTML annotations (SVG text would distort) */}
                <span className="absolute top-[2%] left-[48.3%] -translate-x-full rounded-md border border-red-400/30 bg-slate-950/90 px-2 py-1 text-[9px] whitespace-nowrap text-red-300">
                  2 junk ads killed
                </span>
                <span className="absolute top-[3%] right-0 flex items-center gap-1.5 rounded-md border border-emerald-400/30 bg-slate-950/90 px-2 py-1">
                  <span className="lp-ping size-1.5 rounded-full bg-emerald-400" />
                  <span className="font-mono text-[10px] font-bold text-emerald-300">
                    ₹1.2Cr
                  </span>
                </span>
              </div>
            </div>

            {/* Right column: top ads + live feed */}
            <div className="hidden min-h-0 flex-col gap-2.5 sm:flex">
              <div className="rounded-xl border border-white/10 bg-white/5 p-3 backdrop-blur-md">
                <p className="text-[10px] tracking-wider text-slate-400 uppercase">
                  Top ads · L2
                </p>
                <div className="mt-2.5 flex flex-col gap-2.5">
                  {TOP_ADS.map(({ name, value, bar, state }) => (
                    <div key={name}>
                      <div className="flex items-center justify-between gap-2">
                        <span
                          className={`truncate text-[10px] ${
                            state === "paused"
                              ? "text-slate-500 line-through"
                              : "text-slate-300"
                          }`}
                        >
                          {name}
                        </span>
                        <span className="flex shrink-0 items-center gap-1.5">
                          {state === "scaled" && (
                            <span className="rounded-full bg-emerald-400/15 px-1.5 py-px text-[8px] font-semibold text-emerald-300">
                              SCALED 3×
                            </span>
                          )}
                          {state === "paused" && (
                            <span className="rounded-full bg-red-400/15 px-1.5 py-px text-[8px] font-semibold text-red-400">
                              PAUSED
                            </span>
                          )}
                          <span
                            className={`font-mono text-[10px] ${
                              state === "scaled"
                                ? "text-emerald-300"
                                : state === "paused"
                                  ? "text-red-400/80"
                                  : "text-slate-300"
                            }`}
                          >
                            {value}
                          </span>
                        </span>
                      </div>
                      <div className="mt-1 h-1.5 rounded-full bg-white/8">
                        <span
                          className={`block h-full rounded-full ${bar} ${
                            state === "scaled"
                              ? "bg-emerald-400/80"
                              : state === "paused"
                                ? "bg-red-400/60"
                                : "bg-indigo-400/60"
                          }`}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex min-h-0 flex-1 flex-col rounded-xl border border-white/10 bg-white/5 p-3 backdrop-blur-md">
                <p className="flex items-center gap-1.5 text-[10px] tracking-wider text-slate-400 uppercase">
                  <span className="lp-ping size-1.5 rounded-full bg-emerald-400" />
                  Live payments
                </p>
                <div className="mt-2.5 flex min-h-0 flex-col gap-2 overflow-hidden">
                  {FEED.map(({ amount, tier, ad, when }, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between gap-2"
                    >
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span
                          className={`shrink-0 rounded px-1 py-px font-mono text-[8px] font-bold ${
                            tier === "L2"
                              ? "bg-emerald-400/15 text-emerald-300"
                              : "bg-white/10 text-slate-400"
                          }`}
                        >
                          {tier}
                        </span>
                        <span
                          className={`shrink-0 font-mono text-[10px] ${
                            tier === "L2"
                              ? "font-bold text-emerald-300"
                              : "text-slate-300"
                          }`}
                        >
                          {amount}
                        </span>
                        <span className="truncate text-[9px] text-slate-500">
                          {ad}
                        </span>
                      </span>
                      <span className="shrink-0 text-[9px] text-slate-600">
                        {when}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
