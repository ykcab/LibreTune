import { useMemo } from 'react';
import {
  getChannelHistoryBuffer,
  getChannelHistoryWindowSec,
  useChannels,
} from '../../stores/realtimeStore';
import { WmiPanel } from './WmiLayout';
import { formatNumber, formatWf } from './wmiFormat';
import type { WmiTargetBand } from './useWmi';

const WIDTH = 600;
const HEIGHT = 84;
const PAD_Y = 4;

function niceCeil(value: number): number {
  if (!(value > 0) || !Number.isFinite(value)) return 1;
  const exponent = Math.floor(Math.log10(value));
  const base = 10 ** exponent;
  const normalized = value / base;
  // Finer steps than 1/2/5 so a 5.6 g/s trace does not get a 10 g/s axis and
  // waste half the plot height.
  const steps = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
  const step = steps.find((candidate) => normalized <= candidate) ?? 10;
  return step * base;
}

function finite(values: number[]): number[] {
  return values.filter((value) => Number.isFinite(value));
}

function tail(values: number[], count: number): number[] {
  return count > 0 ? values.slice(-count) : [];
}

function xAt(index: number, count: number): number {
  if (count <= 1) return WIDTH;
  return (index / (count - 1)) * WIDTH;
}

function yAt(value: number, max: number): number {
  const ratio = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  return PAD_Y + (1 - ratio) * (HEIGHT - PAD_Y * 2);
}

function linePath(values: number[], max: number): string {
  if (values.length < 2) return '';
  return values
    .map((value, index) => {
      const x = xAt(index, values.length).toFixed(1);
      const y = yAt(value, max).toFixed(1);
      return `${index === 0 ? 'M' : 'L'}${x},${y}`;
    })
    .join(' ');
}

function areaPath(values: number[], max: number): string {
  if (values.length < 2) return '';
  const line = linePath(values, max);
  return `${line}L${WIDTH},${HEIGHT}L0,${HEIGHT}Z`;
}

function axisLabel(value: number): string {
  if (value >= 10) return value.toFixed(0);
  if (value >= 1) return value.toFixed(1);
  return value.toFixed(2);
}

function ChartScale({ max }: { max: number }) {
  return (
    <div className="wmi-chart__scale" aria-hidden="true">
      <span>{axisLabel(max)}</span>
      <span>{axisLabel(max / 2)}</span>
      <span>0</span>
    </div>
  );
}

function ChartGrid() {
  return (
    <g aria-hidden="true">
      {[0, 0.25, 0.5, 0.75, 1].map((fraction) => {
        const y = PAD_Y + fraction * (HEIGHT - PAD_Y * 2);
        return (
          <line
            key={fraction}
            x1="0"
            y1={y.toFixed(1)}
            x2={WIDTH}
            y2={y.toFixed(1)}
            className="wmi-chart__grid"
          />
        );
      })}
    </g>
  );
}

