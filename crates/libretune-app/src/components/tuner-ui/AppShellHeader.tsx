import { Gauge, PanelLeft } from 'lucide-react';
import { MenuBar } from './MenuBar';
import { Toolbar } from './Toolbar';
import ConnectionMetrics from '../layout/ConnectionMetrics';
import type { MenuItem, ToolbarItem } from './TunerLayout';
import './AppShellHeader.css';

interface AppShellHeaderProps {
  menuItems: MenuItem[];
  toolbarItems: ToolbarItem[];
  connected: boolean;
  ecuName?: string;
  connectionPacketMode?: string;
  sidebarVisible: boolean;
  onSidebarToggle: () => void;
}

/** Phase 1 shell — brand, INI menus, quick actions, and connection status in one bar. */
export function AppShellHeader({
  menuItems,
  toolbarItems,
  connected,
  ecuName,
  connectionPacketMode,
  sidebarVisible,
  onSidebarToggle,
}: AppShellHeaderProps) {
  return (
    <header className="app-shell-header">
      <div className="app-shell-brand" title="LibreTune">
        <Gauge className="app-shell-logo" size={22} strokeWidth={2} />
        <span className="app-shell-brand-name">LibreTune</span>
      </div>

      <button
        type="button"
        className={`app-shell-sidebar-toggle ${sidebarVisible ? 'active' : ''}`}
        onClick={onSidebarToggle}
        title={sidebarVisible ? 'Hide navigator' : 'Show navigator'}
        aria-label={sidebarVisible ? 'Hide navigator' : 'Show navigator'}
        aria-pressed={sidebarVisible}
      >
        <PanelLeft size={18} strokeWidth={1.75} />
      </button>

      <nav className="app-shell-nav" aria-label="Application menu">
        <MenuBar items={menuItems} />
      </nav>

      <div className="app-shell-spacer" />

      <div className="app-shell-actions">
        <Toolbar items={toolbarItems} />
      </div>

      {connected && (
        <div className="app-shell-metrics" title="Link throughput and packet mode">
          <ConnectionMetrics compact />
          {connectionPacketMode && (
            <span className="app-shell-packet-mode">{connectionPacketMode}</span>
          )}
        </div>
      )}

      <div
        className={`app-shell-connection ${connected ? 'connected' : 'disconnected'}`}
        title={connected ? ecuName || 'ECU connected' : 'Not connected to ECU'}
      >
        <span className="app-shell-connection-dot" aria-hidden />
        <span className="app-shell-connection-label">
          {connected ? (ecuName || 'Live') : 'Offline'}
        </span>
      </div>
    </header>
  );
}
