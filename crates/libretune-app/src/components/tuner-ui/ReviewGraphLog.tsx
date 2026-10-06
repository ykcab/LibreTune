/**
 * ReviewGraphLog — scrub through the most recent recorded session without
 * leaving the Startup dashboard, using the exact same GraphLog multi-lane
 * scope (persisted pane layouts, pan/zoom/cursors) as the live view.
 *
 * The backend logger keeps recording even while the user is in another view,
 * so this simply mirrors the accumulated session log: full refetch on mount
 * and channel-layout change, incremental refresh while recording.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import GraphLog, { type GraphSample } from './GraphLog';
import { useGraphLogStore } from '../../stores/graphLogStore';

/** Hard cap on samples kept in the frontend; the oldest are dropped. */
const MAX_FRONTEND_SAMPLES = 4096;
/** Refresh cadence while a recording is in progress. */
const REFRESH_MS = 1000;

interface LoggingStatus {
  is_recording: boolean;
  entry_count: number;
  duration_ms: number;
  channel_count: number;
  channels: string[];
}

interface LogEntry {
  timestamp_ms: number;
  values: Record<string, number>;
}

export const ReviewGraphLog: React.FC = () => {
  const tabs = useGraphLogStore((s) => s.tabs);
  const [snapshot, setSnapshot] = useState<{ samples: GraphSample[]; channels: string[] }>({
    samples: [],
    channels: [],
  });
  const recordingRef = useRef(false);

  /** Only fetch what the panes actually plot — full-channel fetches are huge. */
  const neededKey = useMemo(() => {
    const set = new Set<string>();
    for (const tab of tabs) {
      for (const pane of tab.panes) {
        if (pane.left.channel) set.add(pane.left.channel);
        if (pane.right.channel) set.add(pane.right.channel);
      }
    }
    return Array.from(set).sort().join('|');
  }, [tabs]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const st = await invoke<LoggingStatus>('get_logging_status');
        recordingRef.current = st.is_recording;
        if (st.entry_count === 0) {
          if (!cancelled) setSnapshot({ samples: [], channels: st.channels ?? [] });
          return;
        }
        const needed = neededKey ? neededKey.split('|') : [];
        const entries = await invoke<LogEntry[]>('get_log_entries', {
          startIndex: Math.max(0, st.entry_count - MAX_FRONTEND_SAMPLES),
          count: MAX_FRONTEND_SAMPLES,
          channels: needed,
        });
        if (cancelled) return;
        setSnapshot({
          samples: entries.map((e) => ({ t: e.timestamp_ms, values: e.values })),
          channels: st.channels ?? [],
        });
      } catch {
        /* logger not running / ECU offline */
      }
    };
    void load();
    const id = window.setInterval(() => {
      if (recordingRef.current) void load();
    }, REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [neededKey]);

  return (
    <GraphLog
      samples={snapshot.samples}
      availableChannels={snapshot.channels}
      isRecording={recordingRef.current}
      emptyHint="No recorded session yet — record a log, then review it here"
    />
  );
};

export default ReviewGraphLog;
