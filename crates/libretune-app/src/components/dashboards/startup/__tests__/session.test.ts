/**
 * Session accumulator tests.
 *
 * The accumulator is where the dashboard's claims are produced (alerts, fuelling
 * statistics, coverage, link health), so it is tested directly, without React or
 * a DOM: feed frames, assert the snapshot.
 */
import { describe, expect, it } from 'vitest';
import {
  COVERAGE_MAP_BINS,
  COVERAGE_MAP_STEP,
  COVERAGE_RPM_BINS,
  COVERAGE_RPM_STEP,
  TelemetrySession,
} from '../session';

const T0 = 1_700_000_000_000;
const warmed = () => new TelemetrySession(() => 14.7);

/** A running engine frame, overridable per test. */
function frame(overrides: Record<string, number> = {}): Record<string, number> {
  return {
    rpm: 3000,
    map: 120,
    tps: 55,
    coolant: 90,
    battery: 14.1,
    lambda: 0.86,
    targetLambda: 0.85,
    oilPressure: 350,
    egt: 700,
    sync: 1,
    ...overrides,
  };
}

/** Feed `count` frames `stepMs` apart, applying `overrides` to each. */
function run(session: TelemetrySession, count: number, overrides: Record<string, number> = {}, stepMs = 100) {
  for (let i = 0; i < count; i++) session.push(frame(overrides), T0 + i * stepMs);
}

describe('resolution', () => {
  it('resolves catalogued channels from the stream keys', () => {
    const session = warmed();
    session.push(frame(), T0);
    const snapshot = session.snapshot(T0);
    expect(snapshot.present).toContain('rpm');
    expect(snapshot.present).toContain('lambda');
    expect(snapshot.present).toContain('coolant');
    expect(snapshot.present).not.toContain('oilTemp');
    expect(snapshot.values.rpm).toBe(3000);
    expect(snapshot.frameChannels).toBe(Object.keys(frame()).length);
  });

  it('resolves aliases from an INI channel list before any data arrives', () => {
    const session = warmed();
    session.syncChannels(['RPMValue', 'CLT', 'AFRValue', 'targetAFR']);
    const snapshot = session.snapshot(T0);
    expect(snapshot.present).toContain('rpm');
    expect(snapshot.present).toContain('coolant');
    expect(snapshot.present).toContain('afr');
    expect(snapshot.present).toContain('afrTarget');
    // Nothing was measured yet, so no values were invented.
    expect(snapshot.values.rpm).toBeUndefined();
  });
});

describe('link health', () => {
  it('measures rate and staleness from frame timestamps', () => {
    const session = warmed();
    run(session, 20, {}, 100);
    const snapshot = session.snapshot(T0 + 1900);
    expect(snapshot.rateHz).toBeCloseTo(10, 1);
    expect(snapshot.intervalMs).toBeCloseTo(100, 1);
    expect(snapshot.staleMs).toBe(0);
    expect(snapshot.samples).toBe(20);
  });

  it('ignores long pauses so a reconnect does not skew the rate', () => {
    const session = warmed();
    run(session, 10, {}, 100);
    const before = session.snapshot(T0).rateHz;
    // A 30 s hole (tab hidden / reconnect) must not be averaged in.
    session.push(frame(), T0 + 30_000);
    const after = session.snapshot(T0 + 30_000);
    expect(after.rateHz).toBeCloseTo(before, 3);
  });

  it('reports staleness when the stream stops', () => {
    const session = warmed();
    run(session, 5);
    expect(session.snapshot(T0 + 5000).staleMs).toBe(4600);
  });
});

