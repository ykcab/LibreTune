/**
 * Session accumulator tests.
 *
 * The accumulator is where the dashboard's claims are produced (alerts, fuelling
 * statistics, coverage, link health), so it is tested directly, without React or
 * a DOM: feed frames, assert the snapshot.
 *
 * Time is threaded explicitly (`run` returns the timestamp it finished on) so
 * multi-phase scenarios feed monotonic timestamps — a test that rewinds the
 * clock proves nothing about latch and hysteresis windows.
 */
import { describe, expect, it } from 'vitest';
import { CoverageGrid, TelemetrySession } from '../session';
import { CHANNELS } from '../channels';

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

/** Feed `count` frames `stepMs` apart starting at `from`; returns the last stamp. */
function run(
  session: TelemetrySession,
  count: number,
  overrides: Record<string, number> = {},
  from = T0,
  stepMs = 100,
): number {
  for (let i = 0; i < count; i++) session.push(frame(overrides), from + i * stepMs);
  return from + (count - 1) * stepMs;
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
    const last = run(session, 20);
    const snapshot = session.snapshot(last);
    expect(snapshot.rateHz).toBeCloseTo(10, 1);
    expect(snapshot.intervalMs).toBeCloseTo(100, 1);
    expect(snapshot.staleMs).toBe(0);
    expect(snapshot.samples).toBe(20);
  });

  it('ignores long pauses so a reconnect does not skew the rate', () => {
    const session = warmed();
    const last = run(session, 10);
    const before = session.snapshot(last).rateHz;
    // A 30 s hole (tab hidden / reconnect) must not be averaged in.
    session.push(frame(), last + 30_000);
    expect(session.snapshot(last + 30_000).rateHz).toBeCloseTo(before, 3);
  });

  it('reports staleness when the stream stops', () => {
    const session = warmed();
    const last = run(session, 5);
    expect(session.snapshot(last + 5000).staleMs).toBe(5000);
  });
});

describe('limit alarms', () => {
  it('raises a coolant warning only after the condition persists', () => {
    const session = warmed();
    let t = run(session, 10);
    t = run(session, 3, { coolant: 106 }, t + 100);
    expect(session.snapshot(t).events).toHaveLength(0); // 200 ms < 600 ms latch
    t = run(session, 10, { coolant: 106 }, t + 100);
    const events = session.snapshot(t).events;
    expect(events).toHaveLength(1);
    expect(events[0].channelId).toBe('coolant');
    expect(events[0].severity).toBe('warn');
    expect(events[0].boundary).toBe(105);
    expect(events[0].active).toBe(true);
  });

  it('escalates to critical above the critical boundary', () => {
    const session = warmed();
    const t = run(session, 20, { coolant: 118 });
    const events = session.snapshot(t).events;
    expect(events.some((e) => e.channelId === 'coolant' && e.severity === 'crit')).toBe(true);
  });

  it('clears an event only after the hysteresis window', () => {
    const session = warmed();
    let t = run(session, 20, { coolant: 118 });
    expect(session.snapshot(t).active).toHaveLength(1);
    // Back to normal: still active until the clear window (2.5 s) elapses.
    t = run(session, 10, {}, t + 100);
    expect(session.snapshot(t).active).toHaveLength(1);
    t = run(session, 30, {}, t + 100);
    expect(session.snapshot(t).active).toHaveLength(0);
    // ...but the occurrence stays in the history.
    expect(session.snapshot(t).events).toHaveLength(1);
  });

  it('never alarms on a stopped engine (no false oil-pressure events)', () => {
    const session = warmed();
    const t = run(session, 30, { rpm: 0, map: 30, tps: 0, oilPressure: 0, battery: 11.2, coolant: 20 });
    const snapshot = session.snapshot(t);
    expect(snapshot.events).toHaveLength(0);
    // The band still colours the tile, it just does not raise an event.
    expect(snapshot.values.battery).toBe(11.2);
  });

  it('treats a cold engine at 0 °C as a reading, not as a dead sensor', () => {
    const session = warmed();
    const t = run(session, 30, { coolant: 0, iat: 0, egt: 0 });
    const snapshot = session.snapshot(t);
    expect(snapshot.events).toHaveLength(0);
    expect(snapshot.values.coolant).toBe(0);
  });

  it('raises knock immediately (a discrete event, not a trend)', () => {
    const session = warmed();
    let t = run(session, 10);
    session.push(frame({ knock: 1 }), t + 100);
    session.push(frame({ knock: 1 }), t + 200);
    expect(session.snapshot(t + 200).events.some((e) => e.channelId === 'knock')).toBe(true);
  });
});

