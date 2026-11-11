import { useId, type ReactNode } from 'react';
import type { WmiTone } from './wmiFormat';
import { Button, type ButtonVariant } from '../common/Button';

/** Flat panel used for every block in the WMI view. */
export function WmiPanel({
  id,
  title,
  meta,
  actions,
  children,
  className = '',
  bodyClassName = '',
}: {
  id?: string;
  title: string;
  meta?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  const titleId = useId();
  return (
    <section
      id={id}
      className={`wmi-panel ${className}`.trim()}
      aria-labelledby={titleId}
    >
      <header className="wmi-panel__head">
        <h2 id={titleId} className="wmi-panel__title">{title}</h2>
        {meta ? <div className="wmi-panel__meta">{meta}</div> : null}
        {actions ? <div className="wmi-panel__actions">{actions}</div> : null}
      </header>
      <div className={`wmi-panel__body ${bodyClassName}`.trim()}>{children}</div>
    </section>
  );
}

/** Inline status indicator: text is always present, colour is supplementary. */
export function WmiDot({ tone, className = '' }: { tone: WmiTone; className?: string }) {
  return (
    <span
      className={`wmi-dot wmi-tone-${tone} ${className}`.trim()}
      aria-hidden="true"
    />
  );
}

export function WmiNotice({
  tone = 'info',
  title,
  children,
  action,
  onDismiss,
  className = '',
}: {
  tone?: WmiTone;
  title?: ReactNode;
  children: ReactNode;
  action?: ReactNode;
  onDismiss?: () => void;
  className?: string;
}) {
  return (
    <div
      className={`wmi-notice wmi-tone-${tone} ${className}`.trim()}
      role={tone === 'crit' ? 'alert' : 'status'}
    >
      <span className="wmi-notice__rule" aria-hidden="true" />
      <div className="wmi-notice__body">
        {title ? <strong className="wmi-notice__title">{title}</strong> : null}
        <div className="wmi-notice__text">{children}</div>
      </div>
      {action ? <div className="wmi-notice__action">{action}</div> : null}
      {onDismiss ? (
        <button
          type="button"
          className="wmi-notice__dismiss"
          onClick={onDismiss}
          aria-label="Dismiss"
        >
          ×
        </button>
      ) : null}
    </div>
  );
}

export function WmiButton({
  children,
  onClick,
  disabled = false,
  variant = 'secondary',
  className = '',
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  className?: string;
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant={variant as ButtonVariant}
      className={`wmi-btn wmi-btn--${variant} ${className}`.trim()}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </Button>
  );
}

/** Label/value row used by the guard, correction and calibration panels. */
export function WmiKvRow({
  label,
  value,
  detail,
  tone = 'dim',
}: {
  label: string;
  value: string;
  detail?: string;
  tone?: WmiTone;
}) {
  return (
    <div className="wmi-kv__row">
      <WmiDot tone={tone} />
      <span className="wmi-kv__label">{label}</span>
      <span className={`wmi-kv__value wmi-tone-${tone}`}>{value}</span>
      {detail ? <span className="wmi-kv__detail">{detail}</span> : null}
    </div>
  );
}

export function WmiEmpty({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="wmi-empty">
      <h2>{title}</h2>
      <p>{children}</p>
    </div>
  );
}
