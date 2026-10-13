/**
 * Startup dashboard.
 *
 * The face LibreTune opens on: device/session identity on the status strip, the
 * engine vitals rail on the left, a live multi-channel scope in the middle, the
 * fuel/load rail on the right, and the analysis strip (events · fuelling
 * accuracy · operating envelope) along the bottom.
 *
 * Everything channel-shaped comes from `channels.ts`; every reading is rendered
 * through the unit-preference formatter; a tile whose channel the loaded INI does
 * not publish is simply not drawn, so the same component serves a Speeduino
 * four-cylinder and a rusEFI V8 without pretending either has channels it does
 * not.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useChannel } from '../../../stores/realtimeStore';
import { useUnitPreferences } from '../../../contexts/useUnitPreferences';
import {
  CHANNELS,
  CHANNEL_LIST,
  engineState,
  effectiveBoost,
  resolveKeys,
  toneFor,
  type ChannelSpec,
} from './channels';
import EngineScope from './EngineScope';
import { buildLanes, DEFAULT_LANE_IDS } from './lanes';
import { CoverageMap, EventsPanel, FuelingPanel } from './panels';
import {
  useDashStatus,
  useStartupTelemetry,
  useUnitDisplay,
  useValueFormatter,
  type ValueFormatter,
} from './useStartupTelemetry';
import { FuelErrorMeter, HeroTile, KeyValueGrid, Meter, SectionLabel, StatTile, StateChip, type KeyValueRow, type TileChannel, type TileTone } from './widgets';
import type { ChannelMeta } from './types';
import type { SessionExtremes } from './session';
import './StartupDash.css';

/* ------------------------------------------------------------------ helpers */

function formatClock(ms: number): string {
  const total = Math.floor(ms / 1000);
  return `${Math.floor(total / 60).toString().padStart(2, '0')}:${(total % 60).toString().padStart(2, '0')}`;
}

/** Session extremes, with the catalogue's own limits driving the tone. */
function extremesRows(
  extremes: SessionExtremes,
  values: Record<string, number>,
  fmt: ValueFormatter,
): KeyValueRow[] {
  const rows: KeyValueRow[] = [];
  const push = (label: string, channelId: string, value: number | undefined, digits = 0) => {
    if (value === undefined || !Number.isFinite(value)) return;
    const spec = CHANNELS[channelId];
    const formatted = fmt.format(spec.unit, digits, value);
    rows.push({
      label,
      value: `${formatted.text}${formatted.unit ? ` ${formatted.unit}` : ''}`,
      tone: toneFor(spec, value) === 'dim' ? undefined : (toneFor(spec, value) as TileTone),
    });
  };
  push('Max rpm', 'rpm', extremes.maxRpm);
  push('Max boost', 'boost', extremes.maxBoost);
  push('Max CLT', 'coolant', extremes.maxCoolant);
  push('Max EGT', 'egt', extremes.maxEgt);
  push('Min oil P', 'oilPressure', extremes.minOilPressure);
  push('Max speed', 'speed', extremes.maxSpeed);
  if (rows.length === 0 && values.rpm === undefined) {
    rows.push({ label: 'Awaiting', value: 'no extremes yet', tone: 'dim' });
  }
  return rows;
}

export interface StartupDashProps {
  /** ECU connection state, supplied by the dashboard host. */
  isConnected: boolean;
  /** Channel catalogue from the loaded INI (name/label/units). */
  channelMeta?: ChannelMeta[];
}

/** True for the startup face (`Startup.ltdash.xml`). */
export function isStartupDashPath(path: string | null | undefined): boolean {
  if (!path) return false;
  const base = path.replace(/\\/g, '/').split('/').pop()?.toLowerCase() ?? '';
  return base === 'startup.ltdash.xml' || base.startsWith('startup.');
}

/** Where the lane selection is remembered between sessions. */
const LANE_STORAGE_KEY = 'libretune-startup-lanes';
const WINDOW_OPTIONS = [5, 10, 20, 30];

function loadLaneIds(): string[] {
  try {
    const raw = window.localStorage.getItem(LANE_STORAGE_KEY);
    if (!raw) return DEFAULT_LANE_IDS;
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((v) => typeof v === 'string') && parsed.length > 0) {
      return parsed as string[];
    }
  } catch {
    /* fall through to defaults */
  }
  return DEFAULT_LANE_IDS;
}