describe('fueling rules and statistics', () => {
  it('raises a lean alarm only in the load cells', () => {
    const session = warmed();
    // 20 % lean, but at idle: no load-cell analysis, no alarm.
    let t = run(session, 20, { rpm: 900, map: 35, tps: 2, lambda: 1.02 });
    expect(session.snapshot(t).events).toHaveLength(0);
    expect(session.snapshot(t).fueling.samples).toBe(0);
    // Same error under load: alarm.
    t = run(session, 20, { lambda: 1.02 }, t + 100);
    const events = session.snapshot(t).events;
    expect(events.some((e) => e.kind === 'fueling' && (e.value ?? 0) > 0)).toBe(true);
  });

  it('accumulates mean, spread and worst excursions over load samples', () => {
    const session = warmed();
    let t = run(session, 10, { lambda: 0.85 }); // on target
    t = run(session, 10, { lambda: 0.80 }, t + 100); // rich
    t = run(session, 10, { lambda: 0.95 }, t + 100); // lean
    const stats = session.snapshot(t).fueling;
    expect(stats.samples).toBe(30);
    expect(stats.meanError).not.toBeNull();
    expect(stats.worstLean?.error).toBeCloseTo((0.95 - 0.85) / 0.85, 4);
    expect(stats.worstRich?.error).toBeCloseTo((0.8 - 0.85) / 0.85, 4);
    expect(stats.meanAbsError).toBeGreaterThan(0);
  });

  it('does not compare against an implausible target', () => {
    const session = warmed();
    const t = run(session, 20, { targetLambda: 0.2, lambda: 0.95 });
    expect(session.snapshot(t).fueling.samples).toBe(0);
    expect(session.snapshot(t).fuel.error).toBeNull();
  });

  it('keeps the current ratio unit-neutral (λ space)', () => {
    const session = warmed();
    const t = run(session, 3, { lambda: 0.9, targetLambda: 0.85 });
    const fuel = session.snapshot(t).fuel;
    expect(fuel.measured).toBeCloseTo(0.9, 6);
    expect(fuel.target).toBeCloseTo(0.85, 6);
    expect(fuel.error).toBeCloseTo((0.9 - 0.85) / 0.85, 6);
  });
});

describe('sensor dropouts and sync', () => {
  it('raises a dropout for a channel that collapses to raw zero while turning', () => {
    const session = warmed();
    let t = run(session, 20);
    expect(session.snapshot(t).events).toHaveLength(0);
    t = run(session, 25, { oilPressure: 0 }, t + 100);
    const events = session.snapshot(t).events;
    expect(events.some((e) => e.kind === 'dropout' && e.channelId === 'oilPressure')).toBe(true);
  });

  it('raises a critical sync loss while the engine turns', () => {
    const session = warmed();
    const t = run(session, 20, { sync: 0 });
    const events = session.snapshot(t).events;
    expect(events.some((e) => e.kind === 'sync' && e.severity === 'crit')).toBe(true);
  });

  it('ignores a sync flag while the engine is stopped', () => {
    const session = warmed();
    const t = run(session, 20, { rpm: 0, sync: 0 });
    expect(session.snapshot(t).events).toHaveLength(0);
  });
});

describe('overboost', () => {
  it('warns when boost exceeds the ECU’s own target', () => {
    const session = warmed();
    const t = run(session, 20, { boost: 220, boostTarget: 180 });
    const event = session.snapshot(t).events.find((e) => e.kind === 'boost');
    expect(event).toBeDefined();
    // The event carries its channel so the UI can convert and label the units.
    expect(event?.channelId).toBe('boost');
  });

  it('stays quiet without a commanded target to compare against', () => {
    const session = warmed();
    const t = run(session, 20, { boost: 260 });
    expect(session.snapshot(t).events.some((e) => e.kind === 'boost')).toBe(false);
  });
});

