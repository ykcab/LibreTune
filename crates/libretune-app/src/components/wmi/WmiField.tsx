import { useEffect, useState, type ReactNode } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { Constant } from '../dialogs/types';

export interface WmiFieldProps {
  name: string;
  label?: string;
  hint?: string;
  values: Record<string, number>;
  missing: Set<string>;
  disabled?: boolean;
  variant?: 'number' | 'select' | 'toggle';
  onCommit: (name: string, value: number) => Promise<void>;
  /** INI metadata, preloaded by useWmiConfig. When omitted, fetched on mount. */
  meta?: Constant | null;
  /** Optional control rendered next to the field label (e.g. a live check). */
  trailing?: ReactNode;
}

function bitLabel(option: string): string {
  let text = option?.trim() ?? '';
  if (!text) return 'Not assigned';
  const equals = text.indexOf('=');
  if (equals !== -1) text = text.slice(equals + 1);
  return text.replace(/^"|"$/g, '').trim() || 'Not assigned';
}

function cleanUnits(units: string | undefined): string {
  if (!units) return '';
  return units.startsWith('{') ? '' : units;
}

/** Square track switch shared by settings rows and compact flags. */
export function WmiSwitch({
  checked,
  onChange,
  disabled = false,
  busy = false,
  labelledBy,
  describedBy,
  showState = true,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  busy?: boolean;
  labelledBy?: string;
  describedBy?: string;
  showState?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      className={`wmi-switch${checked ? ' is-on' : ''}`}
      disabled={disabled || busy}
      onClick={() => onChange(!checked)}
    >
      <span className="wmi-switch__track" aria-hidden="true">
        <span className="wmi-switch__thumb" />
      </span>
      {showState ? (
        <span className="wmi-switch__state">{checked ? 'On' : 'Off'}</span>
      ) : null}
    </button>
  );
}

/**
 * One WMI tune constant, rendered as a settings row.
 *
 * Missing constants render nothing: the view only shows things this ECU
 * definition actually exposes. The section that owns the field reports how
 * many optional settings are hidden.
 */
export function WmiField({
  name,
  label,
  hint,
  values,
  missing,
  disabled = false,
  variant = 'number',
  onCommit,
  meta: metaProp,
  trailing,
}: WmiFieldProps) {
  const fieldId = `wmi-field-${name}`;
  const labelId = `${fieldId}-label`;
  const hintId = `${fieldId}-hint`;

  // When metadata is preloaded (useWmiConfig), use it directly and skip the
  // per-field fetch. Otherwise fall back to the legacy on-mount fetch so the
  // component stays usable standalone.
  const [fetchedMeta, setFetchedMeta] = useState<Constant | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const meta = metaProp !== undefined && metaProp !== null ? metaProp : fetchedMeta;

  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const value = values[name];
  const unavailable = missing.has(name);

  useEffect(() => {
    if (metaProp !== undefined) return; // externally supplied (or explicitly unavailable)
    if (missing.has(name)) {
      setFetchedMeta(null);
      return;
    }
    let cancelled = false;
    setLoadFailed(false);
    invoke<Constant>('get_constant', { name })
      .then((constant) => {
        if (!cancelled) setFetchedMeta(constant);
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [name, missing, metaProp]);

  useEffect(() => {
    if (value !== undefined) setText(String(value));
  }, [value]);

  if (unavailable) return null;

  if (loadFailed || metaProp === null) {
    return (
      <div className="wmi-row wmi-row--unavailable">
        <div className="wmi-row__text">
          <span className="wmi-row__label">{label ?? name}</span>
          <p className="wmi-row__hint">This setting could not be read from the ECU definition.</p>
        </div>
        <div className="wmi-row__control">
          <span className="wmi-input wmi-input--muted">—</span>
        </div>
      </div>
    );
  }

  if (!meta) {
    return (
      <div className="wmi-row wmi-row--loading" aria-busy="true">
        <div className="wmi-row__text">
          <span className="wmi-row__label">{label ?? name}</span>
        </div>
        <div className="wmi-row__control">
          <span className="wmi-row__skeleton" />
        </div>
      </div>
    );
  }

  const displayLabel = label ?? meta.label ?? meta.name;
  const units = cleanUnits(meta.units);
  const descriptionId = hint ? hintId : undefined;

  const commit = async (next: number) => {
    setBusy(true);
    setError(null);
    try {
      await onCommit(name, next);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setText(String(value ?? meta.min));
    } finally {
      setBusy(false);
    }
  };

  const isToggle = variant === 'toggle' && meta.value_type === 'bits';
  const isSelect = meta.value_type === 'bits' && !isToggle;

  let control: ReactNode;
  if (isToggle) {
    const on = (value ?? 0) >= 0.5;
    control = (
      <WmiSwitch
        checked={on}
        onChange={(next) => void commit(next ? 1 : 0)}
        disabled={disabled}
        busy={busy}
        labelledBy={labelId}
        describedBy={descriptionId}
      />
    );
  } else if (isSelect) {
    const selected = Math.round(value ?? 0);
    control = (
      <select
        id={fieldId}
        className="wmi-input wmi-input--select"
        value={selected}
        disabled={disabled || busy}
        aria-describedby={descriptionId}
        onChange={(event) => void commit(Number(event.target.value))}
      >
        {(meta.bit_options ?? []).map((option, index) => (
          <option key={`${name}-${index}`} value={index}>
            {bitLabel(option)}
          </option>
        ))}
      </select>
    );
  } else {
    control = (
      <div className="wmi-input-group">
        <input
          id={fieldId}
          className="wmi-input"
          type="text"
          inputMode="decimal"
          value={text}
          disabled={disabled || busy}
          aria-describedby={descriptionId}
          aria-invalid={error ? true : undefined}
          onChange={(event) => {
            if (/^-?\d*\.?\d*$/.test(event.target.value)) {
              setText(event.target.value);
              if (error) setError(null);
            }
          }}
          onBlur={() => {
            const parsed = Number.parseFloat(text);
            if (!Number.isFinite(parsed)) {
              setText(String(value ?? meta.min));
              return;
            }
            const clamped = Math.max(meta.min, Math.min(meta.max, parsed));
            setText(String(clamped));
            if (clamped !== value) void commit(clamped);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
          }}
        />
        {units ? <span className="wmi-input-group__unit">{units}</span> : null}
      </div>
    );
  }

  return (
    <div
      className={`wmi-row${disabled ? ' is-disabled' : ''}${busy ? ' is-busy' : ''}`}
      aria-busy={busy || undefined}
    >
      <div className="wmi-row__text">
        {isToggle ? (
          <span id={labelId} className="wmi-row__label">{displayLabel}</span>
        ) : (
          <label id={labelId} htmlFor={fieldId} className="wmi-row__label">
            {displayLabel}
          </label>
        )}
        {hint ? <p id={hintId} className="wmi-row__hint">{hint}</p> : null}
      </div>
      <div className="wmi-row__control">
        {trailing}
        {control}
      </div>
      {error ? <p className="wmi-row__error">{error}</p> : null}
    </div>
  );
}
