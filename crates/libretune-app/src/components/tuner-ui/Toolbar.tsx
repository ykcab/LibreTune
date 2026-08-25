import { useEffect, useRef, useState } from 'react';
import {
  FilePlus,
  FolderOpen,
  Save,
  Flame,
  Plug,
  Unplug,
  Gauge,
  Circle,
  Square,
  Settings,
  Undo2,
  Redo2,
  Copy,
  ClipboardPaste,
  HelpCircle,
  MoreHorizontal,
  LucideIcon,
} from 'lucide-react';
import { ToolbarItem } from './TunerLayout';
import './Toolbar.css';

interface ToolbarProps {
  items: ToolbarItem[];
}

// Map icon string names to lucide-react components
const iconMap: Record<string, LucideIcon> = {
  'new': FilePlus,
  'open': FolderOpen,
  'save': Save,
  'burn': Flame,
  'connect': Plug,
  'disconnect': Unplug,
  'realtime': Gauge,
  'log-start': Circle,
  'log-stop': Square,
  'settings': Settings,
  'undo': Undo2,
  'redo': Redo2,
  'copy': Copy,
  'paste': ClipboardPaste,
  'default': HelpCircle,
};

function renderItem(item: ToolbarItem, index: number) {
  if (item.separator) {
    return <div key={`sep-${index}`} className="toolbar-separator" />;
  }

  // If a toolbar item supplies custom content, render it inline
  if (item.content) {
    return (
      <div key={item.id} className="toolbar-content" title={item.tooltip} onClick={item.onClick}>
        {item.content}
      </div>
    );
  }

  const IconComponent = iconMap[item.icon] || iconMap['default'];
  const isRecording = item.icon === 'log-start' && item.active;
  const isBurnPending = item.variant === 'burn-pending';

  return (
    <button
      key={item.id}
      className={`toolbar-button${item.active ? ' toolbar-button-active' : ''}${isBurnPending ? ' toolbar-button-burn-pending' : ''}`}
      onClick={item.onClick}
      disabled={item.disabled}
      title={item.tooltip}
      aria-label={item.tooltip}
    >
      <IconComponent
        size={18}
        strokeWidth={1.75}
        className={isRecording ? 'icon-recording' : undefined}
      />
    </button>
  );
}

export function Toolbar({ items }: ToolbarProps) {
  const [moreOpen, setMoreOpen] = useState(false);
  const moreWrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!moreOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (moreWrapRef.current && !moreWrapRef.current.contains(e.target as Node)) {
        setMoreOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [moreOpen]);

  const actionableItems = items.filter((item) => !item.separator);

  return (
    <div className="toolbar" role="toolbar">
      <div className="toolbar-items">
        {items.map((item, index) => renderItem(item, index))}
      </div>

      {/* Reachability fallback for narrow windows: the row above scrolls
          horizontally (toolbar-items { overflow-x: auto }), and this button
          lists every action regardless of scroll position — same pattern as
          the tab bar's "▾ More tabs" menu. */}
      <div className="toolbar-more-wrap" ref={moreWrapRef}>
        <button
          className={`toolbar-button${moreOpen ? ' toolbar-button-active' : ''}`}
          onClick={() => setMoreOpen((v) => !v)}
          aria-label="More toolbar actions"
          title="More"
        >
          <MoreHorizontal size={18} strokeWidth={1.75} />
        </button>
        {moreOpen && (
          <div className="toolbar-more-menu" role="menu">
            {actionableItems.map((item) => {
              if (item.content) {
                return (
                  <div key={item.id} className="toolbar-more-item" title={item.tooltip} onClick={() => { item.onClick?.(); setMoreOpen(false); }}>
                    {item.content}
                  </div>
                );
              }
              const IconComponent = iconMap[item.icon] || iconMap['default'];
              return (
                <button
                  key={item.id}
                  className="toolbar-more-item"
                  disabled={item.disabled}
                  onClick={() => { item.onClick?.(); setMoreOpen(false); }}
                >
                  <IconComponent size={16} strokeWidth={1.75} />
                  <span className="toolbar-more-item-label">{item.tooltip}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
