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
}

function bitLabel(option: string): string {
  let text = option?.trim() ?? '';
  if (!text) return 'Not assigned';
  const equals = text.indexOf('=');
  if (equals !== -1) text = text.slice(equals + 1);
  return text.replace(/^"|"$/g, '').trim() || 'Not assigned';
}

/** One WMI tune constant with its INI metadata. Missing constants render nothing. */
export function WmiField({
  name,
  label,
  hint,
  values,
  missing,
  disabled = false,
  variant = 'number',
  onCommit,
}: WmiFieldProps) {
  const [meta, setMeta] = useState<Constant | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const value = values[name];
  const unavailable = missing.has(name) || loadFailed;

  useEffect(() => {
    if (missing.has(name)) {
      setMeta(null);
      return;
    }
    let cancelled = false;
    setLoadFailed(false);
    invoke<Constant>('get_constant', { name })
      .then((constant) => {
        if (!cancelled) setMeta(constant);
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [name, missing]);

  useEffect(() => {
    if (value !== undefined) setText(String(value));
  }, [value]);

  if (unavailable) return null;

  if (!meta) {
    return (
      <div className="wmi-field wmi-field--loading" aria-busy="true">
        <span className="wmi-field__label">{label ?? name}</span>
        <span className="wmi-field__skeleton" />
      </div>
    );
  }

  const displayLabel = label ?? meta.label ?? meta.name;
  const units = meta.units?.startsWith('{') ? '' : meta.units;

  const commit = async (next: number) => {
    setBusy(true);
    setError(null);
    try {
      await onCommit(name, next);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
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
      <button
        type="button"
        role="switch"
        aria-checked={on}
        className={`wmi-switch${on ? ' is-on' : ''}`}
        disabled={disabled || busy}
        onClick={() => void commit(on ? 0 : 1)}
      >
        <span className="wmi-switch__track">
          <span className="wmi-switch__thumb" />
        </span>
        <span className="wmi-switch__text">{on ? 'On' : 'Off'}</span>
      </button>
    );
  } else if (isSelect) {
    const selected = Math.round(value ?? 0);
    control = (
      <select
        className="wmi-input"
        value={selected}
        disabled={disabled || busy}
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
      <div className="wmi-input-wrap">
        <input
          className="wmi-input"
          type="text"
          inputMode="decimal"
          value={text}
          disabled={disabled || busy}
          onChange={(event) => {
            if (/^-?\d*\.?\d*$/.test(event.target.value)) setText(event.target.value);
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
        {units ? <span className="wmi-input__unit">{units}</span> : null}
      </div>
    );
  }

  return (
    <div className={`wmi-field${disabled ? ' is-disabled' : ''}`}>
      <div className="wmi-field__head">
        <span className="wmi-field__label">{displayLabel}</span>
        {units && !isToggle && !isSelect ? <span className="wmi-field__unit">{units}</span> : null}
      </div>
      <div className="wmi-field__control">{control}</div>
      {hint ? <p className="wmi-field__hint">{hint}</p> : null}
      {error ? <p className="wmi-field__error">{error}</p> : null}
    </div>
  );
}
