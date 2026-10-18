/**
 * Startup dashboard render + interaction tests.
 *
 * The point of these is the promise the component makes: it draws only what the
 * ECU publishes, every control does something real, and the numbers on screen
 * come from the stream.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { UnitPreferencesProvider } from '../../../../contexts/useUnitPreferences';
import { useRealtimeStore } from '../../../../stores/realtimeStore';
import StartupDash, { isStartupDashPath } from '../StartupDash';
import type { ChannelMeta } from '../types';

const channelMeta: ChannelMeta[] = [
  { name: 'rpm', label: 'RPM', units: '' },
  { name: 'map', label: 'MAP', units: 'kPa' },
  { name: 'coolant', label: 'CLT', units: '°C' },
  { name: 'oilPressure', label: 'Oil pressure', units: 'kPa' },
  { name: 'lambda', label: 'Lambda', units: 'λ' },
  { name: 'targetLambda', label: 'Lambda target', units: 'λ' },
  { name: 'vvtIntake', label: 'VVT intake', units: 'deg' },
];

function renderDash(isConnected = true, meta: ChannelMeta[] = channelMeta) {
  return render(
    <UnitPreferencesProvider>
      <StartupDash isConnected={isConnected} channelMeta={meta} />
    </UnitPreferencesProvider>,
  );
}

/** Push a frame through the store the way the realtime listener does. */
function push(values: Record<string, number>, repeats = 1) {
  act(() => {
    for (let i = 0; i < repeats; i++) useRealtimeStore.getState().updateChannels(values);
  });
}

