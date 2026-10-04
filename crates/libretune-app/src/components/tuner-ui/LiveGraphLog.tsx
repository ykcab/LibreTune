/**
 * LiveGraphLog — the GraphLog strip charts fed by live ECU telemetry.
 *
 * Reuses GraphLog (and its persisted pane layouts) unchanged: instead of a
 * recording/playback sample array, samples are rebuilt from the realtime
 * history buffers on a slow tick. History buffers carry no timestamps, so
 * sample times are reconstructed backwards from now at the documented
 * CHANNEL_HISTORY_MS_PER_SAMPLE cadence.
 *
 * When disconnected the buffers are empty and GraphLog shows its empty
 * grid with the live hint below.
 */
import { useEffect, useState } from 'react';
import GraphLog, { type GraphSample } from './GraphLog';
import {
  CHANNEL_HISTORY_MS_PER_SAMPLE,
  getChannelHistoryBuffer,
  useRealtimeStore,
} from '../../stores/realtimeStore';

/** Rebuild tick: fast enough to scroll smoothly, slow enough that a
 *  300-row × N-channel array rebuild never pressures the render loop. */
export const LIVE_GRAPH_TICK_MS = 500;

/** Assemble live samples from per-channel histories (oldest→newest each).
 *  Channels with shorter histories (joined mid-stream) contribute only
 *  their own tail, aligned to the latest sample; missing slots are left
 *  out, which the pane painters skip. Pure for testability. */
export function buildLiveSamples(
  histories: Record<string, number[]>,
  nowMs: number,
  stepMs: number = CHANNEL_HISTORY_MS_PER_SAMPLE,
): GraphSample[] {
  const names = Object.keys(histories);
  let depth = 0;
  for (const n of names) depth = Math.max(depth, histories[n].length);
  if (depth === 0) return [];
  const samples: GraphSample[] = new Array(depth);
  for (let i = 0; i < depth; i++) {
    const values: Record<string, number> = {};
    for (const n of names) {
      const h = histories[n];
      const v = h[h.length - depth + i];
      if (v !== undefined) values[n] = v;
    }
    samples[i] = { t: nowMs - (depth - 1 - i) * stepMs, values };
  }
  return samples;
}

export const LiveGraphLog: React.FC = () => {
  const [snapshot, setSnapshot] = useState<{ samples: GraphSample[]; channels: string[] }>({
    samples: [],
    channels: [],
  });

  useEffect(() => {
    const rebuild = () => {
      const keys = Object.keys(useRealtimeStore.getState().channels).sort();
      const histories: Record<string, number[]> = {};
      for (const k of keys) {
        const h = getChannelHistoryBuffer(k);
        if (h.length > 0) histories[k] = h;
      }
      setSnapshot({
        samples: buildLiveSamples(histories, Date.now()),
        channels: Object.keys(histories).sort(),
      });
    };
    rebuild();
    const id = window.setInterval(rebuild, LIVE_GRAPH_TICK_MS);
    return () => window.clearInterval(id);
  }, []);

  return (
    <GraphLog
      samples={snapshot.samples}
      availableChannels={snapshot.channels}
      emptyHint="Connect to the ECU to stream live channel traces"
    />
  );
};

export default LiveGraphLog;
