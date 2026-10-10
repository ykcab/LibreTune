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
import { memo, useEffect, useState } from 'react';
import GraphLog, { type GraphSample } from './GraphLog';
import {
  CHANNEL_HISTORY_MS_PER_SAMPLE,
  getChannelHistoryBuffer,
  useRealtimeStore,
} from '../../stores/realtimeStore';
import { useGraphLogStore } from '../../stores/graphLogStore';

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

/**
 * Memoized: this component reads the realtime store imperatively (no props),
 * so `React.memo` stops StartupMonitor's ~10 Hz channel re-render from
 * cascading into the full GraphLog tree. It only re-renders on its own
 * 500 ms snapshot rebuild.
 */
export const LiveGraphLog = memo(function LiveGraphLog() {
  const [snapshot, setSnapshot] = useState<{ samples: GraphSample[]; channels: string[] }>({
    samples: [],
    channels: [],
  });

  useEffect(() => {
    const rebuild = () => {
      // Only assemble history for the channels the graph actually plots.
      // Building 300 rows × the full stream (hundreds of channels on rusEFI)
      // every tick was ~20 ms of allocation churn on weak machines. History
      // for every channel is still kept in the store, so a newly-selected
      // channel has its full 300-sample window on the very next rebuild.
      const plotted = new Set<string>();
      for (const tab of useGraphLogStore.getState().tabs) {
        for (const pane of tab.panes) {
          if (pane.left.channel) plotted.add(pane.left.channel);
          if (pane.right.channel) plotted.add(pane.right.channel);
        }
      }
      const histories: Record<string, number[]> = {};
      for (const k of plotted) {
        const h = getChannelHistoryBuffer(k);
        if (h.length > 0) histories[k] = h;
      }
      setSnapshot({
        samples: buildLiveSamples(histories, Date.now()),
        // The picker needs the full live channel set, not just the plotted
        // few, so users can assign any streamed channel to a lane.
        channels: Object.keys(useRealtimeStore.getState().channels).sort(),
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
});

export default LiveGraphLog;
