/**
 * Limit editor interaction, isolated from the dashboard.
 */
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { UnitPreferencesProvider } from '../../../../contexts/useUnitPreferences';
import LimitsDialog from '../LimitsDialog';
import type { LimitOverrides } from '../limits';
import { useValueFormatter, useUnitDisplay } from '../useStartupTelemetry';

function Harness({ onChange, overrides = {} }: { onChange: (o: LimitOverrides) => void; overrides?: LimitOverrides }) {
  const fmt = useValueFormatter();
  const display = useUnitDisplay();
  return (
    <LimitsDialog
      open
      onClose={() => {}}
      overrides={overrides}
      onChange={onChange}
      fmt={fmt}
      display={display}
    />
  );
}

describe('LimitsDialog', () => {
  it('reports an edited pair in source units', () => {
    const onChange = vi.fn();
    const overrides: LimitOverrides = {};
    render(
      <UnitPreferencesProvider>
        <Harness onChange={onChange} overrides={overrides} />
      </UnitPreferencesProvider>,
    );
    const warn = screen.getByLabelText('Coolant temperature warning threshold') as HTMLInputElement;
    expect(warn.value).toBe('105');
    act(() => {
      fireEvent.change(warn, { target: { value: '112' } });
    });
    act(() => screen.getByText('APPLY').click());
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toEqual({ coolant: { warn: 112, crit: 115 } });
  });
});
