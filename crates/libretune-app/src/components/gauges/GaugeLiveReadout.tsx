import { useChannelValue } from '../../stores/realtimeStore';
import type { SimpleGaugeInfo } from '../curves/CurveEditor';
import type { TsGaugeConfig } from '../dashboards/dashTypes';

function formatGaugeValue(value: number | undefined, digits: number): string {
  if (value === undefined || Number.isNaN(value)) return '—';
  if (digits <= 0) return String(Math.round(value));
  return value.toFixed(digits);
}

export interface GaugeLiveReadoutProps {
  gaugeInfo?: SimpleGaugeInfo | null;
  gaugeConfig?: TsGaugeConfig | null;
  /** Override live value (e.g. curve X-axis output channel). */
  value?: number;
  className?: string;
  variant?: 'row' | 'card';
}

export function GaugeLiveReadout({
  gaugeInfo,
  gaugeConfig,
  value,
  className,
  variant = 'row',
}: GaugeLiveReadoutProps) {
  const channel = gaugeConfig?.output_channel ?? gaugeInfo?.channel ?? '';
  const label = gaugeConfig?.title ?? gaugeInfo?.title ?? channel;
  const units = (gaugeConfig?.units ?? gaugeInfo?.units ?? '').trim();
  const digits = gaugeConfig?.value_digits ?? gaugeInfo?.digits ?? 1;

  const channelValue = useChannelValue(channel, undefined);
  const liveValue = value ?? channelValue;
  const formatted = formatGaugeValue(liveValue, digits);

  if (variant === 'card') {
    const lo = gaugeConfig?.min ?? gaugeInfo?.lo;
    const hi = gaugeConfig?.max ?? gaugeInfo?.hi;
    const span = hi != null && lo != null ? hi - lo : 0;
    const pct =
      liveValue != null && Number.isFinite(liveValue) && lo != null && span > 0
        ? Math.max(0, Math.min(100, ((liveValue - lo) / span) * 100))
        : null;
    return (
      <div className={['readout-gauge', className].filter(Boolean).join(' ')} title={label}>
        <div className="readout-gauge-value">
          {formatted}
          {units.length > 0 && <span className="readout-gauge-unit">{units}</span>}
        </div>
        <div className="readout-gauge-label">{label}</div>
        {pct != null && (
          <div className="readout-gauge-bar">
            <div className="readout-gauge-bar-fill" style={{ width: `${pct}%` }} />
          </div>
        )}
      </div>
    );
  }

  const display = units.length > 0 ? `${formatted} ${units}` : formatted;
  const classes = ['gauge-live-readout', 'runtime-value-row', className].filter(Boolean).join(' ');

  return (
    <div className={classes} title={label}>
      <span className="runtime-value-label">{label}</span>
      <span className="runtime-value-display">{display}</span>
    </div>
  );
}
