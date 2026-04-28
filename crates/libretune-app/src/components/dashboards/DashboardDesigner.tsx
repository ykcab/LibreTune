/**
 * Dashboard Designer Mode
 * 
 * Provides interactive editing capabilities for dashboard layouts:
 * - Drag gauges to reposition
 * - Resize handles on corners and edges
 * - Property editor panel for gauge configuration
 * - Snap-to-grid alignment
 * - Multi-select with shift-click
 * - Copy/paste gauges
 * - Undo/redo support
 */

import { useCallback, useRef } from 'react';
import { DashFile, isGauge, isIndicator } from './dashTypes';
import PropertyEditor from './designer/PropertyEditor';
import DesignerToolbar from './designer/DesignerToolbar';
import DesignerCanvas from './designer/DesignerCanvas';
import { useDesignerHistory } from './designer/useDesignerHistory';
import { useDesignerDragResize } from './designer/useDesignerDragResize';
import { useDesignerKeyboard } from './designer/useDesignerKeyboard';
import { useDesignerDrop } from './designer/useDesignerDrop';
import './DashboardDesigner.css';

interface ChannelInfo {
  name: string;
  label?: string | null;
  units: string;
  scale: number;
  translate: number;
}

interface DashboardDesignerProps {
  dashFile: DashFile;
  onDashFileChange: (file: DashFile) => void;
  selectedGaugeId: string | null;
  onSelectGauge: (id: string | null) => void;
  onContextMenu: (e: React.MouseEvent, gaugeId: string | null) => void;
  gridSnap: number; // Grid snap size in percentage (e.g., 5 = 5%)
  onGridSnapChange: (snap: number) => void;
  showGrid: boolean;
  onShowGridChange: (show: boolean) => void;
  onSave: () => void;
  onExit: () => void;
  channelInfoMap?: Record<string, ChannelInfo>; // INI channel metadata for gauge creation
}




export default function DashboardDesigner({
  dashFile,
  onDashFileChange,
  selectedGaugeId,
  onSelectGauge,
  onContextMenu,
  gridSnap,
  onGridSnapChange,
  showGrid,
  onShowGridChange,
  onSave,
  onExit,
  channelInfoMap = {},
}: DashboardDesignerProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Undo/redo + clipboard + delete + selected component (extracted hook).
  const {
    selectedComponent,
    pushHistory,
    undo: handleUndo,
    redo: handleRedo,
    remove: handleDelete,
    copy: handleCopy,
    paste: handlePaste,
    canUndo,
    canRedo,
    hasClipboard,
  } = useDesignerHistory({ dashFile, selectedGaugeId, onDashFileChange, onSelectGauge });

  // Snap value to grid
  const snapToGrid = useCallback((value: number): number => {
    if (gridSnap <= 0) return value;
    return Math.round(value / (gridSnap / 100)) * (gridSnap / 100);
  }, [gridSnap]);

  // Drag/resize interactions extracted into a hook.
  const {
    dragState,
    resizeState,
    onGaugeMouseDown: handleGaugeMouseDown,
    onResizeMouseDown: handleResizeMouseDown,
  } = useDesignerDragResize({
    dashFile,
    containerRef,
    snapToGrid,
    pushHistory,
    onDashFileChange,
    onSelectGauge,
  });

  // Keyboard shortcuts
  const handleDeselect = useCallback(() => onSelectGauge(null), [onSelectGauge]);
  useDesignerKeyboard({
    onDelete: handleDelete,
    onUndo: handleUndo,
    onRedo: handleRedo,
    onCopy: handleCopy,
    onPaste: handlePaste,
    onSave,
    onDeselect: handleDeselect,
  });

  // Drag-and-drop channel-to-canvas
  const { onDragOver: handleDragOver, onDragLeave: handleDragLeave, onDrop: handleDrop } = useDesignerDrop({
    dashFile,
    gridSnap,
    snapToGrid,
    channelInfoMap,
    pushHistory,
    onDashFileChange,
  });

  return (
    <div className="dashboard-designer">
      <DesignerToolbar
        canUndo={canUndo}
        canRedo={canRedo}
        hasClipboard={hasClipboard}
        hasSelection={!!selectedGaugeId}
        showGrid={showGrid}
        gridSnap={gridSnap}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onCopy={handleCopy}
        onPaste={handlePaste}
        onDelete={handleDelete}
        onShowGridChange={onShowGridChange}
        onGridSnapChange={onGridSnapChange}
        onSave={onSave}
        onExit={onExit}
      />

      {/* Main designer area */}
      <div className="designer-content">
        <DesignerCanvas
          containerRef={containerRef}
          dashFile={dashFile}
          showGrid={showGrid}
          gridSnap={gridSnap}
          selectedGaugeId={selectedGaugeId}
          dragState={dragState}
          resizeState={resizeState}
          onSelectGauge={onSelectGauge}
          onContextMenu={onContextMenu}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onGaugeMouseDown={handleGaugeMouseDown}
          onResizeMouseDown={handleResizeMouseDown}
        />

        {/* Property editor panel */}
        <div className="designer-properties">
          <h3>Properties</h3>
          {selectedComponent ? (
            <PropertyEditor
              component={selectedComponent}
              onChange={(updated) => {
                const newComponents = dashFile.gauge_cluster.components.map(c => {
                  if (isGauge(c) && isGauge(updated) && c.Gauge.id === updated.Gauge.id) {
                    return updated;
                  }
                  if (isIndicator(c) && isIndicator(updated) && c.Indicator.id === updated.Indicator.id) {
                    return updated;
                  }
                  return c;
                });
                
                const newFile = {
                  ...dashFile,
                  gauge_cluster: { ...dashFile.gauge_cluster, components: newComponents },
                };
                pushHistory(newFile, 'Edit property');
                onDashFileChange(newFile);
              }}
            />
          ) : (
            <p className="no-selection">Select a gauge to edit its properties</p>
          )}
        </div>
      </div>
    </div>
  );
}
