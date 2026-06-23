import { useMemo } from 'react';
import { useChannels } from '../../stores/realtimeStore';
import './TableLiveReadouts.css';

interface TableLiveReadoutsProps {
  xChannel?: string | null;
  yChannel?: string | null;
  zChannel?: string | null;
  xLabel?: string;
  yLabel?: string;
  precision?: number;
  compact?: boolean;
}

function formatReadout(value: number | undefined, precision: number): string {
  if (value === undefined || Number.isNaN(value)) return '—';
  return value.toFixed(precision);
}

export default function TableLiveReadouts({
  xChannel,
  yChannel,
  zChannel,
  xLabel,
  yLabel,
  precision = 3,
  compact = false,
}: TableLiveReadoutsProps) {
  const channels = useMemo(() => {
    const list: string[] = [];
    if (xChannel) list.push(xChannel);
    if (yChannel) list.push(yChannel);
    if (zChannel) list.push(zChannel);
    return list;
  }, [xChannel, yChannel, zChannel]);

  const realtimeData = useChannels(channels);

  if (channels.length === 0) return null;

  const items: Array<{ key: string; label: string; value: string }> = [];

  if (xChannel) {
    items.push({
      key: 'x',
      label: `${xLabel || 'X Axis'} value`,
      value: formatReadout(realtimeData[xChannel], precision),
    });
  }
  if (yChannel) {
    items.push({
      key: 'y',
      label: `${yLabel || 'Y Axis'} value`,
      value: formatReadout(realtimeData[yChannel], precision),
    });
  }
  if (zChannel) {
    items.push({
      key: 'z',
      label: 'Output value',
      value: formatReadout(realtimeData[zChannel], precision),
    });
  }

  return (
    <div className={`table-live-readouts${compact ? ' compact' : ''}`}>
      {items.map((item) => (
        <div key={item.key} className="table-live-readout">
          <span className="table-live-readout-label">{item.label}</span>
          <span className="table-live-readout-value">{item.value}</span>
        </div>
      ))}
    </div>
  );
}