/* ------------------------------------------------------------------ status strip */

interface StatusStripProps {
  identity: ReturnType<typeof useDashStatus>['identity'];
  logging: ReturnType<typeof useDashStatus>['logging'];
  snapshot: ReturnType<typeof useStartupTelemetry>['snapshot'];
  isConnected: boolean;
  onToggleLogging: () => void;
  logBusy: boolean;
  logError: string | null;
}

function StatusStrip({ identity, logging, snapshot, isConnected, onToggleLogging, logBusy, logError }: StatusStripProps) {
  const rate = snapshot.rateHz;
  const stale = snapshot.staleMs;
  const live = isConnected && stale < 1000;
  const linkLabel = !isConnected ? 'DISCONNECTED' : live ? 'LIVE' : stale === Infinity ? 'NO DATA' : `STALE ${(stale / 1000).toFixed(1)} s`;
  const linkTone = !isConnected ? 'dim' : live ? 'ok' : 'warn';
  const recSeconds = Math.floor(logging.durationMs / 1000);
  const recClock = `${Math.floor(recSeconds / 60).toString().padStart(2, '0')}:${(recSeconds % 60).toString().padStart(2, '0')}`;

  return (
    <header className="sd-status">
      <div className="sd-status__zone">
        <span className="sd-status__product">LIBRETUNE</span>
        {identity.project && <span className="sd-status__project">{identity.project}</span>}
        <span
          className="sd-status__meta"
          title={`ECU signature ${identity.signature ?? '(none)'}${identity.iniName ? ` · definition ${identity.iniName}` : ''}`}
        >
          {identity.signature ?? 'NO SIGNATURE'}
        </span>
      </div>

      <div className="sd-status__zone sd-status__zone--centre">
        <span className={`sd-status__pill sd-tone-${linkTone}`}>
          <i className="sd-status__dot" aria-hidden="true" />
          {linkLabel}
        </span>
        {identity.port && (
          <span className="sd-status__meta">
            {identity.port}
            {identity.baud ? ` @ ${identity.baud}` : ''}
          </span>
        )}
        <span className="sd-status__metric" title="Realtime stream rate">
          <b>{rate > 0 ? rate.toFixed(1) : '—'}</b> Hz
        </span>
        <span className="sd-status__metric" title="Channels in the most recent realtime frame">
          <b>{snapshot.frameChannels}</b> ch
        </span>
      </div>

      <div className="sd-status__zone sd-status__zone--right">
        {identity.hasTune && (
          <span className={`sd-status__pill sd-tone-${identity.tuneModified ? 'warn' : 'dim'}`} title="Tune file state">
            {identity.tuneModified ? 'UNSAVED CHANGES' : 'TUNE SAVED'}
          </span>
        )}
        <button
          type="button"
          className={`sd-status__log${logging.isRecording ? ' is-recording' : ''}`}
          onClick={onToggleLogging}
          disabled={logBusy || !isConnected}
          title={logging.isRecording ? 'Stop the internal logger' : 'Start logging every channel the ECU publishes'}
        >
          {logging.isRecording ? (
            <>
              <i className="sd-status__dot" aria-hidden="true" />
              REC {recClock}
              <span className="sd-status__log-sub">{logging.channelCount} ch · {logging.entryCount.toLocaleString()} samples</span>
            </>
          ) : (
            'START LOG'
          )}
        </button>
      </div>
      {logError && <span className="sd-status__error" role="alert">{logError}</span>}
    </header>
  );
}

/* ---------------------------------------------------------------------- tiles */

interface ChannelTileProps {
  spec: ChannelSpec;
  channelKey: string;
  fmt: ValueFormatter;
  detail?: ReactNode;
  /** Detail derived from the *live* value, so text and number can never disagree. */
  detailFor?: (value: number | undefined) => ReactNode;
  badge?: ReactNode;
  compact?: boolean;
}

/** A tile that subscribes to exactly one channel (re-renders with that channel). */
function ChannelTile({ spec, channelKey, fmt, detail, detailFor, badge, compact }: ChannelTileProps) {
  const value = useChannel(channelKey);
  return (
    <StatTile
      channel={spec}
      value={value}
      fmt={fmt}
      detail={detailFor ? detailFor(value) : detail}
      badge={badge}
      compact={compact}
    />
  );
}

