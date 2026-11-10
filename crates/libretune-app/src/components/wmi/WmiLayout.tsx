import type { ReactNode } from 'react';
import type { WmiTone } from './wmiFormat';

export function WmiSection({
  title,
  description,
  actions,
  children,
  className = '',
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`wmi-section ${className}`.trim()}>
      <div className="wmi-section__head">
        <div>
          <h3 className="wmi-section__title">{title}</h3>
          {description ? <p className="wmi-section__desc">{description}</p> : null}
        </div>
        {actions ? <div className="wmi-section__actions">{actions}</div> : null}
      </div>
      <div className="wmi-section__body">{children}</div>
    </section>
  );
}

export function WmiTile({
  label,
  value,
  detail,
  tone = 'dim',
  children,
}: {
  label: string;
  value: string;
  detail?: string;
  tone?: WmiTone;
  children?: ReactNode;
}) {
  return (
    <div className={`wmi-tile wmi-tone-${tone}`}>
      <span className="wmi-tile__label">{label}</span>
      <strong className="wmi-tile__value">{value}</strong>
      {detail ? <span className="wmi-tile__detail">{detail}</span> : null}
      {children}
    </div>
  );
}

export function WmiCallout({
  tone = 'info',
  children,
}: {
  tone?: WmiTone;
  children: ReactNode;
}) {
  return <div className={`wmi-callout wmi-tone-${tone}`}>{children}</div>;
}

import { Button } from '../common/Button';

export function WmiButton({
  children,
  onClick,
  disabled = false,
  variant = 'ghost',
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  variant?: 'primary' | 'danger' | 'ghost';
}) {
  return (
    <Button
      type="button"
      variant={variant}
      className={`wmi-btn wmi-btn--${variant}`}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </Button>
  );
}