describe('limit alarms', () => {
  it('raises a coolant warning only after the condition persists', () => {
    const session = warmed();
    run(session, 10);
    expect(session.snapshot(T0).events).toHaveLength(0);
    // 106 °C is the first warn band (fan/headroom).
    run(session, 3, { coolant: 106 });
    expect(session.snapshot(T0).events).toHaveLength(0); // 300 ms < 600 ms latch
    run(session, 10, { coolant: 106 });
    const events = session.snapshot(T0 + 1000).events;
    expect(events).toHaveLength(1);
    expect(events[0].channelId).toBe('coolant');
    expect(events[0].severity).toBe('warn');
    expect(events[0].boundary).toBe(105);
    expect(events[0].active).toBe(true);
  });

  it('escalates to critical above the critical boundary', () => {
    const session = warmed();
    run(session, 20, { coolant: 118 });
    const events = session.snapshot(T0).events;
    expect(events.some((e) => e.channelId === 'coolant' && e.severity === 'crit')).toBe(true);
  });

  it('clears an event only after the hysteresis window', () => {
    const session = warmed();
    run(session, 20, { coolant: 118 });
    expect(session.snapshot(T0).active).toHaveLength(1);
    // Back to normal: still active until the clear window (2.5 s) elapses.
    run(session, 10, {}, 100);
    expect(session.snapshot(T0).active).toHaveLength(1);
    run(session, 30, {}, 100);
    expect(session.snapshot(T0).active).toHaveLength(0);
    // ...but the occurrence stays in the history.
    expect(session.snapshot(T0).events).toHaveLength(1);
  });

  it('never alarms on a stopped engine (no false oil-pressure events)', () => {
    const session = warmed();
    run(session, 30, { rpm: 0, map: 30, tps: 0, oilPressure: 0, battery: 11.2, coolant: 20 });
    const snapshot = session.snapshot(T0);
    expect(snapshot.events).toHaveLength(0);
    // The band still colours the tile, it just does not raise an event.
    expect(snapshot.values.battery).toBe(11.2);
  });

  it('raises knock immediately (a discrete event, not a trend)', () => {
    const session = warmed();
    run(session, 10);
    session.push(frame({ knock: 1 }), T0 + 1000);
    session.push(frame({ knock: 1 }), T0 + 1100);
    expect(session.snapshot(T0).events.some((e) => e.channelId === 'knock')).toBe(true);
  });
});

describe('fueling rules and statistics', () => {
  it('raises a lean alarm only in the load cells', () => {
    const session = warmed();
    // 20 % lean, but at idle: no load-cell analysis, no alarm.
    run(session, 20, { rpm: 900, map: 35, tps: 2, lambda: 1.02 });
    expect(session.snapshot(T0).events).toHaveLength(0);
    expect(session.snapshot(T0).fueling.samples).toBe(0);
    // Same error under load: alarm.
    run(session, 20, { lambda: 1.02 });
    const events = session.snapshot(T0).events;
    expect(events.some((e) => e.kind === 'fueling' && (e.value ?? 0) > 0)).toBe(true);
  });

  it('accumulates mean, spread and worst excursions over load samples', () => {
    const session = warmed();
    run(session, 10, { lambda: 0.85 }); // on target
    run(session, 10, { lambda: 0.80 }); // rich
    run(session, 10, { lambda: 0.95 }); // lean
    const stats = session.snapshot(T0).fueling;
    expect(stats.samples).toBe(30);
    expect(stats.meanError).not.toBeNull();
    expect(stats.worstLean?.error).toBeCloseTo((0.95 - 0.85) / 0.85, 4);
    expect(stats.worstRich?.error).toBeCloseTo((0.8 - 0.85) / 0.85, 4);
    expect(stats.meanAbsError).toBeGreaterThan(0);
  });

  it('does not compare against an implausible target', () => {
    const session = warmed();
    // A target of 0.2 λ is nonsense (or a mis-scaled channel): ignore it.
    run(session, 20, { targetLambda: 0.2, lambda: 0.95 });
    expect(session.snapshot(T0).fueling.samples).toBe(0);
    expect(session.snapshot(T0).fuel.error).toBeNull();
  });

  it('keeps the current ratio unit-neutral (λ space)', () => {
    const session = warmed();
    run(session, 3, { lambda: 0.9, targetLambda: 0.85 });
    const fuel = session.snapshot(T0).fuel;
    expect(fuel.measured).toBeCloseTo(0.9, 6);
    expect(fuel.target).toBeCloseTo(0.85, 6);
    expect(fuel.error).toBeCloseTo((0.9 - 0.85) / 0.85, 6);
  });
});

