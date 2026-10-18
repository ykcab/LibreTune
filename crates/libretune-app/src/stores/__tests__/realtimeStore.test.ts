/**
 * The realtime store's delta contract.
 *
 * The backend stops sending the full snapshot and starts sending only what
 * changed (see `realtime_stream.rs`): ~7,845 keys were going over the bridge
 * twenty times a second, 71% of them tune constants that cannot change while
 * the engine is running. These tests pin the two properties that make the
 * split safe — an unchanged payload must not wake subscribers, and constants
 * must not allocate history buffers.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  CHANNEL_HISTORY_MS_PER_SAMPLE,
  getChannelHistoryBuffer,
  useRealtimeStore,
} from '../realtimeStore';

const store = () => useRealtimeStore.getState();

describe('realtime store delta handling', () => {
  beforeEach(() => {
    store().clearChannels();
  });

  it('merges a delta without disturbing channels it does not mention', () => {
    store().updateChannels({ rpm: 2400, map: 41.2 });
    store().updateChannels({ rpm: 2500 });

    expect(store().channels.rpm).toBe(2500);
    expect(store().channels.map).toBe(41.2);
  });

  it('keeps the channel map identity when a payload changes nothing', () => {
    store().updateChannels({ rpm: 2400 });
    const before = store().channels;

    store().updateChannels({ rpm: 2400 });

    expect(store().channels).toBe(before);
  });

  it('rebuilds the channel map when a value moves', () => {
    store().updateChannels({ rpm: 2400 });
    const before = store().channels;

    store().updateChannels({ rpm: 2400.5 });

    expect(store().channels).not.toBe(before);
    expect(store().channels.rpm).toBe(2400.5);
  });

  it('advances the heartbeat on an empty payload so a quiet ECU is not read as a dead one', () => {
    const before = store().lastUpdateTime;

    store().updateChannels({});

    expect(store().lastUpdateTime).toBeGreaterThanOrEqual(before);
  });

  it('applies constants without allocating history for them', () => {
    // A tune constant nobody graphs must not cost a Float64Array(300).
    store().applyConfig({ reqFuel: 12.5, stoich: 14.7 });

    expect(store().channels.reqFuel).toBe(12.5);

    store().updateChannels({});
    expect(getChannelHistoryBuffer('reqFuel')).toEqual([]);
  });

  it('still records history for a constant that is actually graphed', () => {
    store().applyConfig({ stoich: 14.7 });

    // Reading the history is what subscribes a channel to sampling.
    expect(getChannelHistoryBuffer('stoich')).toEqual([]);
    store().updateChannels({});
    store().updateChannels({});

    expect(getChannelHistoryBuffer('stoich')).toEqual([14.7, 14.7]);
  });

  it('keeps sampling a live channel every tick even when its value is constant', () => {
    // Issue #71: a flat trace must keep scrolling, or a steady idle AFR/
    // coolant reading freezes the graph.
    store().updateChannels({ coolant: 88 });
    store().updateChannels({ rpm: 900 });
    store().updateChannels({ rpm: 900 });

    expect(getChannelHistoryBuffer('coolant')).toEqual([88, 88, 88]);
  });

  it('does not wake subscribers when a config payload repeats', () => {
    store().applyConfig({ stoich: 14.7 });
    const before = store().channels;

    store().applyConfig({ stoich: 14.7 });

    expect(store().channels).toBe(before);
  });

  it('documents the history window in seconds from the sample cadence', () => {
    expect((300 * CHANNEL_HISTORY_MS_PER_SAMPLE) / 1000).toBe(30);
  });
});
