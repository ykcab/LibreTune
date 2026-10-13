# Startup dashboard — design record

> Written before implementation, kept as the rationale for the rewrite. The
> component was rebuilt from scratch in Oct 2026 (branch `feat/startup-dash-v2`).

## Why a rewrite

Four previous passes (F1 broadcast replica, "de-F1" pass, purpose-built
LiveScope, Motorsport monitor) shared one problem: they were *pictures of a
dashboard*. Fixed lane sets, fixed thresholds, hard-coded °C/kPa, a footer of
warning chips, and no answer to the only question a tuner actually asks on
glance — **"is what the engine is doing what the tune asked for?"**

The Startup face is the first thing shown after a project loads and the surface
people leave open while driving. It has to be a truthful instrument, not a
poster. So it was rebuilt around three ideas:

1. **Measured vs. commanded is the primary read.** Every hero value carries the
   target it is being judged against (λ vs. λ target, boost vs. boost target,
   fuel trim around 100 %, coolant vs. fan/limit bands) — never a bare number.
2. **Only show what the ECU actually publishes.** Every tile resolves its
   channel from the loaded INI's channel list at runtime. A Speeduino 4-cyl and
   a rusEFI V8 do not get the same face, and nothing is invented when a channel
   is missing.
3. **Density with hierarchy.** Dense does not mean noisy: hairlines, three type
   sizes, one accent per channel, no decoration. Density 9 / motion 2 on the
   UI/UX Pro Max dials (`--density 9 --motion 2 --variance 2`), style direction
   *Minimalism & Swiss* (grid-based, high contrast, essential) modulated by the
   dark-control-room palette. The landing-page pattern, light palette and the
   suggested font swap the generator also returned were rejected — this repo
   already owns its tokens (`src/themes/variables.css`) and its type stack
   (IBM Plex Sans/Mono + Barlow Condensed for numerals).

## Non-negotiables taken from the UI/UX guidance

- Real-time streaming charts: Canvas, 60–300 s buffer, current value + status
  text beside the trace, **pause/resume**, zoom/window control, and a visible
  data alternative (numeric gutters + cursor readout as DOM text).
- Never encode meaning in colour alone: every threshold is labelled with a
  number and every state has text ("LEAN +4.2 %", "LIMIT 105 °C").
- Threshold zones are printed next to the value (bullet-meter pattern), not
  hidden behind a gauge needle.
- Anomalies are a separate layer: shaped markers on the trace **and** a
  persistent event list (never hover-only).
- Contrast ≥ 4.5:1 for text, visible focus rings, `prefers-reduced-motion`
  honoured, no fake controls — every button performs a real command.

## Layout

```
┌ status ─────────────────────────────────────────────────────────────────────┐
│ project · ECU/INI · link · rate · log control · version-control state        │
├ engine rail ─┬────────── scope ────────────┬─ fuel & load rail ─────────────┤
│ state, RPM,  │ multi-channel canvas scope  │ λ vs target, trim, duty/PW,    │
│ load, TPS,   │ cursor + markers + target   │ fuel pressure, EGT, knock      │
│ temperatures │ overlay, lane picker, pause │ flex, baro                     │
├──────────────┴─────────────────────────────┴────────────────────────────────┤
│ active events · fuel-error statistics · operating-envelope coverage map      │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Data model

- `channels.ts` — the channel catalogue: canonical ids, candidate stream keys,
  source unit, display range, ascending threshold bands, gap semantics, trace
  accent, and `adaptSpecToUnit`, which re-expresses a spec (unit, range **and
  bands**) in the unit the loaded INI actually declares — a MegaSquirt
  definition publishing coolant in °F must not be judged against 105 °C. Pure
  functions for resolution, tone, band lookup, engine-state derivation and
  unit-aware formatting. Everything else is table-driven.
- `session.ts` — `TelemetrySession`: a frame-rate-independent accumulator fed
  one sample per stream tick. Owns event detection (band rules + fueling error
  + dropouts + sync loss + overboost), the operating-envelope heat map
  (dwell **and** mean fuelling error per rpm × MAP cell), fuel-error statistics,
  session extremes, link health (rate, staleness) and armed-rule accounting.
- `EngineScope.tsx` — canvas scope: right-aligned lanes, fixed curated ranges
  (auto-range with a printed range for unknown channels), measured/target
  overlay, shaped anomaly markers nearest the live edge, labelled time grid,
  pointer + keyboard cursor (announced for screen readers), pause that freezes
  the window, and gap ticks on dead sensors.
- `StartupDash.tsx` — composition, status polling, imports. No channel literals
  outside the catalogue.

## Verification

- Unit tests for the catalogue (resolution order, tone, band lookup, unit
  conversion, INI unit adaptation, formatting) and the session accumulator
  (event latching, hysteresis, coverage binning, fuelling statistics and
  per-cell error, staleness, armed rules, marker ordering).
- Render + interaction tests for the dash with a mocked `invoke` and a seeded
  realtime store (tile gap semantics, window/pause/mode controls, channel
  picker, accessible value table, offline wording).
- A standalone screenshot harness (untracked, `harness/`) renders the real
  component with a deterministic driving profile through a stubbed Tauri IPC
  layer. The review pass also drove it through an automated audit that fails on
  clipped or overlapping content and asserts that every control changes state,
  at 1600×900 / 1440×900 / 1280×800 / 1024×720 / 900×700.
- Two independent reviews (visual/UX against those renders, and a code audit)
  were worked through; the fixes they produced are listed in `CHANGELOG.md`
  under *Startup dashboard: design + code review pass*.
