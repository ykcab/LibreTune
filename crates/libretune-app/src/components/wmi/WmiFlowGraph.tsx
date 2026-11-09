import { useMemo } from 'react';
import {
  getChannelHistoryBuffer,
  useChannel,
  useChannels,
} from '../../stores/realtimeStore';

const GRAPH_SAMPLES = 90;
const GRAPH_WIDTH = 100;
const GRAPH_HEIGHT = 46;

function buildPath(values: number[], height: number): string {
  if (values.length < 2) return '';
  return values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * GRAPH_WIDTH;
      const y = height - value;
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

function normalize(values: number[], scaleMax?: number): number[] {
  const max = scaleMax ?? Math.max(0.01, ...values);
  return values.map((value) => (value / max) * GRAPH_HEIGHT);
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Small live sparkline for the dashboard tiles. */
export function WmiSparkline({
  channel,
  color = 'var(--wmi-accent)',
}: {
  channel: string;
  color?: string;
}) {
  const current = useChannel(channel);
  const path = useMemo(() => {
    const history = getChannelHistoryBuffer(channel).slice(-GRAPH_SAMPLES);
    const values = history.filter((value) => Number.isFinite(value));
    if (values.length < 2) return '';
    return buildPath(normalize(values, current), GRAPH_HEIGHT);
  }, [channel, current]);

  if (!path) return null;

  return (
    <svg
      className="wmi-sparkline"
      viewBox={`0 0 ${GRAPH_WIDTH} ${GRAPH_HEIGHT}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path d={path} fill="none" stroke={color} strokeWidth="1.8" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** Last-60s modeled-flow / W/F trace for the dashboard. */
export function WmiFlowGraph() {
  const live = useChannels([
    'wmiModeledFlowGps',
    'wmiWfRatio',
    'wmiPumpDuty',
    'wmiState',
  ]);

  const series = useMemo(() => {
    const flowHistory = getChannelHistoryBuffer('wmiModeledFlowGps');
    const wfHistory = getChannelHistoryBuffer('wmiWfRatio');
    const count = Math.min(flowHistory.length, wfHistory.length, GRAPH_SAMPLES);
    if (count < 2) return null;

    const flow = flowHistory.slice(-count).filter((value) => Number.isFinite(value));
    const wf = wfHistory.slice(-count).filter((value) => Number.isFinite(value));
    if (flow.length !== wf.length || flow.length < 2) return null;

    const flowMax = Math.max(0.1, ...flow, live.wmiModeledFlowGps ?? 0);
    const wfMax = Math.max(0.01, ...wf, live.wmiWfRatio ?? 0);
    const flowValues = normalize(flow, flowMax);
    const wfValues = wf.map((value) => {
      const ratio = Math.max(0, Math.min(1, value / wfMax));
      return GRAPH_HEIGHT - 8 - ratio * (GRAPH_HEIGHT * 0.58);
    });

    return {
      flow,
      wf,
      flowPath: buildPath(flowValues, GRAPH_HEIGHT),
      flowArea: `${buildPath(flowValues, GRAPH_HEIGHT)}L${GRAPH_WIDTH},${GRAPH_HEIGHT}L0,${GRAPH_HEIGHT}Z`,
      wfPath: wfValues
        .map((y, index) => {
          const x = (index / (wfValues.length - 1)) * GRAPH_WIDTH;
          return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
        })
        .join(' '),
      peak: Math.max(...flow),
      avg: average(flow),
      wfAvg: average(wf),
    };
  }, [live.wmiModeledFlowGps, live.wmiWfRatio, live.wmiPumpDuty, live.wmiState]);

  return (
    <div className="wmi-history" aria-label="WMI last 60 seconds">
      <div className="wmi-history__head">
        <span>LAST 60 SECONDS</span>
        <div className="wmi-history__legend">
          <em><i className="wmi-history__key wmi-history__key--flow" /> Modeled flow</em>
          <em><i className="wmi-history__key wmi-history__key--wf" /> W/F</em>
        </div>
        {series ? (
          <div className="wmi-history__stats">
            <span>Peak {series.peak.toFixed(1)} g/s</span>
            <span>Avg {series.avg.toFixed(1)} g/s</span>
            <span>W/F avg {series.wfAvg.toFixed(2)}</span>
          </div>
        ) : null}
      </div>

      {series ? (
        <svg
          className="wmi-history__chart"
          viewBox={`0 0 ${GRAPH_WIDTH} ${GRAPH_HEIGHT}`}
          preserveAspectRatio="none"
          role="img"
        >
          <defs>
            <linearGradient id="wmi-flow-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.32" />
              <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.02" />
            </linearGradient>
          </defs>
          <line x1="0" y1={GRAPH_HEIGHT * 0.25} x2={GRAPH_WIDTH} y2={GRAPH_HEIGHT * 0.25} stroke="rgba(232,240,243,0.08)" strokeWidth="0.5" />
          <line x1="0" y1={GRAPH_HEIGHT * 0.5} x2={GRAPH_WIDTH} y2={GRAPH_HEIGHT * 0.5} stroke="rgba(232,240,243,0.08)" strokeWidth="0.5" />
          <line x1="0" y1={GRAPH_HEIGHT * 0.75} x2={GRAPH_WIDTH} y2={GRAPH_HEIGHT * 0.75} stroke="rgba(232,240,243,0.08)" strokeWidth="0.5" />
          <path d={series.flowArea} fill="url(#wmi-flow-fill)" />
          <path d={series.flowPath} fill="none" stroke="#3b82f6" strokeWidth="1.7" vectorEffect="non-scaling-stroke" />
          <path d={series.wfPath} fill="none" stroke="#fbbf24" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
        </svg>
      ) : (
        <div className="wmi-flow-graph__empty">Waiting for modeled flow and W/F samples</div>
      )}

      <div className="wmi-flow-graph__axis">
        <span>60 s ago</span>
        <span>now</span>
      </div>
    </div>
  );
}
