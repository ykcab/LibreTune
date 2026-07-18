# LibreTune Work Tracker

Lightweight running tracker for current support/dev work.

## In Progress

- Trigger logger reliability (rusEFI/epicEFI): validating capture behavior on real ECU after parser/readiness/retry fixes.

## Recently Done

- Datalog timing drift fix in recorder scheduler (fixed-cadence sampling).
- Datalog usefulness pass: default logging narrowed to tuning-relevant channels; Data Log view now records selected graph channels.
- Trigger/composite logger hardening:
  - ECU-kind routing cleanup (Speeduino vs rusEFI-family vs MS).
  - rusEFI trigger read retries, readiness polling, safer timestamp decoding/interval filtering.
  - Composite timestamps normalized and sample-rate derived from actual capture.
- DFU `.bin` safety improvements:
  - `.bin` in DFU routed through `dfu-util`.
  - Safe preset address behavior implemented for rusEFI-family targets (`0x08008000` default app region).
- Startup monitor dashboard: added `LPFP` and `HPFP` rows in Fuel section with channel fallbacks.

## Session: 2026-07-17

### File-Level Summary (Current Working Set)

- `src-tauri/src/commands/data_logging.rs` — Added focused default channel profile (TS-style useful channels) and optional requested-channel logging support.
- `src-tauri/src/commands/diagnostic_loggers.rs` — Reworked trigger/composite capture for rusEFI-family with readiness polling, retries, robust record parsing, and safer timestamp handling.
- `src-tauri/src/commands/firmware_update.rs` — Hardened DFU `.bin` flow to safe tooling/pathing and added ECU-aware safe preset app address logic (`0x08008000` for rusEFI-family).
- `src-tauri/src/commands/ini_dialogs.rs` — Added case-insensitive dialog lookup fallback to fix missing menu/dialog opens caused by INI name casing differences.
- `src-tauri/src/commands/sync_ecu_data.rs` — Added tune-mismatch snapshot + human-readable per-setting diff command for ECU vs project comparison.
- `src-tauri/src/commands/tune_misc.rs` — Updated "use project tune" path to burn directly to ECU and clear mismatch snapshot state after resolution.
- `src-tauri/src/lib.rs` — Registered/connected new commands and state wiring needed for mismatch diffing and related fixes.
- `src-tauri/src/state.rs` — Added persistent tune mismatch snapshot state to support readable side-by-side diff generation.
- `src/components/dashboards/StartupMonitor.tsx` — Added `LPFP` and `HPFP` readouts in Fuel section with channel fallbacks.
- `src/components/dialogs/FirmwareUpdateDialog.tsx` — Updated DFU `.bin` UI guidance to reflect `dfu-util` usage and safe preset address behavior.
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
