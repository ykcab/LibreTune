/**
 * Shared configurator layout — Port Editor, INI dialogs, and similar submenus.
 */

import { ReactNode, useState } from 'react';
import { ChevronDown, ChevronRight, Search, ArrowLeft, AlertTriangle } from 'lucide-react';
import './ConfiguratorLayout.css';

export function ConfiguratorShell({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`configurator ${className}`.trim()}>{children}</div>;
}

export function ConfiguratorHeader({
  icon,
  title,
  subtitle,
  onBack,
  actions,
}: {
  icon?: ReactNode;
  title: string;
  subtitle?: string;
  onBack?: () => void;
  actions?: ReactNode;
}) {
  return (
    <header className="configurator-header">
      <div className="configurator-header-main">
        {onBack && (
          <button type="button" className="configurator-back" onClick={onBack} title="Back">
            <ArrowLeft size={18} />
          </button>
        )}
        {icon && <div className="configurator-header-icon">{icon}</div>}
        <div className="configurator-header-text">
          <h2 className="configurator-title">{title}</h2>
          {subtitle && <span className="configurator-subtitle">{subtitle}</span>}
        </div>
      </div>
      {actions && <div className="configurator-header-actions">{actions}</div>}
    </header>
  );
}

export function ConfiguratorWarnings({ warnings }: { warnings: string[] }) {
  if (warnings.length === 0) return null;
  return (
    <div className="configurator-warnings" role="status">
      <AlertTriangle size={16} />
      <div className="configurator-warnings-inner">
        {warnings.slice(0, 4).map((warn, i) => (
          <span key={i}>{warn}</span>
        ))}
        {warnings.length > 4 && (
          <span className="configurator-warnings-more">+{warnings.length - 4} more</span>
        )}
      </div>
    </div>
  );
}

export function ConfiguratorSearch({
  value,
  onChange,
  placeholder = 'Search settings…',
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="configurator-search">
      <Search size={15} strokeWidth={2} />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </div>
  );
}

export function ConfiguratorBody({ children }: { children: ReactNode }) {
  return <div className="configurator-body">{children}</div>;
}

export function ConfiguratorGroups({ children }: { children: ReactNode }) {
  return <div className="configurator-groups">{children}</div>;
}

export function ConfiguratorGroup({
  title,
  icon,
  count,
  defaultExpanded = true,
  children,
}: {
  title: string;
  icon?: ReactNode;
  count?: number;
  defaultExpanded?: boolean;
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <section className="configurator-group">
      <button
        type="button"
        className="configurator-group-header"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        {icon && <span className="configurator-group-icon">{icon}</span>}
        <span className="configurator-group-title">{title}</span>
        {count !== undefined && <span className="configurator-group-count">{count}</span>}
      </button>
      {expanded && <div className="configurator-group-body">{children}</div>}
    </section>
  );
}

export function ConfiguratorFooter({ children }: { children: ReactNode }) {
  return <footer className="configurator-footer">{children}</footer>;
}
