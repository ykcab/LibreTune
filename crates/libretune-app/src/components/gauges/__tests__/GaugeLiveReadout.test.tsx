import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { GaugeLiveReadout } from '../GaugeLiveReadout';
import { useRealtimeStore } from '../../../stores/realtimeStore';
import type { SimpleGaugeInfo } from '../../curves/CurveEditor';

const flex: SimpleGaugeInfo = {
  name: 'flexPercentGauge',
  channel: 'flexPercent',
  title: 'Flex Ethanol %',
  units: '%',
  lo: 0,
  hi: 100,
  low_warning: 0,
  high_warning: 100,
  low_danger: 0,
  high_danger: 100,
  digits: 1,
};

describe('GaugeLiveReadout', () => {
  afterEach(() => {
    useRealtimeStore.getState().clearChannels();
  });

  it('card variant shows a live value, units, and range bar instead of an analog gauge', () => {
    useRealtimeStore.getState().updateChannels({ flexPercent: 42.5 });
    const { container } = render(<GaugeLiveReadout gaugeInfo={flex} variant="card" />);

    expect(screen.getByText('42.5')).toBeInTheDocument();
    expect(screen.getByText('%')).toBeInTheDocument();
    expect(screen.getByText('Flex Ethanol %')).toBeInTheDocument();
    expect(container.querySelector('.readout-gauge-bar-fill')).toHaveStyle({ width: '42.5%' });
  });
});