describe('sensor dropouts and sync', () => {
  it('raises a dropout for a channel that collapses to raw zero while turning', () => {
    const session = warmed();
    run(session, 20);
    expect(session.snapshot(T0).events).toHaveLength(0);
    run(session, 25, { oilPressure: 0 });
    const events = session.snapshot(T0).events;
    expect(events.some((e) => e.kind === 'dropout' && e.channelId === 'oilPressure')).toBe(true);
  });

  it('raises a critical sync loss while the engine turns', () => {
    const session = warmed();
    run(session, 20, { sync: 0 });
    const events = session.snapshot(T0).events;
    expect(events.some((e) => e.kind === 'sync' && e.severity === 'crit')).toBe(true);
  });

  it('ignores a sync flag while the engine is stopped', () => {
    const session = warmed();
    run(session, 20, { rpm: 0, sync: 0 });
    expect(session.snapshot(T0).events).toHaveLength(0);
  });
});

describe('overboost', () => {
  it('warns when boost exceeds the ECU’s own target', () => {
    const session = warmed();
    run(session, 20, { boost: 220, boostTarget: 180 });
    expect(session.snapshot(T0).events.some((e) => e.kind === 'boost')).toBe(true);
  });

  it('stays quiet without a commanded target to compare against', () => {
    const session = warmed();
    run(session, 20, { boost: 260 });
    expect(session.snapshot(T0).events.some((e) => e.kind === 'boost')).toBe(false);
  });
});

describe('operating envelope coverage', () => {
  it('bins samples by rpm × MAP and tracks the current cell', () => {
    const session = warmed();
    session.push(frame({ rpm: 3200, map: 120 }), T0);
    const rb = Math.floor(3200 / COVERAGE_RPM_STEP);
    const mb = Math.floor(120 / COVERAGE_MAP_STEP);
    const expected = mb * COVERAGE_RPM_BINS + rb;
    const coverage = session.snapshot(T0).coverage;
    expect(coverage.visited).toBe(1);
    expect(coverage.current).toBe(expected);
    expect(coverage.counts[expected]).toBe(1);
    expect(coverage.total).toBe(COVERAGE_RPM_BINS * COVERAGE_MAP_BINS);
  });

  it('counts a cell once however long it is occupied, and tracks dwell', () => {
    const session = warmed();
    for (let i = 0; i < 5; i++) session.push(frame({ rpm: 3200, map: 120 }), T0 + i * 100);
    const coverage = session.snapshot(T0).coverage;
    expect(coverage.visited).toBe(1);
    expect(coverage.counts[coverage.current]).toBe(5);
    expect(coverage.peak).toBe(5);
    expect(coverage.samples).toBe(5);
  });

  it('ignores samples outside the map (over 8000 rpm)', () => {
    const session = warmed();
    session.push(frame({ rpm: 9200, map: 120 }), T0);
    const coverage = session.snapshot(T0).coverage;
    expect(coverage.visited).toBe(0);
    expect(coverage.current).toBe(-1);
  });
});

describe('session extremes and reset', () => {
  it('tracks maxima and the minimum oil pressure while running', () => {
    const session = warmed();
    run(session, 5, { rpm: 2000, oilPressure: 400, egt: 600 });
    run(session, 5, { rpm: 6000, oilPressure: 250, egt: 880 });
    const extremes = session.snapshot(T0).extremes;
    expect(extremes.maxRpm).toBe(6000);
    expect(extremes.minOilPressure).toBe(250);
    expect(extremes.maxEgt).toBe(880);
  });

  it('resets every session-scoped number', () => {
    const session = warmed();
    run(session, 20, { coolant: 118 });
    session.reset();
    const snapshot = session.snapshot(T0);
    expect(snapshot.events).toHaveLength(0);
    expect(snapshot.samples).toBe(0);
    expect(snapshot.coverage.visited).toBe(0);
    expect(snapshot.fueling.samples).toBe(0);
    expect(snapshot.extremes.maxRpm).toBeUndefined();
    expect(snapshot.values.rpm).toBeUndefined();
  });
});

describe('monitoring breakdown', () => {
  it('counts the rules it is watching per kind', () => {
    const session = warmed();
    const breakdown = session.monitorBreakdown;
    expect(breakdown.limit).toBeGreaterThan(10);
    expect(breakdown.dropout).toBeGreaterThan(5);
    expect(breakdown.fueling).toBe(2);
    expect(breakdown.sync).toBe(1);
    expect(breakdown.boost).toBe(1);
    expect(session.monitorCount).toBe(
      breakdown.limit + breakdown.dropout + breakdown.fueling + breakdown.sync + breakdown.boost,
    );
  });
});
