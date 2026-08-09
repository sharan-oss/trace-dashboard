# Trace Design System

The UX/UI system used by the Trace admin dashboard, extracted so a new dashboard can adopt it 1:1. Every recipe below is copied from live code — use the class strings verbatim and the new app will match Trace exactly.

**The look in one line:** a dark *glass console* — deep slate gradient canvas, frosted white-alpha surfaces, indigo as the only action color, emerald/red reserved for status, compact typography, no shadows (elevation = opacity).

---

## 1. Stack

| Layer | Choice | Notes |
|---|---|---|
| Framework | Next.js 16 App Router, React 19 | Server components by default; `"use client"` only for forms/interactivity |
| Styling | Tailwind CSS v4 (`@tailwindcss/postcss`) | CSS-first config in `globals.css` via `@theme`; no `tailwind.config` |
| Components | shadcn v4, style **`base-nova`**, base color **neutral** | Built on `@base-ui/react` primitives, CVA variants |
| Animation | `tw-animate-css` | Plus Tailwind `animate-spin` for loaders |
| Icons | `lucide-react` | Small sizes only (11–18px), see §3.6 |
| Font | **Geist** via `next/font/google`, exposed as `--font-sans` | Mono via Tailwind `font-mono` for keys/slugs/code |
| Class merging | `cn()` = `clsx` + `tailwind-merge` in `src/lib/utils` | |

Root layout:

```tsx
const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });
<html lang="en" className={cn("font-sans", geist.variable)}>
```

---

## 2. Foundations

### 2.1 Canvas & theme

Dark-only. The app shell paints the canvas; everything else sits on it with white-alpha.

```
bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-white
```

Native date/select inputs get `[color-scheme:dark]` so browser chrome matches.

### 2.2 Surface ladder (elevation = alpha, never shadows)

| Surface | Recipe |
|---|---|
| Canvas | slate gradient above |
| Sidebar | `bg-black/30 border-r border-white/10` |
| **Card (the workhorse)** | `backdrop-blur-md bg-white/5 border border-white/10 rounded-2xl` |
| Card hover (clickable) | `hover:bg-white/8 hover:border-white/20 transition-all` |
| Inset well (API key display) | `bg-black/30 border border-white/10 rounded-lg` |
| Code block | `bg-black/50 border border-white/10 rounded-xl` |
| Pill / tag | `bg-white/5 border border-white/10 rounded-full` |
| Hover wash (ghost buttons, nav) | `hover:bg-white/5` |

Row separators inside cards: `border-white/10` for structural lines (table header, card footer `border-t border-white/8`), `border-white/5` for row dividers (`last:border-0`).

### 2.3 Color roles

**Text ladder (slate):**

| Role | Class |
|---|---|
| Primary text, headings | `text-white` |
| Body, form labels, table cells | `text-slate-300` |
| Secondary: subtitles, meta, table headers, muted labels | `text-slate-400` |
| Tertiary: hints, timestamps, placeholders, slugs | `text-slate-500` |
| Decorative / empty-state icons | `text-slate-600` |

**Accent (indigo) — the only action color:**

| Role | Class |
|---|---|
| Primary button bg | `bg-indigo-600` → `hover:bg-indigo-500` |
| Focus ring | `focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50` |
| Inline links, accent icons | `text-indigo-400` |
| Accent text on dark (hover titles, key values, highlighted table numbers) | `text-indigo-300` |

**Status — never used decoratively:**

| Role | Class |
|---|---|
| Success text | `text-emerald-400` (table numbers: `text-emerald-300`; copy confirmation: `text-green-400`) |
| Error text | `text-red-400` |
| Error banner | `text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3` |

### 2.4 Typography scale (fixed rem — no fluid type in the dashboard)

| Level | Recipe |
|---|---|
| Page title | `text-2xl font-bold text-white` |
| Section heading | `text-lg font-semibold text-white` |
| Card title | `text-base font-semibold` (list cards) / `text-sm font-medium` (dense cards) |
| Big number (price, metric) | `text-xl font-bold text-white` |
| Body, buttons, inputs | `text-sm` |
| Meta, tables, badges, helper text | `text-xs` |
| **Eyebrow label** (card section headers) | `text-xs font-semibold text-slate-400 uppercase tracking-wider` |
| Monospace (API keys, slugs, code) | `font-mono` + the level's size |

Subtitles sit directly under titles: `text-slate-400 text-sm mt-1` (or `mt-0.5`).

### 2.5 Radius scale

| Element | Class |
|---|---|
| Buttons, inputs, inset wells, banners | `rounded-lg` |
| Small ghost buttons | `rounded-md` |
| Code blocks | `rounded-xl` |
| Cards | `rounded-2xl` |
| Pills, gateway tags | `rounded-full` |

(shadcn base: `--radius: 0.625rem` with derived sm→4xl steps.)

### 2.6 Spacing & icons