describe('operating envelope coverage', () => {
  it('bins samples by rpm × MAP and tracks the current cell', () => {
    const session = warmed();
    session.push(frame({ rpm: 3200, map: 120 }), T0);
    const coverage = session.snapshot(T0).coverage;
    const rb = Math.floor(3200 / coverage.rpmStep);
    const mb = Math.floor(120 / coverage.mapStep);
    const expected = mb * coverage.rpmBins + rb;
    expect(coverage.visited).toBe(1);
    expect(coverage.current).toBe(expected);
    expect(coverage.counts[expected]).toBe(1);
    expect(coverage.total).toBe(coverage.rpmBins * coverage.mapBins);
  });

  it('sizes the rpm axis from the ECU’s rev limit', () => {
    const session = warmed();
    // A 7200 rpm limit must not be graded against an 8000 rpm grid.
    session.push(frame({ rpm: 3000, map: 100, rpmHardLimit: 7200 }), T0);
    const coverage = session.snapshot(T0).coverage;
    expect(coverage.rpmBins).toBeLessThanOrEqual(16);
    expect(coverage.rpmBins * coverage.rpmStep).toBeGreaterThanOrEqual(7200);
  });

  it('grows the pressure axis when boost exceeds the starting range', () => {
    const session = warmed();
    session.push(frame({ rpm: 3000, map: 100 }), T0);
    const narrow = session.snapshot(T0).coverage;
    expect(narrow.mapBins * narrow.mapStep).toBeLessThanOrEqual(140);
    session.push(frame({ rpm: 3000, map: 240 }), T0 + 100);
    const wide = session.snapshot(T0 + 100).coverage;
    expect(wide.mapBins).toBeGreaterThan(narrow.mapBins);
    expect(wide.mapBins * wide.mapStep).toBeGreaterThanOrEqual(240);
    // Growth keeps what was already recorded.
    expect(wide.visited).toBe(2);
    expect(wide.samples).toBe(2);
  });

  it('never shrinks the grid inside a session', () => {
    const session = warmed();
    session.push(frame({ rpm: 3000, map: 260 }), T0);
    const after = session.snapshot(T0).coverage.mapBins;
    session.push(frame({ rpm: 3000, map: 60 }), T0 + 100);
    expect(session.snapshot(T0 + 100).coverage.mapBins).toBe(after);
  });

  it('counts a cell once however long it is occupied, and tracks dwell', () => {
    const session = warmed();
    const t = run(session, 5, { rpm: 3200, map: 120 });
    const coverage = session.snapshot(t).coverage;
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

  it('stops claiming a current operating cell once the engine stops', () => {
    const session = warmed();
    let t = run(session, 5, { rpm: 3000, map: 120 });
    expect(session.snapshot(t).coverage.current).toBeGreaterThanOrEqual(0);
    t = run(session, 2, { rpm: 0, map: 0 }, t + 100);
    expect(session.snapshot(t).coverage.current).toBe(-1);
  });

  it('accumulates a mean fuelling error per operating cell', () => {
    const session = warmed();
    // ~10 % lean at 3000 rpm / 120 kPa.
    const t = run(session, 10, { lambda: 0.935, targetLambda: 0.85 });
    const coverage = session.snapshot(t).coverage;
    const rb = Math.floor(3000 / coverage.rpmStep);
    const mb = Math.floor(120 / coverage.mapStep);
    const index = mb * coverage.rpmBins + rb;
    expect(coverage.errorSamples[index]).toBe(10);
    expect(coverage.errorMean[index]).toBeCloseTo(0.1, 3);
    expect(coverage.worstLeanCell?.error).toBeCloseTo(0.1, 3);
    expect(coverage.worstLeanCell?.rpm).toBe(3000);
    expect(coverage.worstLeanCell?.map).toBe(120);
    // Cells driven off-boost carry no judgement at all.
    expect(coverage.errorMean[0]).toBeNull();
  });

  it('reports how far the engine actually reached, for honest axis labels', () => {
    const session = warmed();
    const t = run(session, 5, { rpm: 5800, map: 200 });
    const coverage = session.snapshot(t).coverage;
    expect(coverage.rpmMaxBin).toBe(Math.floor(5800 / coverage.rpmStep));
    expect(coverage.mapMaxBin).toBe(Math.floor(200 / coverage.mapStep));
  });
});

describe('CoverageGrid', () => {
  it('appends whole rows without disturbing existing counts', () => {
    const grid = new CoverageGrid();
    const rowFor = (map: number) => Math.floor(map / grid.mapStep);
    grid.add(3000, 100, 0.05);
    grid.add(3000, 100, 0.05);
    const rb = Math.floor(3000 / grid.rpmStep);
    const before = grid.counts[(rowFor(100)) * grid.rpmBins + rb];
    expect(before).toBe(2);
    grid.add(3000, 240, null);
    expect(grid.counts[(rowFor(100)) * grid.rpmBins + rb]).toBe(2);
    expect(grid.counts[(rowFor(240)) * grid.rpmBins + rb]).toBe(1);
    expect(grid.samples).toBe(3);
    expect(grid.visited).toBe(2);
  });

  it('ignores samples outside the grid instead of throwing', () => {
    const grid = new CoverageGrid();
    grid.add(20000, 100, null);
    expect(grid.current).toBe(-1);
    expect(grid.visited).toBe(0);
  });
});

describe('markers', () => {
  it('publishes markers newest-first (the live edge is the part that matters)', () => {
    const session = warmed();
    let t = run(session, 10);
    t = run(session, 20, { coolant: 118 }, t + 100); // raises a coolant event
    const coolantAt = session.snapshot(t).events[0].at;
    t = run(session, 40, {}, t + 100); // clears it (hysteresis)
    t = run(session, 4, { knock: 1 }, t + 100); // raises a later knock event
    const markers = session.snapshot(t).markers;
    expect(markers.length).toBe(2);
    expect(markers[0].at).toBeGreaterThan(markers[1].at);
    expect(markers[1].at).toBe(coolantAt);
  });
});

describe('session extremes and reset', () => {
  it('tracks maxima and the minimum oil pressure while running', () => {
    const session = warmed();
    let t = run(session, 5, { rpm: 2000, oilPressure: 400, egt: 600 });
    t = run(session, 5, { rpm: 6000, oilPressure: 250, egt: 880 }, t + 100);
    const extremes = session.snapshot(t).extremes;
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
    // Two fuelling-error rules plus two bank-split rules.
    expect(breakdown.fueling).toBe(4);
    expect(breakdown.sync).toBe(1);
    expect(breakdown.boost).toBe(1);
    expect(session.monitorCount).toBe(
      breakdown.limit + breakdown.dropout + breakdown.fueling + breakdown.sync + breakdown.boost,
    );
  });

  it('reports only the rules that can actually fire for this definition', () => {
    const session = warmed();
    // A definition publishing engine speed, load and coolant: most catalogue rules
    // can never run, so the panel must not claim to be watching them.
    session.push({ rpm: 3000, map: 120, coolant: 90 }, T0);
    const armed = session.armedBreakdown;
    expect(armed.gated).toBe(false);
    expect(armed.byKind.limit).toBeGreaterThan(0); // coolant has warn/crit bands
    expect(armed.byKind.dropout).toBeGreaterThan(0); // MAP is a zero-is-gap channel
    expect(armed.total).toBeLessThan(session.monitorCount);
    // No commanded fuel ratio, no oil/EGT/battery channels: those rules are not
    // armed and must not be advertised.
    expect(armed.byKind.fueling).toBe(0);
    expect(armed.byKind.boost).toBe(0);
  });

  it('reports nothing armed when the definition has no engine-speed channel', () => {
    const session = warmed();
    session.push({ map: 120, coolant: 90 }, T0);
    const armed = session.armedBreakdown;
    expect(armed.gated).toBe(true);
    expect(armed.total).toBe(0);
  });
});

describe('oil pressure: minimum scales with engine speed', () => {
  it('does not flag a healthy hot idle', () => {
    const session = warmed();
    // 900 rpm at 120 kPa is perfectly normal; a fixed 110 kPa floor would alarm.
    const t = run(session, 40, { rpm: 900, map: 35, tps: 2, oilPressure: 120 }, T0, 100);
    expect(session.snapshot(t).events).toHaveLength(0);
  });

  it('flags pressure that is low for the engine speed', () => {
    const session = warmed();
    // 3000 rpm needs ~207 kPa; 150 kPa is 27 % below that.
    const t = run(session, 40, { rpm: 3000, map: 150, oilPressure: 150 });
    const events = session.snapshot(t).events;
    expect(events.some((e) => e.channelId === 'oilPressure')).toBe(true);
    expect(events[0].boundary).toBeCloseTo(207, 0);
    expect(events[0].note).toContain('3000 RPM');
  });

  it('calls out the critical case in the note', () => {
    const session = warmed();
    // 6000 rpm needs ~414 kPa; 100 kPa is far below 60 % of that.
    const t = run(session, 40, { rpm: 6000, map: 180, oilPressure: 100 });
    const event = session.snapshot(t).events.find((e) => e.channelId === 'oilPressure');
    expect(event?.note).toContain('BELOW');
  });

  it('stays quiet below the arming speed and while stopped', () => {
    const session = warmed();
    let t = run(session, 40, { rpm: 900, map: 35, oilPressure: 55 });
    expect(session.snapshot(t).events).toHaveLength(0);
    t = run(session, 40, { rpm: 0, map: 30, oilPressure: 0 }, t + 100);
    expect(session.snapshot(t).events).toHaveLength(0);
  });

  it('lets a user floor replace the scaled rule', () => {
    const session = warmed();
    session.setLimitOverrides({ oilPressure: { warn: 90, crit: 50 } });
    // 3000 rpm at 150 kPa: below the user's 90 kPa? No — and the scaled rule is
    // gone, so nothing fires.
    let t = run(session, 40, { rpm: 3000, map: 150, oilPressure: 150 });
    expect(session.snapshot(t).events).toHaveLength(0);
    // ...but 80 kPa is below their floor.
    t = run(session, 20, { oilPressure: 80 }, t + 100);
    const event = session.snapshot(t).events.find((e) => e.channelId === 'oilPressure');
    expect(event?.boundary).toBe(90);
  });
});

describe('cylinder bank split', () => {
  it('is silent with a single wideband', () => {
    const session = warmed();
    const t = run(session, 40, { lambda: 0.86 });
    expect(session.snapshot(t).events.some((e) => e.id?.toString().startsWith('bank'))).toBe(false);
    expect(session.armedBreakdown.byKind.fueling).toBe(2);
  });

  it('flags a growing split under load and names the leaner bank', () => {
    const session = warmed();
    const t = run(session, 40, { lambda: 0.86, lambdaBank2: 0.96 });
    const event = session.snapshot(t).events.find((e) => e.rule.startsWith('bank:'));
    expect(event).toBeDefined();
    expect(event?.note).toContain('BANK 2 LEANER');
  });

  it('escalates a large split to critical', () => {
    const session = warmed();
    const t = run(session, 40, { lambda: 0.86, lambdaBank2: 1.05 });
    const event = session.snapshot(t).events.find((e) => e.rule === 'bank:split:crit');
    expect(event?.severity).toBe('crit');
  });

  it('ignores a split off-load', () => {
    const session = warmed();
    const t = run(session, 40, { rpm: 900, map: 35, tps: 2, lambda: 0.99, lambdaBank2: 1.12 });
    expect(session.snapshot(t).events.some((e) => e.rule.startsWith('bank:'))).toBe(false);
  });
});

describe('user limit overrides', () => {
  it('moves the boundary an alarm compares against', () => {
    const session = warmed();
    // Default coolant warn fires above 105 °C.
    let t = run(session, 20, { coolant: 103 });
    expect(session.snapshot(t).events).toHaveLength(0);
    // A track car with a 110 °C thermostat sets its own floor.
    session.setLimitOverrides({ coolant: { warn: 110, crit: 120 } });
    t = run(session, 20, { coolant: 106 }, t + 100);
    expect(session.snapshot(t).events).toHaveLength(0);
    t = run(session, 20, { coolant: 112 }, t + 100);
    const event = session.snapshot(t).events.find((e) => e.channelId === 'coolant');
    expect(event?.boundary).toBe(110);
    expect(event?.severity).toBe('warn');
  });

  it('applies the override to the effective catalogue the UI renders', () => {
    const session = warmed();
    session.setLimitOverrides({ egt: { warn: 700, crit: 800 } });
    expect(session.effectiveSpecs.egt.bands?.[0].max).toBe(700);
    expect(session.effectiveSpecs.egt.bands?.[1].max).toBe(800);
    // The shipped catalogue is untouched.
    expect(CHANNELS.egt.bands?.[0].max).toBe(850);
  });

  it('uses a user boost ceiling when the ECU publishes no target', () => {
    const session = warmed();
    let t = run(session, 20, { boost: 230 });
    expect(session.snapshot(t).events.some((e) => e.kind === 'boost')).toBe(false);
    session.setLimitOverrides({ boost: { warn: 200, crit: 250 } });
    t = run(session, 20, { boost: 230 }, t + 100);
    const event = session.snapshot(t).events.find((e) => e.kind === 'boost');
    expect(event?.boundary).toBe(200);
    expect(event?.note).toContain('YOUR BOOST CEILING');
  });

  it('still prefers the ECU’s own target over a ceiling', () => {
    const session = warmed();
    session.setLimitOverrides({ boost: { warn: 300, crit: 320 } });
    const t = run(session, 20, { boost: 220, boostTarget: 180 });
    const event = session.snapshot(t).events.find((e) => e.kind === 'boost');
    expect(event?.boundary).toBe(180);
    expect(event?.note).toContain('BOOST TARGET');
  });
});