export function WmiHistory({
  targetBand,
  isConnected,
  flowMonitored,
}: {
  targetBand: WmiTargetBand;
  isConnected: boolean;
  flowMonitored: boolean;
}) {
  const live = useChannels([
    'wmiModeledFlowGps',
    'wmiEstimatedFlowGps',
    'wmiWfRatio',
  ]);
  const windowSec = getChannelHistoryWindowSec();

  const series = useMemo(() => {
    const modeled = isConnected ? finite(getChannelHistoryBuffer('wmiModeledFlowGps')) : [];
    const measured = isConnected && flowMonitored
      ? finite(getChannelHistoryBuffer('wmiEstimatedFlowGps'))
      : [];
    const wf = isConnected ? finite(getChannelHistoryBuffer('wmiWfRatio')) : [];

    const flowCount = measured.length > 0 && modeled.length > 0
      ? Math.min(modeled.length, measured.length)
      : Math.max(modeled.length, measured.length);
    const flowModeled = tail(modeled, flowCount);
    const flowMeasured = tail(measured, flowCount);
    const flow = flowMeasured.length > 0 ? flowMeasured : flowModeled;
    const currentMeasured = live.wmiEstimatedFlowGps;
    const currentModeled = live.wmiModeledFlowGps;
    const flowMax = niceCeil(
      Math.max(0.5, ...flow, currentMeasured ?? 0, currentModeled ?? 0) * 1.15,
    );

    const wfMax = niceCeil(
      Math.max(0.05, targetBand.max, ...wf, live.wmiWfRatio ?? 0) * 1.12,
    );

    return {
      flowModeled,
      flowMeasured,
      hasMeasured: measured.length > 0,
      flowMax,
      flowPathMeasured: linePath(flowMeasured, flowMax),
      flowAreaMeasured: areaPath(flowMeasured, flowMax),
      flowPathModeled: linePath(flowModeled, flowMax),
      flowAreaModeled: areaPath(flowModeled, flowMax),
      wf,
      wfMax,
      wfPath: linePath(wf, wfMax),
      wfBandTop: yAt(Math.min(targetBand.max, wfMax), wfMax),
      wfBandBottom: yAt(Math.min(targetBand.min, wfMax), wfMax),
      hasFlow: flowModeled.length > 0 || flowMeasured.length > 0,
    };
  }, [
    isConnected,
    flowMonitored,
    live.wmiModeledFlowGps,
    live.wmiEstimatedFlowGps,
    live.wmiWfRatio,
    targetBand.min,
    targetBand.max,
  ]);

  const currentFlow = !isConnected
    ? undefined
    : flowMonitored
      ? live.wmiEstimatedFlowGps ?? live.wmiModeledFlowGps
      : live.wmiModeledFlowGps;

  // The band is a LibreTune project setting, so an out-of-band reading is
  // flagged as guidance, not as a fault.
  const wfValue = isConnected ? live.wmiWfRatio : undefined;
  const wfDirection = wfValue === undefined || !Number.isFinite(wfValue) || wfValue <= 0
    ? null
    : wfValue > targetBand.max
      ? 'above'
      : wfValue < targetBand.min
        ? 'below'
        : null;

  return (
    <WmiPanel
      title="Trend"
      className="wmi-panel--history"
      meta={`${windowSec} s history`}
    >
      <div className="wmi-chart">
        <div className="wmi-chart__head">
          <span className="wmi-chart__label">Flow <em>g/s</em></span>
          <span className="wmi-chart__legend">
            {flowMonitored ? (
              <>
                <span><i className="wmi-key wmi-key--measured" /> measured</span>
                <span><i className="wmi-key wmi-key--modeled" /> modeled</span>
              </>
            ) : (
              <span><i className="wmi-key wmi-key--modeled" /> modeled</span>
            )}
            <strong>{formatNumber(currentFlow, 2)}</strong>
          </span>
        </div>
        <div className="wmi-chart__body">
          <ChartScale max={series.flowMax} />
          <div className="wmi-chart__plot">
            <svg
              viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
              preserveAspectRatio="none"
              role="img"
              aria-label={`Modeled and measured WMI flow over the last ${windowSec} seconds`}
            >
              <ChartGrid />
              {series.hasMeasured && series.flowAreaMeasured ? (
                <path d={series.flowAreaMeasured} className="wmi-chart__area wmi-chart__area--flow" />
              ) : !series.hasMeasured && series.flowAreaModeled ? (
                <path d={series.flowAreaModeled} className="wmi-chart__area wmi-chart__area--flow" />
              ) : null}
              {series.flowPathMeasured ? (
                <path d={series.flowPathMeasured} className="wmi-chart__line wmi-chart__line--measured" />
              ) : null}
              {series.flowPathModeled ? (
                <path
                  d={series.flowPathModeled}
                  className={`wmi-chart__line wmi-chart__line--modeled${series.hasMeasured ? ' is-overlay' : ''}`}
                />
              ) : null}
            </svg>
            {!series.hasFlow ? (
              <span className="wmi-chart__empty">No flow samples yet</span>
            ) : null}
          </div>
        </div>
      </div>

      <div className="wmi-chart wmi-chart--wf">
        <div className="wmi-chart__head">
          <span className="wmi-chart__label">W/F</span>
          <span className="wmi-chart__legend">
            <span>
              target {formatNumber(targetBand.min, 2)}–{formatNumber(targetBand.max, 2)}
            </span>
            <strong>{formatWf(live.wmiWfRatio)}</strong>
          </span>
        </div>
        <div className="wmi-chart__body">
          <ChartScale max={series.wfMax} />
          <div className="wmi-chart__plot">
            <svg
              viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
              preserveAspectRatio="none"
              role="img"
              aria-label={`Water/fuel ratio over the last ${windowSec} seconds, target ${targetBand.min.toFixed(2)} to ${targetBand.max.toFixed(2)}`}
            >
              <ChartGrid />
              {series.wfBandBottom > series.wfBandTop ? (
                <g className="wmi-chart__band" aria-hidden="true">
                  <rect
                    x="0"
                    y={series.wfBandTop.toFixed(1)}
                    width={WIDTH}
                    height={(series.wfBandBottom - series.wfBandTop).toFixed(1)}
                  />
                  <line
                    x1="0"
                    y1={series.wfBandTop.toFixed(1)}
                    x2={WIDTH}
                    y2={series.wfBandTop.toFixed(1)}
                  />
                  <line
                    x1="0"
                    y1={series.wfBandBottom.toFixed(1)}
                    x2={WIDTH}
                    y2={series.wfBandBottom.toFixed(1)}
                  />
                </g>
              ) : null}
              {series.wfPath ? (
                <path d={series.wfPath} className="wmi-chart__line wmi-chart__line--wf" />
              ) : null}
            </svg>
            {series.wf.length === 0 ? (
              <span className="wmi-chart__empty">No W/F samples yet</span>
            ) : null}
          </div>
        </div>
      </div>

      <div className="wmi-chart__axis" aria-hidden="true">
        <span>−{windowSec} s</span>
        <span>now</span>
      </div>
    </WmiPanel>
  );
}