- Page sections: `space-y-6` (list pages) or `space-y-8` (detail pages)
- Main content area: `p-8`; sidebar: `w-60 p-6 gap-6`
- Card padding: `p-5` (display cards), `p-6` (form cards), `p-10`/`p-12` (empty states)
- Form: fields `space-y-5`, label→input `space-y-1.5`, form width `max-w-lg`
- Card grids: `grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-3`
- Icon sizes (lucide `size` prop): **11–12** inline meta, **13–15** buttons/nav, **18** back arrow, **24** empty-state icon. Never larger.

---

## 3. Component recipes

### 3.1 App shell + sidebar

```tsx
<div className="flex min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-white">
  <aside className="w-60 flex-shrink-0 bg-black/30 border-r border-white/10 flex flex-col gap-6 p-6">
    <div className="flex items-center gap-2">
      <span className="text-white font-bold text-lg tracking-tight">Trace</span>
      <span className="text-slate-500 text-xs font-medium bg-white/5 px-2 py-0.5 rounded">admin</span>
    </div>
    <nav className="flex flex-col gap-1">
      <Link href="…" className="flex items-center gap-3 px-3 py-2 rounded-lg text-slate-300 hover:text-white hover:bg-white/5 transition-colors text-sm font-medium">
        <Users size={15} /> Clients
      </Link>
    </nav>
  </aside>
  <main className="flex-1 p-8 overflow-auto">{children}</main>
</div>
```

### 3.2 Page header

Title + subtitle left, primary action right. Detail pages prepend a back arrow.

```tsx
<div className="flex items-center justify-between">
  <div className="flex items-center gap-3">
    <Link href="…" className="text-slate-400 hover:text-white transition-colors">
      <ArrowLeft size={18} />
    </Link>
    <div>
      <h1 className="text-2xl font-bold text-white">Client Name</h1>
      <p className="text-slate-400 text-sm mt-0.5">subtitle / domains</p>
    </div>
  </div>
  {/* action button here */}
</div>
```

### 3.3 Buttons

**Primary (indigo — one per view):**

```
flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60
text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors
```

Usually leads with an icon (`<Plus size={15} />`, `<RefreshCw size={14} />`).

**Secondary (outline):**

```
flex items-center gap-2 text-slate-400 hover:text-white border border-white/10
hover:border-white/20 text-sm font-medium px-3 py-2 rounded-lg transition-colors
```

**Ghost / icon-only:**

```
flex items-center gap-1.5 text-slate-400 hover:text-white px-3 py-2 rounded-lg
hover:bg-white/5 transition-colors
```

**Loading state** (server actions via `useFormStatus`): swap icon for `<Loader2 size={14} className="animate-spin" />` and label to a progressive verb — `"Saving…"`, `"Syncing…"`.

### 3.4 Forms

The canonical input class (shared by `<input>` and `<select>`):

```
w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white
placeholder-slate-500 focus:outline-none focus:border-indigo-500
focus:ring-1 focus:ring-indigo-500/50 transition-colors
```

(Add `[color-scheme:dark]` for date inputs; drop `w-full` for inline filter forms.)

Field structure:

```tsx
<div className="space-y-1.5">
  <label className="block text-sm font-medium text-slate-300">Client Name</label>
  <p className="text-xs text-slate-500">Optional helper text, one short sentence.</p>
  <input className={inputClass} placeholder="e.g. MNW Academy" />
</div>
```

Fields are grouped into form cards (`backdrop-blur-md bg-white/5 border border-white/10 rounded-2xl p-6 space-y-5`), each headed by an eyebrow label. Submit sits bottom-right: `<div className="flex justify-end">`. Inline result messages: `text-red-400 text-xs` / `text-emerald-400 text-xs`; block errors use the error banner (§2.3).

### 3.5 Cards & card grids

```tsx
<div className="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
  <Link href="…">
    <div className="backdrop-blur-md bg-white/5 border border-white/10 rounded-2xl p-5
                    hover:bg-white/8 hover:border-white/20 transition-all cursor-pointer group">
      <h2 className="text-white font-semibold text-base group-hover:text-indigo-300 transition-colors mb-4">
        Title
      </h2>
      <div className="space-y-2">{/* icon+text meta rows, text-xs text-slate-400 */}</div>
      <div className="mt-4 pt-4 border-t border-white/8 flex items-center justify-between">
        <span className="text-xs text-slate-500">9 Aug 2026</span>
        <span className="text-xs bg-white/5 border border-white/10 text-slate-300 px-2 py-0.5 rounded-full capitalize">tag</span>
      </div>
    </div>
  </Link>
</div>
```

Signature moves: title turns `indigo-300` on card hover; meta rows are `flex items-center gap-2 text-xs text-slate-400` with an 11px lucide icon; footer separated by `border-t border-white/8`.

### 3.6 Status badges

Icon + word, colored text only — no filled backgrounds:

```tsx
<span className="flex items-center gap-1 text-emerald-400 text-xs font-medium"><CheckCircle2 size={12} /> ok</span>
<span className="flex items-center gap-1 text-red-400 text-xs font-medium"><XCircle size={12} /> error</span>
<span className="flex items-center gap-1 text-slate-400 text-xs font-medium"><CircleDashed size={12} className="animate-spin" /> running</span>
```

### 3.7 Data tables

Tables live inside a card with `overflow-hidden` + inner `overflow-x-auto`:

```tsx
<table className="w-full text-left text-xs">
  <thead>
    <tr className="border-b border-white/10 text-slate-400">
      <th className="px-4 py-2.5 font-medium">Started</th>
      <th className="px-4 py-2.5 font-medium text-right">Pulled</th>
    </tr>
  </thead>
  <tbody>
    <tr className="border-b border-white/5 last:border-0 text-slate-300">
      <td className="px-4 py-2.5 whitespace-nowrap">…</td>
      <td className="px-4 py-2.5 text-right">…</td>
    </tr>
  </tbody>
</table>
```

Conventions: numbers right-aligned; semantically meaningful columns tinted (`text-indigo-300` = new/highlight, `text-emerald-300` = success counts); secondary columns `text-slate-400`; date ranges written `04 Aug → 06 Aug`.

### 3.8 Code block + copy

```tsx
<pre className="bg-black/50 border border-white/10 rounded-xl p-4 overflow-x-auto text-xs text-slate-200 font-mono leading-relaxed whitespace-pre-wrap">
```

Single-value well (API keys): `flex-1 font-mono text-sm text-indigo-300 bg-black/30 border border-white/10 px-4 py-2.5 rounded-lg truncate` with a ghost `CopyButton` beside it. Copy feedback: icon swaps to `<Check className="text-green-400" />` (+ "Copied!" label in blocks), reverts after 2000ms.

### 3.9 Empty states

An empty state is a card that teaches — centered, generous padding, muted icon, and an inline link to the fix:

```tsx
<div className="backdrop-blur-md bg-white/5 border border-white/10 rounded-2xl p-10 text-center">
  <Package size={24} className="text-slate-600 mx-auto mb-3" />
  <p className="text-slate-400 text-sm">
    No products yet. <Link href="…" className="text-indigo-400 hover:underline">Create the first one</Link>
  </p>
</div>
```

---

## 4. Interaction & motion

- **Transitions:** `transition-colors` everywhere; `transition-all` only on cards (border + bg animate together). No durations specified — Tailwind defaults.
- **Hover = brighten:** raise the alpha (`white/5` → `white/8`, `white/10` → `white/20`), lift the text a rung (`slate-400` → `white`, title → `indigo-300`). Never shadows, never scale.
- **Loading:** `Loader2`/`CircleDashed` with `animate-spin`; buttons also get `disabled:opacity-60` and a progressive label.
- **No modals.** Create/edit are full pages with a back arrow; destructive-adjacent flows get their own route.
- **Optimistic copy:** clipboard writes assume success, show confirmation, revert after 2s.

## 5. UX writing

- Sentence case everywhere except eyebrow labels (uppercase) and button labels (Title Case: "New Client", "Save Changes").
- Helper text: one terse sentence under the label, `text-xs text-slate-500`. State consequences plainly ("Requests from other domains will be blocked by CORS.").
- Secret fields: `(optional — leave blank to keep existing)` in `text-slate-500 font-normal` inside the label.
- Dates: `en-IN` locale — `9 Aug 2026` for dates, `04 Aug, 02:15 pm` for timestamps, `04 Aug → 06 Aug` for ranges.
- Currency: `₹{(paise / 100).toLocaleString("en-IN")}`.

## 6. shadcn foundation (for token-driven components)

The repo also carries the stock shadcn **base-nova / neutral** token layer in `globals.css` (OKLCH, light + `.dark`, `--radius: 0.625rem`) powering `src/components/ui/` (button, badge, card, input, label, separator — CVA variants on `@base-ui/react`). The admin surface predates it and styles directly with the slate/indigo recipes above.

**For the new dashboard, pick one of:**
1. **Fastest parity:** copy the recipes in this doc as shared components (`GlassCard`, `PrimaryButton`, `inputClass`, …) and skip shadcn tokens for admin surfaces.
2. **Cleaner long-term:** keep shadcn components, but remap the `.dark` tokens to this system — `--background` ≈ slate-950 gradient stops, `--card` ≈ white/5 over slate, `--primary` = indigo-600, `--destructive` = red-400 family, `--border` = `oklch(1 0 0 / 10%)` (already matches), radius `--radius: 0.625rem` (cards use `rounded-2xl`).

Either way, keep the invariants: dark-only, alpha-based elevation, indigo-only actions, icon+text status badges, no shadows, no modals.

## 7. Porting checklist for the new dashboard

1. Install: `tailwindcss@4`, `tw-animate-css`, `lucide-react`, `clsx` + `tailwind-merge` (and shadcn + `@base-ui/react` if going token route).
2. Load Geist as `--font-sans`; set `font-sans` on `<html>`.
3. Copy the app shell (§3.1) — gradient canvas, `w-60` sidebar, `p-8` main.
4. Create shared constants/components: `inputClass`, `GlassCard`, `PrimaryButton`, `StatusBadge`, `CopyButton`, `EmptyState`.
5. Hold the color discipline: slate ladder for text, indigo for actions only, emerald/red for status only.
6. Hold the density: `text-sm` controls, `text-xs` data, `p-5` cards, `gap-4` grids, lucide ≤ 18px.