/* ----------------------------------------------------------------------- dash */

export default function StartupDash({ isConnected, channelMeta = [] }: StartupDashProps) {
  const { session, snapshot, available } = useStartupTelemetry(isConnected, channelMeta);
  const status = useDashStatus(isConnected);
  const fmt = useValueFormatter();
  const unitDisplay = useUnitDisplay();
  const { preferences } = useUnitPreferences();

  const [laneIds, setLaneIds] = useState<string[]>(loadLaneIds);
  const [windowSec, setWindowSec] = useState(20);
  const [paused, setPaused] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    try {
      window.localStorage.setItem(LANE_STORAGE_KEY, JSON.stringify(laneIds));
    } catch {
      /* persistence is best-effort */
    }
  }, [laneIds]);

  const resolvedKeys = useMemo(() => {
    const map = new Map<string, string>();
    for (const id of snapshot.present) {
      const key = session.keyFor(id);
      if (key) map.set(id, key);
    }
    return map;
  }, [session, snapshot.present]);

  const lanes = useMemo(
    () => buildLanes(laneIds, resolvedKeys, channelMeta, unitDisplay),
    [laneIds, resolvedKeys, channelMeta, unitDisplay],
  );

  const present = useMemo(() => new Set(snapshot.present), [snapshot.present]);
  const values = snapshot.values;

  const limitKey = resolveKeys(CHANNELS.rpm.reference?.keys ?? [], available);
  const boostTargetKey = resolveKeys(['boostTarget', 'targetBoost', 'boostControlTarget'], available);
  // Reference/target channels are not part of the catalogue snapshot, so they
  // are subscribed to directly (they change rarely, so a dash-level re-render
  // is cheap and keeps the derived tiles honest).
  const limitValue = useChannel(limitKey ?? '__no_rpm_limit__');
  const boostTarget = useChannel(boostTargetKey ?? '__no_boost_target__');
  // The hero numerals read the stream directly: a 250 ms snapshot lag is
  // invisible on a gauge but not on a tachometer.
  const liveRpm = useChannel(session.keyFor('rpm') ?? '__no_rpm__');
  const liveSpeed = useChannel(session.keyFor('speed') ?? '__no_speed__');
  const liveGear = useChannel(session.keyFor('gear') ?? '__no_gear__');

  const state = engineState({
    rpm: values.rpm,
    tps: values.tps,
    map: values.map,
    softLimit: snapshot.flags.some((f) => f.label === 'SOFT LIMIT'),
    hardLimit: snapshot.flags.some((f) => f.label === 'HARD LIMIT'),
    launch: snapshot.flags.some((f) => f.label === 'LAUNCH'),
  });

  const rawValues = useMemo(() => {
    const out: Record<string, number> = {};
    for (const id of snapshot.present) {
      const key = session.keyFor(id);
      const value = snapshot.values[id];
      if (key !== undefined && value !== undefined) out[key] = value;
    }
    return out;
  }, [session, snapshot]);
  const boost = useMemo(() => effectiveBoost(rawValues, available), [rawValues, available]);

  const preferAfr = preferences.afr;
  const fuelUnit = preferAfr === 'Lambda' ? 'λ' : 'AFR';
  const fuelDigits = preferAfr === 'Lambda' ? 3 : 2;
  // The session reports λ; one conversion keeps the hero, the panel and the
  // trace all in the same unit.
  const toDisplay = (lambda: number) => lambda * unitDisplay('λ').scale;
  const hasTarget = snapshot.fuel.target !== undefined;

  const rpmTile = useMemo<TileChannel>(() => {
    const base = CHANNELS.rpm;
    // A redline is only marked when the ECU publishes one — never invented.
    const bands = limitValue !== undefined && limitValue > 0
      ? [{ max: limitValue, tone: 'ok' }, { max: Number.POSITIVE_INFINITY, tone: 'crit', label: 'LIMIT' }]
      : undefined;
    return {
      label: base.label,
      title: base.title,
      unit: base.unit,
      digits: base.digits,
      min: base.min,
      max: Math.max(base.max, (limitValue ?? 0) + 500),
      bands: bands as TileChannel['bands'],
    };
  }, [limitValue]);

  const boostTile: TileChannel = {
    label: boost.derived ? 'BOOST (DERIVED)' : 'BOOST',
    title: boost.derived ? 'Manifold pressure minus barometric pressure (derived)' : 'Boost pressure from the ECU',
    unit: 'kPa',
    digits: 0,
    min: -101,
    max: Math.max(200, (boostTarget ?? 0) + 40),
    // The ceiling is the ECU's commanded target; it is drawn as a threshold
    // tick, not as an invented limit.
    bands: boostTarget !== undefined && boostTarget > 0
      ? [
          { max: boostTarget, tone: 'ok' },
          { max: Number.POSITIVE_INFINITY, tone: 'warn', label: 'OVER TARGET' },
        ]
      : undefined,
  };

  const toggleLane = (id: string) => {
    setLaneIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const catalogueKeys = useMemo(() => new Set(resolvedKeys.values()), [resolvedKeys]);
  const catalogueIds = CHANNEL_LIST.filter((spec) => present.has(spec.id)).map((spec) => spec.id);
  const extraChannels = channelMeta.filter((meta) => !catalogueKeys.has(meta.name) && !meta.name.startsWith('_'));

  return (
    <div className="sd">
      <StatusStrip
        identity={status.identity}
        logging={status.logging}
        snapshot={snapshot}
        isConnected={isConnected}
        onToggleLogging={() => void status.toggleLogging()}
        logBusy={status.logBusy}
        logError={status.logError}
      />

      <div className="sd__main">
        {/* ---------------------------------------------------------- engine rail */}
        <aside className="sd__rail sd__rail--left" aria-label="Engine">
          <div className="sd-rail__head">
            <span className={`sd-state sd-tone-bg-${state.tone}`} title={`Derived from live channels: ${state.basis}`}>
              {state.label}
            </span>
            <span className="sd-rail__count">
              {snapshot.startedAt > 0
                ? `${Math.max(0, (Date.now() - snapshot.startedAt) / 1000).toFixed(0)} s session`
                : 'no samples'}
            </span>
          </div>

          <HeroTile
            label="ENGINE SPEED"
            value={fmt.format('', 0, liveRpm).text}
            unit="rpm"
            tone={liveRpm === undefined ? 'dim' : state.phase === 'load' ? 'warn' : 'neutral'}
            detail={
              <span className="sd-hero__sub">
                {snapshot.extremes.maxRpm !== undefined && `max ${fmt.format('', 0, snapshot.extremes.maxRpm).text}`}
                {liveSpeed !== undefined && ` · ${fmt.format('km/h', 0, liveSpeed).text} ${fmt.format('km/h', 0, liveSpeed).unit}`}
                {liveGear !== undefined && ` · gear ${fmt.format('', 0, liveGear).text}`}
              </span>
            }
            meter={<Meter channel={rpmTile} value={liveRpm} fmt={fmt} showTicks />}
            title="Engine speed, this session's maximum, and the ECU's rev limit when it publishes one"
          />

          <div className="sd-grid2">
            {present.has('map') && (
              <ChannelTile spec={CHANNELS.map} channelKey={session.keyFor('map') ?? 'map'} fmt={fmt} compact />
            )}
            {boost.value !== undefined && (
              <StatTile
                channel={boostTile}
                value={boost.value}
                fmt={fmt}
                compact
                detail={boostTarget !== undefined ? `target ${fmt.boundary('kPa', 0, boostTarget).text}` : undefined}
              />
            )}
          </div>

          <SectionLabel>LOAD & AIR</SectionLabel>
          <div className="sd-grid2">
            {present.has('tps') && <ChannelTile spec={CHANNELS.tps} channelKey={session.keyFor('tps') ?? 'tps'} fmt={fmt} compact />}
            {present.has('pedal') && <ChannelTile spec={CHANNELS.pedal} channelKey={session.keyFor('pedal') ?? 'pedal'} fmt={fmt} compact />}
            {present.has('baro') && <ChannelTile spec={CHANNELS.baro} channelKey={session.keyFor('baro') ?? 'baro'} fmt={fmt} compact />}
            {present.has('iat') && <ChannelTile spec={CHANNELS.iat} channelKey={session.keyFor('iat') ?? 'iat'} fmt={fmt} compact />}
          </div>

          <SectionLabel>PROTECTION</SectionLabel>
          <div className="sd-grid2">
            {present.has('coolant') && (
              <ChannelTile
                spec={CHANNELS.coolant}
                channelKey={session.keyFor('coolant') ?? 'coolant'}
                fmt={fmt}
                compact
                detail={snapshot.extremes.maxCoolant !== undefined ? `max ${fmt.format('°C', 0, snapshot.extremes.maxCoolant).text}` : undefined}
              />
            )}
            {present.has('oilPressure') && (
              <ChannelTile
                spec={CHANNELS.oilPressure}
                channelKey={session.keyFor('oilPressure') ?? 'oilPressure'}
                fmt={fmt}
                compact
                detail={snapshot.extremes.minOilPressure !== undefined ? `min ${fmt.format('kPa', 0, snapshot.extremes.minOilPressure).text}` : undefined}
              />
            )}
            {present.has('oilTemp') && <ChannelTile spec={CHANNELS.oilTemp} channelKey={session.keyFor('oilTemp') ?? 'oilTemp'} fmt={fmt} compact />}
            {present.has('battery') && <ChannelTile spec={CHANNELS.battery} channelKey={session.keyFor('battery') ?? 'battery'} fmt={fmt} compact />}
          </div>

          {present.has('sync') && (
            <ChannelTile
              spec={CHANNELS.sync}
              channelKey={session.keyFor('sync') ?? 'sync'}
              fmt={fmt}
              compact
              detailFor={(value) =>
                value === undefined ? undefined : value > 0.5 ? 'trigger locked' : 'trigger not synced'
              }
            />
          )}

          <SectionLabel aside="THIS SESSION">EXTREMES</SectionLabel>
          <KeyValueGrid
            rows={extremesRows(snapshot.extremes, values, fmt)}
          />
        </aside>

        {/* --------------------------------------------------------------- scope */}
        <section className="sd__centre" aria-label="Live scope">
          <div className="sd-scope-bar">
            <span className="sd-scope-bar__title">LIVE TRACE</span>
            <div className="sd-scope-bar__group" role="group" aria-label="Time window">
              {WINDOW_OPTIONS.map((option) => (
                <button
                  key={option}
                  type="button"
                  className={`sd-btn${windowSec === option ? ' is-on' : ''}`}
                  onClick={() => setWindowSec(option)}
                  title={`Show the last ${option} seconds`}
                >
                  {option}s
                </button>
              ))}
            </div>
            <button
              type="button"
              className={`sd-btn sd-btn--wide${paused ? ' is-warn' : ''}`}
              onClick={() => setPaused((p) => !p)}
              title={paused ? 'Resume the live window' : 'Freeze the window on screen (the ECU keeps streaming)'}
            >
              {paused ? '▶ RESUME' : '⏸ PAUSE'}
            </button>
            <button
              type="button"
              className="sd-btn sd-btn--wide"
              onClick={() => setPickerOpen((open) => !open)}
              aria-expanded={pickerOpen}
              title="Choose which channels are plotted"
            >
              CHANNELS ({lanes.length})
            </button>
            <span className="sd-scope-bar__spacer" />
            <span className="sd-scope-bar__meta">
              {snapshot.rateHz > 0 ? `${snapshot.rateHz.toFixed(1)} Hz` : 'no stream'}
              {snapshot.intervalMs > 0 && ` · sample ${Math.round(snapshot.intervalMs)} ms`}
              {` · store holds ${((300 * snapshot.intervalMs) / 1000).toFixed(0)} s`}
            </span>
          </div>

          {pickerOpen && (
            <div className="sd-picker">
              <div className="sd-picker__col">
                <h4 className="sd-picker__title">Tuning channels</h4>
                <div className="sd-picker__list">
                  {catalogueIds.map((id) => (
                    <label key={id} className="sd-picker__item">
                      <input
                        type="checkbox"
                        checked={laneIds.includes(id)}
                        onChange={() => toggleLane(id)}
                      />
                      <span>{CHANNELS[id].label}</span>
                      <span className="sd-picker__unit">{CHANNELS[id].unit}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="sd-picker__col">
                <h4 className="sd-picker__title">ECU channels ({extraChannels.length})</h4>
                <div className="sd-picker__list">
                  {extraChannels.slice(0, 200).map((meta) => (
                    <label key={meta.name} className="sd-picker__item">
                      <input
                        type="checkbox"
                        checked={laneIds.includes(`ch:${meta.name}`)}
                        onChange={() => toggleLane(`ch:${meta.name}`)}
                      />
                      <span>{meta.label || meta.name}</span>
                      <span className="sd-picker__unit">{meta.units ?? ''}</span>
                    </label>
                  ))}
                  {extraChannels.length === 0 && <p className="sd-picker__empty">No additional channels in this INI.</p>}
                </div>
              </div>
            </div>
          )}

          <div className="sd-scope-host">
            <EngineScope
              lanes={lanes}
              markers={snapshot.markers}
              snapshot={snapshot}
              intervalMs={snapshot.intervalMs}
              windowSec={windowSec}
              paused={paused}
              onPausedChange={setPaused}
              live={isConnected && snapshot.staleMs < 1000}
              isConnected={isConnected}
            />
          </div>
        </section>

        {/* ---------------------------------------------------------- fuel rail */}
        <aside className="sd__rail sd__rail--right" aria-label="Fuel and load">
          <SectionLabel aside={hasTarget ? 'MEASURED vs COMMANDED' : 'MEASURED'}>FUEL RATIO</SectionLabel>
          <HeroTile
            label={preferAfr === 'Lambda' ? 'LAMBDA' : 'AIR/FUEL RATIO'}
            value={snapshot.fuel.measured === undefined ? '—' : fmt.format(fuelUnit, fuelDigits, toDisplay(snapshot.fuel.measured)).text}
            unit={fuelUnit}
            tone={
              snapshot.fuel.error === null
                ? 'dim'
                : Math.abs(snapshot.fuel.error) <= 0.04
                  ? 'ok'
                  : snapshot.fuel.error > 0
                    ? 'warn'
                    : 'info'
            }
            detail={
              <span className="sd-hero__sub">
                {hasTarget && snapshot.fuel.target !== undefined
                  ? `target ${fmt.format(fuelUnit, fuelDigits, toDisplay(snapshot.fuel.target)).text} ${fuelUnit}`
                  : 'no target channel'}
                {snapshot.fuel.measuredDerived && ' · derived from AFR'}
              </span>
            }
            meter={<FuelErrorMeter error={snapshot.fuel.error} fmt={fmt} unit={fuelUnit} target={snapshot.fuel.target} />}
            title="Measured fuel ratio, the commanded target, and the relative error between them"
          />

          <SectionLabel>INJECTION</SectionLabel>
          <div className="sd-grid2">
            {present.has('correction') && (
              <ChannelTile
                spec={CHANNELS.correction}
                channelKey={session.keyFor('correction') ?? 'correction'}
                fmt={fmt}
                compact
                detailFor={(value) =>
                  value === undefined
                    ? undefined
                    : Math.abs(value - 100) < 1
                      ? 'no correction'
                      : value > 100
                        ? 'adding fuel'
                        : 'pulling fuel'
                }
              />
            )}
            {present.has('dutyCycle') && <ChannelTile spec={CHANNELS.dutyCycle} channelKey={session.keyFor('dutyCycle') ?? 'dutyCycle'} fmt={fmt} compact />}
            {present.has('pulseWidth') && <ChannelTile spec={CHANNELS.pulseWidth} channelKey={session.keyFor('pulseWidth') ?? 'pulseWidth'} fmt={fmt} compact />}
            {present.has('fuelPressure') && <ChannelTile spec={CHANNELS.fuelPressure} channelKey={session.keyFor('fuelPressure') ?? 'fuelPressure'} fmt={fmt} compact />}
            {present.has('ve') && <ChannelTile spec={CHANNELS.ve} channelKey={session.keyFor('ve') ?? 've'} fmt={fmt} compact />}
            {present.has('flexPercent') && <ChannelTile spec={CHANNELS.flexPercent} channelKey={session.keyFor('flexPercent') ?? 'flexPercent'} fmt={fmt} compact />}
            {present.has('fuelLevel') && <ChannelTile spec={CHANNELS.fuelLevel} channelKey={session.keyFor('fuelLevel') ?? 'fuelLevel'} fmt={fmt} compact />}
          </div>

          <SectionLabel>COMBUSTION</SectionLabel>
          <div className="sd-grid2">
            {present.has('advance') && <ChannelTile spec={CHANNELS.advance} channelKey={session.keyFor('advance') ?? 'advance'} fmt={fmt} compact />}
            {present.has('dwell') && <ChannelTile spec={CHANNELS.dwell} channelKey={session.keyFor('dwell') ?? 'dwell'} fmt={fmt} compact />}
            {present.has('knock') && <ChannelTile spec={CHANNELS.knock} channelKey={session.keyFor('knock') ?? 'knock'} fmt={fmt} compact />}
            {present.has('knockRetard') && <ChannelTile spec={CHANNELS.knockRetard} channelKey={session.keyFor('knockRetard') ?? 'knockRetard'} fmt={fmt} compact />}
            {present.has('egt') && (
              <ChannelTile
                spec={CHANNELS.egt}
                channelKey={session.keyFor('egt') ?? 'egt'}
                fmt={fmt}
                compact
                detail={snapshot.extremes.maxEgt !== undefined ? `max ${fmt.format('°C', 0, snapshot.extremes.maxEgt).text}` : undefined}
              />
            )}
          </div>

          <SectionLabel>ECU STATE</SectionLabel>
          <div className="sd-chips">
            {snapshot.flags.length === 0 ? (
              <span className="sd-chips__empty">
                {isConnected ? 'No ECU state flags asserted' : 'Not connected'}
              </span>
            ) : (
              snapshot.flags.map((flag) => (
                <StateChip key={flag.label} label={flag.label} tone={flag.tone as TileTone} title={flag.title} />
              ))
            )}
          </div>

          <SectionLabel>SESSION & LINK</SectionLabel>
          <KeyValueGrid
            rows={[
              {
                label: 'Logger',
                value: status.logging.isRecording
                  ? `REC ${formatClock(status.logging.durationMs)}`
                  : isConnected
                    ? 'idle'
                    : 'offline',
                tone: status.logging.isRecording ? 'crit' : 'dim',
                title: status.logging.streamPath ?? undefined,
              },
              {
                label: 'Logged',
                value: status.logging.isRecording
                  ? `${status.logging.channelCount} ch · ${status.logging.entryCount.toLocaleString()} samples`
                  : '—',
                title: status.logging.streamPath ?? undefined,
              },
              {
                label: 'Stream',
                value: snapshot.rateHz > 0 ? `${snapshot.rateHz.toFixed(1)} Hz · ${Math.round(snapshot.intervalMs)} ms` : 'no data',
                tone: snapshot.rateHz > 0 ? undefined : 'dim',
              },
              {
                label: 'Freshness',
                value: Number.isFinite(snapshot.staleMs)
                  ? `${(snapshot.staleMs / 1000).toFixed(1)} s ago`
                  : '—',
                tone: snapshot.staleMs > 1000 ? 'warn' : undefined,
              },
              {
                label: 'History',
                value: `${((300 * snapshot.intervalMs) / 1000).toFixed(0)} s buffered`,
                title: 'The realtime store keeps a fixed-size history buffer per channel',
              },
              {
                label: 'Frames',
                value: snapshot.samples.toLocaleString(),
              },
            ]}
          />
        </aside>
      </div>

      {/* -------------------------------------------------------------- analysis */}
      <div className="sd__strip">
        <EventsPanel
          events={snapshot.events}
          monitors={session.monitorCount}
          breakdown={session.monitorBreakdown}
          fmt={fmt}
          now={Date.now()}
        />        <FuelingPanel
          fuel={snapshot.fuel}
          stats={snapshot.fueling}
          hasTarget={hasTarget}
          live={isConnected && snapshot.staleMs < 1000}
          fmt={fmt}
          unit={fuelUnit}
          digits={fuelDigits}
          toDisplay={toDisplay}
          now={Date.now()}
        />
        <CoverageMap coverage={snapshot.coverage} values={values} fmt={fmt} />
      </div>
    </div>
  );
}
