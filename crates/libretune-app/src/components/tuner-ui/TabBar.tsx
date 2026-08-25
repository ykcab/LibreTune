import React, { useRef, useState, useCallback, useEffect, DragEvent, MouseEvent } from 'react';
import { ExternalLink } from 'lucide-react';
import './TabBar.css';

type IconElement = React.ReactElement;

export interface Tab {
  id: string;
  title: string;
  icon?: string;
  dirty?: boolean;
  closable?: boolean;
}

interface TabBarProps {
  tabs: Tab[];
  activeTabId: string | null;
  onTabSelect: (tabId: string) => void;
  onTabClose: (tabId: string) => void;
  onTabReorder?: (tabs: Tab[]) => void;
  onTabPopout?: (tabId: string) => void;
}

export function TabBar({
  tabs,
  activeTabId,
  onTabSelect,
  onTabClose,
  onTabReorder,
  onTabPopout,
}: TabBarProps) {
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const tabsRef = useRef<HTMLDivElement>(null);
  const overflowRef = useRef<HTMLDivElement>(null);

  // Keep the active tab in view — without this, a tab opened while many
  // others are already open can end up scrolled out of the visible strip
  // with no visual feedback that it opened at all (the tab bar scrolls
  // horizontally but never scrolls itself, and the old "▾ More tabs"
  // button was dead — no onClick — so there was no way to reach it either).
  useEffect(() => {
    if (!activeTabId || !tabsRef.current) return;
    const el = tabsRef.current.querySelector<HTMLElement>(
      `[data-tab-id="${CSS.escape(activeTabId)}"]`,
    );
    el?.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' });
  }, [activeTabId, tabs.length]);

  // Close the overflow dropdown on an outside click.
  useEffect(() => {
    if (!overflowOpen) return;
    const handleClick = (e: globalThis.MouseEvent) => {
      if (overflowRef.current && !overflowRef.current.contains(e.target as Node)) {
        setOverflowOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [overflowOpen]);

  const handleDragStart = useCallback((e: DragEvent, tabId: string) => {
    setDraggedId(tabId);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', tabId);
    
    // Create ghost image
    const ghost = e.currentTarget.cloneNode(true) as HTMLElement;
    ghost.style.opacity = '0.8';
    ghost.style.position = 'absolute';
    ghost.style.top = '-1000px';
    document.body.appendChild(ghost);
    e.dataTransfer.setDragImage(ghost, 0, 0);
    setTimeout(() => document.body.removeChild(ghost), 0);
  }, []);

  const handleDragOver = useCallback((e: DragEvent, tabId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (tabId !== draggedId) {
      setDropTargetId(tabId);
    }
  }, [draggedId]);

  const handleDragLeave = useCallback(() => {
    setDropTargetId(null);
  }, []);

  const handleDrop = useCallback((e: DragEvent, targetId: string) => {
    e.preventDefault();
    if (!draggedId || draggedId === targetId || !onTabReorder) return;

    const draggedIndex = tabs.findIndex((t) => t.id === draggedId);
    const targetIndex = tabs.findIndex((t) => t.id === targetId);

    if (draggedIndex === -1 || targetIndex === -1) return;

    const newTabs = [...tabs];
    const [removed] = newTabs.splice(draggedIndex, 1);
    newTabs.splice(targetIndex, 0, removed);

    onTabReorder(newTabs);
    setDraggedId(null);
    setDropTargetId(null);
  }, [draggedId, tabs, onTabReorder]);

  const handleDragEnd = useCallback(() => {
    setDraggedId(null);
    setDropTargetId(null);
  }, []);

  const handleMiddleClick = useCallback((e: MouseEvent, tab: Tab) => {
    if (e.button === 1 && tab.closable !== false) {
      e.preventDefault();
      onTabClose(tab.id);
    }
  }, [onTabClose]);

  const handleDoubleClick = useCallback((e: MouseEvent, tabId: string) => {
    if (onTabPopout) {
      e.preventDefault();
      onTabPopout(tabId);
    }
  }, [onTabPopout]);

  const handleCloseClick = useCallback((e: MouseEvent, tabId: string) => {
    e.stopPropagation();
    onTabClose(tabId);
  }, [onTabClose]);

  if (tabs.length === 0) {
    return <div className="tabbar tabbar-empty" />;
  }

  return (
    <div className="tabbar" ref={tabsRef}>
      <div className="tabbar-tabs">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            data-tab-id={tab.id}
            className={`tab ${tab.id === activeTabId ? 'tab-active' : ''} ${
              tab.id === draggedId ? 'tab-dragging' : ''
            } ${tab.id === dropTargetId ? 'tab-drop-target' : ''}`}
            draggable
            onClick={() => onTabSelect(tab.id)}
            onMouseDown={(e) => handleMiddleClick(e, tab)}
            onDoubleClick={(e) => handleDoubleClick(e, tab.id)}
            onDragStart={(e) => handleDragStart(e, tab.id)}
            onDragOver={(e) => handleDragOver(e, tab.id)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, tab.id)}
            onDragEnd={handleDragEnd}
            role="tab"
            aria-selected={tab.id === activeTabId}
          >
            {tab.icon && <TabIcon icon={tab.icon} />}
            <span className="tab-title">{tab.title}</span>
            {tab.dirty && <span className="tab-dirty">●</span>}
            {onTabPopout && (
              <button
                className="tab-popout"
                onClick={(e) => {
                  e.stopPropagation();
                  onTabPopout(tab.id);
                }}
                aria-label={`Pop out ${tab.title}`}
                title="Pop out to new window"
              >
                <ExternalLink size={12} />
              </button>
            )}
            {tab.closable !== false && (
              <button
                className="tab-close"
                onClick={(e) => handleCloseClick(e, tab.id)}
                aria-label={`Close ${tab.title}`}
              >
                ×
              </button>
            )}
          </div>
        ))}
      </div>
      
      {/* Tab overflow menu: lists every open tab, so one is always reachable
          even when the strip has scrolled it out of view. */}
      <div className="tabbar-overflow-wrap" ref={overflowRef}>
        <button
          className="tabbar-overflow"
          title="More tabs"
          onClick={() => setOverflowOpen((open) => !open)}
        >
          ▾
        </button>
        {overflowOpen && (
          <div className="tabbar-overflow-menu" role="menu">
            {tabs.map((tab) => (
              <div
                key={tab.id}
                className={`tabbar-overflow-item ${tab.id === activeTabId ? 'tabbar-overflow-item-active' : ''}`}
                role="menuitem"
                onClick={() => {
                  onTabSelect(tab.id);
                  setOverflowOpen(false);
                }}
              >
                {tab.icon && <TabIcon icon={tab.icon} />}
                <span className="tabbar-overflow-item-title">{tab.title}</span>
                {tab.closable !== false && (
                  <button
                    className="tab-close"
                    onClick={(e) => {
                      e.stopPropagation();
                      onTabClose(tab.id);
                    }}
                    aria-label={`Close ${tab.title}`}
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TabIcon({ icon }: { icon: string }) {
  const icons: Record<string, IconElement> = {
    table: (
      <svg viewBox="0 0 16 16" fill="currentColor">
        <path d="M1 2h14v12H1V2zm1 1v3h5V3H2zm6 0v3h6V3H8zM2 7v3h5V7H2zm6 0v3h6V7H8zM2 11v2h5v-2H2zm6 0v2h6v-2H8z"/>
      </svg>
    ),
    dialog: (
      <svg viewBox="0 0 16 16" fill="currentColor">
        <path d="M2 2h12v12H2V2zm1 1v10h10V3H3z"/>
        <path d="M4 5h8v1H4zm0 2h6v1H4zm0 2h7v1H4z"/>
      </svg>
    ),
    dashboard: (
      <svg viewBox="0 0 16 16" fill="currentColor">
        <path d="M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2zm0 1a5 5 0 1 1 0 10A5 5 0 0 1 8 3z"/>
        <path d="M8 5v3l2 1.5"/>
      </svg>
    ),
    log: (
      <svg viewBox="0 0 16 16" fill="currentColor">
        <path d="M2 2h12v12H2V2zm1 1v10h10V3H3z"/>
        <path d="M4 5h8M4 8h8M4 11h5"/>
      </svg>
    ),
    default: (
      <svg viewBox="0 0 16 16" fill="currentColor">
        <rect x="2" y="2" width="12" height="12" rx="1" fill="none" stroke="currentColor"/>
      </svg>
    ),
  };

  return <span className="tab-icon">{icons[icon] || icons['default']}</span>;
}
