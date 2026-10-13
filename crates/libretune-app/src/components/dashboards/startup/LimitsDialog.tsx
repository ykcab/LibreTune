/**
 * Limit editor for the Startup dashboard.
 *
 * The catalogue's bands are documented *defaults*; this dialog is where a driver
 * says "my engine is different". Values are entered in the units the dashboard is
 * currently displaying and stored in the channel's source units, so changing unit
 * preferences never silently rewrites a limit.
 *
 * It edits thresholds only — nothing here touches the ECU, the tune, or the
 * logged data.
 */
import { useEffect, useState } from 'react';
import { Dialog } from '../../common';
import {
  limitField,
  limitFields,
  normaliseOverride,
  type LimitOverride,
  type LimitOverrides,
} from './limits';
import type { UnitDisplay, ValueFormatter } from './useStartupTelemetry';

export interface LimitsDialogProps {
  open: boolean;
  onClose: () => void;
  overrides: LimitOverrides;
  onChange: (next: LimitOverrides) => void;
  fmt: ValueFormatter;
  /** Source-unit → display conversion (used in both directions). */
  display: (unit: string) => UnitDisplay;
}

export default function LimitsDialog({ open, onClose, overrides, onChange, fmt, display }: LimitsDialogProps) {
  const [draft, setDraft] = useState<LimitOverrides>(overrides);

  // Re-seed whenever the dialog opens so a cancelled edit leaves nothing behind.
  useEffect(() => {
    if (open) setDraft(overrides);
  }, [open, overrides]);

  const fields = limitFields(draft).sort((a, b) => a.label.localeCompare(b.label));

  const toDisplay = (unit: string, value: number) => {
    const conv = display(unit);
    return { conv, value: value * conv.scale + conv.offset };
  };
  const toSource = (unit: string, value: number) => {
    const conv = display(unit);
    return conv.scale === 0 ? value : (value - conv.offset) / conv.scale;
  };

  const setField = (id: string, key: 'warn' | 'crit', raw: number) => {
    const field = fields.find((f) => f.id === id);
    if (!field) return;
    const source = toSource(field.unit, raw);
    const next: LimitOverride = normaliseOverride(
      field.direction,
      key === 'warn' ? source : field.warn,
      key === 'crit' ? source : field.crit,
    );
    setDraft((prev) => ({ ...prev, [id]: next }));
  };

  const resetField = (id: string) => {
    setDraft((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  const apply = () => {
    // Drop entries that match the defaults, so "reset all" really is empty.
    const cleaned: LimitOverrides = {};
    for (const [id, value] of Object.entries(draft)) {
      const field = limitField(id, value);
      if (!field) continue;
      const sameAsDefault =
        Math.abs(field.warn - field.defaultWarn) < 1e-9 && Math.abs(field.crit - field.defaultCrit) < 1e-9;
      if (!sameAsDefault) cleaned[id] = value;
    }
    onChange(cleaned);
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Dashboard limits"
      size="lg"
      ariaLabel="Edit dashboard alarm limits"
    >
      <p className="sd-limits__intro">
        These are the thresholds the Startup dashboard prints, colours and alarms on. Defaults are
        documented engine-protection numbers; override them for your engine. Alarms still only arm
        while the engine is running.
      </p>

      <div className="sd-limits__grid">
        <span className="sd-limits__head">Channel</span>
        <span className="sd-limits__head">Warn</span>
        <span className="sd-limits__head">Critical</span>
        <span />
        {fields.map((field) => {
          const warn = toDisplay(field.unit, field.warn);
          const crit = toDisplay(field.unit, field.crit);
          const isDefault =
            Math.abs(field.warn - field.defaultWarn) < 1e-9 &&
            Math.abs(field.crit - field.defaultCrit) < 1e-9;
          return (
            <div className="sd-limits__row" key={field.id}>
              <span className="sd-limits__name" title={field.title}>
                {field.label}
                <span className="sd-limits__unit">{warn.conv.unit || field.unit}</span>
                {field.direction === 'below' && <span className="sd-limits__hint">low is bad</span>}
              </span>
              <label className="sd-limits__field">
                <input
                  type="number"
                  step="any"
                  aria-label={`${field.title} warning threshold`}
                  value={Number(warn.value.toFixed(field.digits === 0 ? 1 : 3))}
                  onChange={(event) => setField(field.id, 'warn', Number(event.target.value))}
                />
              </label>
              <label className="sd-limits__field">
                <input
                  type="number"
                  step="any"
                  aria-label={`${field.title} critical threshold`}
                  value={Number(crit.value.toFixed(field.digits === 0 ? 1 : 3))}
                  onChange={(event) => setField(field.id, 'crit', Number(event.target.value))}
                />
              </label>
              <button
                type="button"
                className="sd-limits__reset"
                onClick={() => resetField(field.id)}
                disabled={isDefault}
                title={`Default ${fmt.boundary(field.unit, field.digits, field.defaultWarn).text} / ${fmt.boundary(field.unit, field.digits, field.defaultCrit).text}`}
              >
                reset
              </button>
            </div>
          );
        })}
      </div>

      <div className="sd-limits__actions">
        <button type="button" className="sd-btn sd-btn--wide" onClick={() => setDraft({})}>
          RESET ALL
        </button>
        <span className="sd-scope-bar__spacer" />
        <button type="button" className="sd-btn sd-btn--wide" onClick={onClose}>
          CANCEL
        </button>
        <button type="button" className="sd-btn sd-btn--wide is-on" onClick={apply}>
          APPLY
        </button>
      </div>
    </Dialog>
  );
}
