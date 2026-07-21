# LibreTune Work Tracker

Lightweight running tracker for current support/dev work.

## In Progress

- Trigger logger reliability (rusEFI/epicEFI): validating capture behavior on real ECU after parser/readiness/retry fixes.

## Recently Done

- **CRITICAL:** Bits INI `[start:end]` was parsed as `[position:size]` — single-bit flags like `consumeObdSensors = [6:6]` read as 6 bits, so Trigger panels stayed hidden while TunerStudio correctly showed `false`. Fixed to inclusive start:end (`size = end - start + 1`).
- **CRITICAL:** Tune mismatch / Use LibreTune Settings no longer bulk-writes zero-padded MSQ pages (was corrupting ECU fields). Merge = ECU base + MSQ constants; Load Tune resets cache; sync compares materialized project pages.
- Signature mismatch: stop re-prompting on every reconnect after INI update (partial matches no longer open dialog; stamp `CurrentTune.msq` + persist project INI path).
- Signature compare: ECU build-hash suffix vs companion INI → Exact (stops “partially matches” toast spam).
- Tune mismatch resolve: **Use LibreTune Settings** saves chosen pages to `CurrentTune.msq` then writes/burns ECU; **Use ECU Settings** overwrites disk MSQ from ECU.
- Use LibreTune Settings ECU write: chunked `write_page` + retries (fixes Windows os error 121 timeout on full-page serial writes).
- Use LibreTune Settings: pause realtime stream + disable auto-burn during bulk write, then burn once and restart stream (prevents OCH poller from disconnecting the ECU).
- Firmware update (DFU) aligned with epicEFI Flasher:
  - DFU `.bin` load address fixed at `0x08000000` (was wrongly `0x08008000` — caused brick).
  - Addresses baked into backend; UI no longer exposes editable flash address.
  - Dialog decluttered: mode + file pick + status/log only.
  - Hide flashing-tool console windows on Windows (`CREATE_NO_WINDOW`).
- Data log: Start records a compact usable set (basics + rusEFI fuel/cranking); UI displays ~5–7 basic channels only. Status poll returns `channel_count` (no full name list) so Record stays responsive.
- Cherry-picked upstream PRs #60–#63 onto `dev` (no conflicts):
  - **#63** Group the graph-log channel picker
  - **#62** Table live-cursor improvements (follow by default, accurate marker, fading trace)
  - **#61** Live WBO status panel beside wideband tools dialog
  - **#60** Fix controller command variable substitution (wideband tools)
- Datalog timing drift fix in recorder scheduler (fixed-cadence sampling).
- Datalog usefulness pass: default logging narrowed to tuning-relevant channels; Data Log view now records selected graph channels.
- Trigger/composite logger hardening:
  - ECU-kind routing cleanup (Speeduino vs rusEFI-family vs MS).
  - rusEFI trigger read retries, readiness polling, safer timestamp decoding/interval filtering.
  - Composite timestamps normalized and sample-rate derived from actual capture.
- Startup monitor dashboard: added `LPFP` and `HPFP` rows in Fuel section with channel fallbacks.

## Session: 2026-07-20

- Confirmed epicEFI Firmware Flasher DFU `.bin` uses inferred address `0x08000000`; LibreTune matched that.
- Simplified `FirmwareUpdateDialog.tsx` (removed address field, guidance/companion/tool-path clutter).
- `firmware_update.rs`: DFU `.bin` default `0x08000000`; recovery app still `0x08008000`.
- Fixed post-firmware signature dialog loop + tune mismatch disk persistence (`use_project_tune` / `use_ecu_tune` / `update_project_ini`).

## Session: 2026-07-18

- Cherry-picked upstream **#60–#63** onto `dev` (no conflicts).
- Local CI hygiene: rustfmt, registered missing Tauri handlers (`get_autotune_status`, virtual dyno), fixed heatmap test (`afr_valid`), clippy clean on virtual_dyno.
- Documented in `CHANGELOG.md` / this tracker; portable build after green checks.

## Session: 2026-07-17

### File-Level Summary (Current Working Set)

- `src-tauri/src/commands/data_logging.rs` — Compact default channel profile and optional requested-channel logging.
- `src-tauri/src/commands/diagnostic_loggers.rs` — Reworked trigger/composite capture for rusEFI-family with readiness polling, retries, robust record parsing, and safer timestamp handling.
- `src-tauri/src/commands/firmware_update.rs` — DFU `.bin` at `0x08000000` (epicEFI/rusEFI Console); recovery app at `0x08008000`; Windows console-hide for flash tools.
- `src/components/dialogs/FirmwareUpdateDialog.tsx` — Slim DFU UI; addresses fixed in backend.
- `src-tauri/src/commands/ini_dialogs.rs` — Added case-insensitive dialog lookup fallback to fix missing menu/dialog opens caused by INI name casing differences.
- `src-tauri/src/commands/sync_ecu_data.rs` — Added tune-mismatch snapshot + human-readable per-setting diff command for ECU vs project comparison.
- `src-tauri/src/commands/tune_misc.rs` — Updated "use project tune" path to burn directly to ECU and clear mismatch snapshot state after resolution.
- `src-tauri/src/lib.rs` — Registered/connected new commands and state wiring needed for mismatch diffing and related fixes.
- `src-tauri/src/state.rs` — Added persistent tune mismatch snapshot state to support readable side-by-side diff generation.
- `src/components/dashboards/StartupMonitor.tsx` — Added `LPFP` and `HPFP` readouts in Fuel section with channel fallbacks.
- `src/components/dialogs/TuneMismatchDialog.css` — Added styles for the new human-readable diff table/chips layout.
- `src/components/dialogs/TuneMismatchDialog.tsx` — Replaced raw byte diff with readable setting-level Project vs ECU diff view.
- `src/components/tuner-ui/DataLogView.tsx` — Logging start/auto-start now passes selected graph channels; status polling and recording UX aligned to backend state.
- `../libretune-core/src/datalog/recorder.rs` — Fixed drift by switching logger to fixed-cadence scheduling (`next_sample_due`) instead of last-sample wall-clock gating.

## Next Up

- Validate trigger logger captures against ECU hardware logs and tune fallback aliases if channel names differ.
- Optional: remove redundant generic `Fuel Press` from Critical column now that LPFP/HPFP are in Fuel.
- Optional: promote this tracker into GitHub Issues for long-running roadmap visibility.

## How To Use

- Keep each item short and outcome-based.
- Move items from **In Progress** -> **Recently Done** as soon as they are verified.
- Add dates/links when creating commits/PRs.