beforeEach(() => {
  useRealtimeStore.getState().clearChannels();
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('isStartupDashPath', () => {
  it('matches the startup face on any platform path form', () => {
    expect(isStartupDashPath('C:/dashes/Startup.ltdash.xml')).toBe(true);
    expect(isStartupDashPath('C:\\dashes\\startup.ltdash.xml')).toBe(true);
    expect(isStartupDashPath('/dashes/Startup.tuning.ltdash.xml')).toBe(true);
    expect(isStartupDashPath('/dashes/Tuning.ltdash.xml')).toBe(false);
    expect(isStartupDashPath(null)).toBe(false);
  });
});

describe('rendering', () => {
  it('renders the status strip, the scope and the analysis strip', () => {
    renderDash();
    expect(screen.getByText('LIBRETUNE')).toBeInTheDocument();
    expect(screen.getByTitle('Live multi-channel scope')).toBeInTheDocument();
    expect(screen.getByText('EVENTS')).toBeInTheDocument();
    expect(screen.getByText('FUELING vs TARGET')).toBeInTheDocument();
    expect(screen.getByText('OPERATING ENVELOPE')).toBeInTheDocument();
  });

  it('shows a dash (never a fabricated zero) for channels with no data', () => {
    renderDash();
    // Coolant is published by the INI but has produced no frame yet.
    const coolantTile = screen.getByTitle('Coolant temperature');
    expect(coolantTile.querySelector('.sd-tile__value')?.textContent).toContain('—');
  });

  it('shows a dash for a channel that has collapsed to raw zero', () => {
    renderDash();
    // Oil pressure at 0 kPa is physically impossible while running: the tile must
    // not print a confident 0 next to a sensor-dropout event.
    push({ rpm: 3000, oilPressure: 0 }, 3);
    const tile = screen.getByTitle(/Oil pressure/).querySelector('.sd-tile__value');
    expect(tile?.textContent).toContain('—');
    // ...while a channel where 0 is legitimate still prints 0.
    push({ rpm: 3000, oilPressure: 0, coolant: 0 }, 2);
    expect(screen.getByTitle('Coolant temperature').querySelector('.sd-tile__value')?.textContent).toContain('0');
  });

  it('renders only the channels the ECU publishes', () => {
    renderDash();
    expect(screen.getByTitle(/Engine speed/)).toBeInTheDocument();
    // In this definition (rpm, map, coolant, oil pressure, lambda, target, VVT):
    expect(screen.getByTitle(/Oil pressure/)).toBeInTheDocument();
    // Not in this INI: no tile, no empty tile.
    expect(screen.queryByTitle(/Injector duty cycle/)).toBeNull();
    expect(screen.queryByTitle(/Exhaust gas temperature/)).toBeNull();
  });

  it('shows live values and tones them by the catalogue limits', () => {
    renderDash();
    push({ rpm: 3200, map: 120, coolant: 118, lambda: 0.86, targetLambda: 0.85 }, 3);
    const coolant = screen.getByTitle('Coolant temperature').querySelector('.sd-tile__value');
    expect(coolant?.textContent).toContain('118');
    expect(coolant?.className).toContain('sd-tone-crit');
  });

  it('keeps the accessible value table in sync with the scope', () => {
    vi.useFakeTimers();
    try {
      renderDash();
      push({ rpm: 4321, map: 100, coolant: 90, lambda: 0.9, targetLambda: 0.85 }, 3);
      act(() => {
        vi.advanceTimersByTime(300);
      });
      const table = screen.getByText('Current value of every scope channel').closest('table');
      expect(table?.textContent).toContain('4321');
    } finally {
      vi.useRealTimers();
    }
  });

  it('tells the user what is being monitored while nothing has fired', () => {
    renderDash();
    expect(screen.getByText('Nothing detected this session.')).toBeInTheDocument();
    expect(screen.getByText('sensor channels')).toBeInTheDocument();
  });

  it('explains an offline dashboard instead of blaming the INI', () => {
    renderDash(false);
    expect(screen.getByText('DISCONNECTED')).toBeInTheDocument();
    expect(screen.getByText(/Waiting for a live stream/)).toBeInTheDocument();
  });
});

describe('scope controls', () => {
  it('changes the window when a window button is pressed', () => {
    renderDash();
    const tenSeconds = screen.getByTitle('Show the last 10 seconds');
    act(() => tenSeconds.click());
    expect(tenSeconds.className).toContain('is-on');
    expect(screen.getByTitle('Show the last 20 seconds').className).not.toContain('is-on');
  });

  it('pauses and resumes the live window', () => {
    renderDash();
    push({ rpm: 3000, map: 100 }, 5);
    const pause = screen.getByTitle(/Freeze the window/);
    act(() => pause.click());
    expect(screen.getByTitle(/Resume the live window/)).toBeInTheDocument();
  });

  it('switches the centre to the recorded session and back', () => {
    renderDash();
    act(() => screen.getByTitle('Scrub the recorded session (the logger keeps recording)').click());
    // Live-only controls are gone (they would do nothing in review mode) ...
    expect(screen.queryByTitle(/Freeze the window/)).toBeNull();
    expect(screen.queryByTitle('Choose which channels are plotted')).toBeNull();
    expect(screen.getByText('recorded session · the rails stay live')).toBeInTheDocument();
    // ...and the live scope comes back with them.
    act(() => screen.getByTitle('Live multi-channel scope').click());
    expect(screen.getByTitle('Choose which channels are plotted')).toBeInTheDocument();
  });

  it('opens the channel picker and lets a lane be added', () => {
    renderDash();
    // The INI resolves five catalogue channels; the default lane set plots three
    // of them (the rest are offered but not plotted).
    expect(screen.getByTitle('Choose which channels are plotted').textContent).toContain('(3)');
    act(() => screen.getByTitle('Choose which channels are plotted').click());
    const coolant = screen
      .getAllByRole('checkbox')
      .find((box) => box.closest('label')?.textContent?.toUpperCase().includes('COOLANT'));
    expect(coolant).toBeDefined();
    act(() => (coolant as HTMLInputElement).click());
    expect(screen.getByTitle('Choose which channels are plotted').textContent).toContain('(4)');
  });

  it('remembers the lane selection between mounts', () => {
    const first = renderDash();
    act(() => screen.getByTitle('Choose which channels are plotted').click());
    const boxes = screen.getByText(/^Tuning channels/).closest('.sd-picker__col')!
      .querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    act(() => boxes[0].click()); // remove the first plotted lane
    // The selection keeps channels this ECU does not publish, so switching back
    // to an ECU that does publish them restores the lane.
    const stored = JSON.parse(window.localStorage.getItem('libretune-startup-lanes') ?? '[]') as string[];
    expect(stored).not.toContain('rpm');
    expect(screen.getByTitle('Choose which channels are plotted').textContent).toContain('(2)');
    first.unmount();
    renderDash();
    expect(screen.getByTitle('Choose which channels are plotted').textContent).toContain('(2)');
  });

  it('filters the channel picker and closes on Escape', () => {
    renderDash();
    act(() => screen.getByTitle('Choose which channels are plotted').click());
    const filter = screen.getByLabelText('Filter channels') as HTMLInputElement;
    act(() => {
      fireEvent.change(filter, { target: { value: 'cool' } });
    });
    expect(screen.getByText(/^Tuning channels \(1\)/)).toBeInTheDocument();
    act(() => {
      filter
        .closest('.sd-picker')
        ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(screen.queryByLabelText('Filter channels')).toBeNull();
  });

  it('offers the INI’s own channels, not just the curated set', () => {
    renderDash();
    act(() => screen.getByTitle('Choose which channels are plotted').click());
    expect(screen.getByText('VVT intake')).toBeInTheDocument();
  });
});

describe('limits, banks and performance', () => {
  it('opens the limit editor from the status strip', () => {
    renderDash();
    act(() => screen.getByTitle(/Adjust the dashboard's alarm limits/).click());
    expect(screen.getByText('Dashboard limits')).toBeInTheDocument();
    // The editor offers adjustable channels with accessible field labels.
    expect(screen.getByLabelText('Coolant temperature warning threshold')).toBeInTheDocument();
    expect(screen.getByLabelText('Exhaust gas temperature critical threshold')).toBeInTheDocument();
    act(() => screen.getByText('CANCEL').click());
    expect(screen.queryByText('Dashboard limits')).toBeNull();
  });

  it('persists an edited limit and prints it on the tile', () => {
    renderDash();
    expect(screen.getByTitle('Coolant temperature').querySelector('.sd-meter__scale-label')?.textContent).toBe('105');
    act(() => screen.getByTitle(/Adjust the dashboard's alarm limits/).click());
    const warn = screen.getByLabelText('Coolant temperature warning threshold') as HTMLInputElement;
    act(() => {
      fireEvent.change(warn, { target: { value: '112' } });
    });
    act(() => screen.getByText('APPLY').click());
    // The tile now prints the driver's limit, and the choice survived.
    expect(screen.getByTitle('Coolant temperature').querySelector('.sd-meter__scale-label')?.textContent).toBe('112');
    const stored = JSON.parse(window.localStorage.getItem('libretune-startup-limits') ?? '{}');
    expect(stored.coolant?.warn).toBe(112);
  });

  it('shows the second wideband and the bank split only when both exist', () => {
    renderDash(false, [
      ...channelMeta,
      { name: 'lambdaValue2', label: 'Lambda 2', units: 'λ' },
    ]);
    expect(screen.getByText('CYLINDER BANKS')).toBeInTheDocument();
    push({ rpm: 3000, map: 150, tps: 80, lambda: 0.86, lambdaValue2: 0.93 }, 5);
    const split = screen.getByTitle(/Absolute difference between the two widebands/);
    expect(split.querySelector('.sd-tile__value')?.textContent).toContain('0.070');
    expect(split.querySelector('.sd-tile__detail')?.textContent).toContain('bank 2 leaner');
  });

  it('explains why performance cannot be estimated when there is no speed channel', () => {
    renderDash();
    expect(screen.getByText('PERFORMANCE (EST.)')).toBeInTheDocument();
    expect(screen.getByText(/definitions? publishes no vehicle-speed channel|Estimation starts when the ECU is streaming/)).toBeInTheDocument();
  });
});

describe('events', () => {
  it('raises a live event once a limit is held', () => {
    vi.useFakeTimers();
    try {
      renderDash();
      // 30 frames of an overheating engine: the latch (600 ms) is satisfied.
      for (let i = 0; i < 30; i++) {
        push({ rpm: 3000, map: 120, tps: 60, coolant: 120, lambda: 0.86, targetLambda: 0.85 });
        act(() => {
          vi.advanceTimersByTime(60);
        });
      }
      expect(screen.getAllByText(/CRITICAL|HIGH/).length).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('BOOST view', () => {
  it('plots MAP minus baro against the ECU target, and hides the channel picker', () => {
    renderDash();
    push({ rpm: 3000, map: 180, coolant: 90 }, 3);

    fireEvent.click(screen.getByRole('button', { name: 'BOOST' }));

    expect(screen.queryByRole('button', { name: /CHANNELS/ })).toBeNull();
    // The scope publishes its lane values as text for assistive tech.
    const table = document.querySelector('.sd-scope table');
    expect(table?.textContent).toContain('BOOST');
    expect(table?.textContent).toContain('79'); // 180 kPa − 101.325 kPa, whole kPa
  });
});
