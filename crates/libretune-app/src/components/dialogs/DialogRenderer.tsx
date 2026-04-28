import React, { useState, useEffect, useLayoutEffect, useRef, memo, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ArrowLeft, Activity, Grid3X3, AlertTriangle } from 'lucide-react';
import CurveEditor, { SimpleGaugeInfo } from '../curves/CurveEditor';
import TableEditor2D from '../tables/TableEditor2D';
import './DialogRenderer.css';
import {
  type DialogComponent,
  type DialogDefinition,
  type TableInfo,
  type BackendTableData,
  type CurveData,
  type FieldInfo,
  type IndicatorPanel,
  type PortEditorConfig,
  buildStdPlaceholderDefinition,
} from './types';
import { Indicator } from './fields/Indicator';
import { IndicatorPanelRenderer } from './fields/IndicatorPanelRenderer';
import { CommandButton } from './fields/CommandButton';

import DialogField from './fields/DialogField';


const RecursivePanel = memo(function RecursivePanel({
  name,
  openTable,
  context,
  onUpdate,
  onFieldFocus,
  showAllHelpIcons,
}: {
  name: string;
  openTable: (name: string) => void;
  context: Record<string, number>;
  onUpdate?: () => void;
  onFieldFocus?: (info: FieldInfo) => void;
  showAllHelpIcons?: boolean;
}) {
  // Debug log on every render
  console.log(`[RecursivePanel] 🎯 Component render for '${name}'`);
  
  const [definition, setDefinition] = useState<DialogDefinition | null>(null);
  const [indicatorPanel, setIndicatorPanel] = useState<IndicatorPanel | null>(null);
  const [tableInfo, setTableInfo] = useState<TableInfo | null>(null);
  const [tableData, setTableData] = useState<BackendTableData | null>(null);
  const [curveData, setCurveData] = useState<CurveData | null>(null);
  const [gaugeConfig, setGaugeConfig] = useState<SimpleGaugeInfo | null>(null);
  const [portEditor, setPortEditor] = useState<PortEditorConfig | null>(null);
  const [panelType, setPanelType] = useState<'loading' | 'dialog' | 'indicatorPanel' | 'table' | 'curve' | 'portEditor' | 'unknown'>('loading');

  // Log mount ID to track component identity
  const mountIdRef = useRef(Math.random().toString(36).substring(7));
  console.log(`[RecursivePanel] 🎯 Component render for '${name}' (mount: ${mountIdRef.current}, panelType: ${panelType}, curveData: ${curveData ? 'SET' : 'NULL'})`);

  // Use useLayoutEffect instead of useEffect to run synchronously
  // This prevents the effect from being skipped during rapid re-renders
  useLayoutEffect(() => {
    // Reset state when name changes and track cancellation
    let cancelled = false;
    
    console.error(`[RecursivePanel] ⚡⚡⚡ LAYOUT EFFECT FIRED for '${name}' (mount: ${mountIdRef.current})`);
    setPanelType('loading');
    setDefinition(null);
    setIndicatorPanel(null);
    setTableInfo(null);
    setTableData(null);
    setCurveData(null);
    setGaugeConfig(null);
    setPortEditor(null);

    const stdPlaceholder = buildStdPlaceholderDefinition(name);
    if (stdPlaceholder) {
      setDefinition(stdPlaceholder);
      setPanelType('dialog');
      return () => {
        cancelled = true;
      };
    }

    // First try as indicatorPanel
    invoke<IndicatorPanel>('get_indicator_panel', { name })
      .then((panel) => {
        if (cancelled) return;
        console.debug(`[RecursivePanel] '${name}' resolved as indicatorPanel`);
        setIndicatorPanel(panel);
        setPanelType('indicatorPanel');
      })
      .catch(() => {
        if (cancelled) return;
        // Not an indicatorPanel, try as dialog
        invoke<DialogDefinition>('get_dialog_definition', { name })
          .then((def) => {
            if (cancelled) return;
            console.debug(`[RecursivePanel] '${name}' resolved as dialog`);
            setDefinition(def);
            setPanelType('dialog');
          })
          .catch(() => {
            if (cancelled) return;
            // Not a dialog, try as table (lightweight check first, then full data)
            invoke<TableInfo>('get_table_info', { tableName: name })
              .then((info) => {
                if (cancelled) return;
                console.debug(`[RecursivePanel] '${name}' resolved as table: ${info.title}`);
                setTableInfo(info);
                // Now fetch full table data for embedded rendering
                invoke<BackendTableData>('get_table_data', { tableName: name })
                  .then((data) => {
                    if (cancelled) return;
                    setTableData(data);
                    setPanelType('table');
                  })
                  .catch((dataErr) => {
                    if (cancelled) return;
                    console.debug(`Could not load table data for '${name}':`, dataErr);
                    // Still show as table but without embedded view
                    setPanelType('table');
                  });
              })
              .catch((err) => {
                if (cancelled) return;
                console.debug(`Panel '${name}' is not a table:`, err);
                // Not a table, try as curve
                console.log(`[RecursivePanel] Trying to resolve '${name}' as curve...`);
                invoke<CurveData>('get_curve_data', { curveName: name })
                  .then((data) => {
                    if (cancelled) return;
                    console.log(`[RecursivePanel] ✅ '${name}' resolved as curve:`, {
                      name: data.name,
                      title: data.title,
                      x_bins: data.x_bins,
                      y_bins: data.y_bins,
                      x_bins_type: typeof data.x_bins,
                      y_bins_type: typeof data.y_bins,
                      x_bins_isArray: Array.isArray(data.x_bins),
                      rawData: JSON.stringify(data).slice(0, 500),
                    });
                    setCurveData(data);
                    setPanelType('curve');
                    // Fetch gauge config if curve has a gauge reference
                    if (data.gauge) {
                      invoke<SimpleGaugeInfo>('get_gauge_config', { gaugeName: data.gauge })
                        .then((gc) => { if (!cancelled) setGaugeConfig(gc); })
                        .catch((gaugeErr) => console.debug(`Could not load gauge ${data.gauge}:`, gaugeErr));
                    }
                  })
                  .catch((err2) => {
                    if (cancelled) return;
                    console.warn(`[RecursivePanel] ⚠️ Panel '${name}' is not a curve. Error:`, err2);
                    // Not a curve, try as portEditor
                    invoke<PortEditorConfig>('get_port_editor', { name })
                      .then((editor) => {
                        if (cancelled) return;
                        console.debug(`[RecursivePanel] '${name}' resolved as portEditor`);
                        setPortEditor(editor);
                        setPanelType('portEditor');
                      })
                      .catch((err3) => {
                        if (cancelled) return;
                        console.debug(`Panel '${name}' is not a portEditor:`, err3);
                        // None of the known types - log all errors for debugging
                        console.error(`[RecursivePanel] ❌ Panel '${name}' could not be resolved as any known type:`, {
                          indicatorPanel: 'not an indicatorPanel',
                          dialog: 'not a dialog',
                          table: String(err),
                          curve: String(err2),
                          portEditor: String(err3),
                        });
                        setPanelType('unknown');
                      });
                  });
              });
          });
      });

    // Cleanup function to prevent state updates after unmount
    return () => {
      cancelled = true;
    };
  }, [name]);

  if (panelType === 'loading') {
    return <div className="panel-loading">Loading {name}...</div>;
  }

  // Render as embedded table editor if we have full table data
  if (panelType === 'table' && tableInfo && tableData) {
    return (
      <TableEditor2D
        title={tableInfo.title || name}
        table_name={tableData.name}
        x_axis_name={tableData.x_axis_name || 'X'}
        y_axis_name={tableData.y_axis_name || 'Y'}
        x_bins={tableData.x_bins}
        y_bins={tableData.y_bins}
        z_values={tableData.z_values}
        x_output_channel={tableData.x_output_channel}
        y_output_channel={tableData.y_output_channel}
        embedded={true}
        onOpenInTab={() => openTable(name)}
        onValuesChange={(values) => {
          // Save changes to backend
          invoke('update_table_data', {
            table_name: tableData.name,
            z_values: values,
          }).then(() => {
            onUpdate?.();
          }).catch((err) => {
            console.error('Failed to update table:', err);
          });
        }}
      />
    );
  }

  // Fallback to clickable table link if we only have table info (no data)
  if (panelType === 'table' && tableInfo) {
    return (
      <div className="embedded-table-link" onClick={() => openTable(name)}>
        <Grid3X3 size={20} />
        <span>Open Table: {tableInfo.title || name}</span>
      </div>
    );
  }

  // Render as curve editor if it's a curve
  if (panelType === 'curve' && curveData) {
    const hasValidBins = curveData.x_bins?.length > 0 && curveData.y_bins?.length > 0;
    console.log(`[RecursivePanel] 📈 RENDERING CurveEditor for '${name}' with data:`, {
      name: curveData.name,
      title: curveData.title,
      x_bins_length: curveData.x_bins?.length ?? 0,
      y_bins_length: curveData.y_bins?.length ?? 0,
      hasValidBins,
      x_bins_sample: curveData.x_bins?.slice(0, 3),
      y_bins_sample: curveData.y_bins?.slice(0, 3),
    });
    if (!hasValidBins) {
      console.warn(`[RecursivePanel] ⚠️ Curve '${name}' has empty bins - curve may not render correctly. Check get_curve_data backend logs.`);
    }
    return (
      <CurveEditor
        data={curveData}
        embedded={true}
        simpleGaugeInfo={gaugeConfig}
        onValuesChange={(yBins) => {
          console.log('Curve values changed:', yBins);
          onUpdate?.();
        }}
      />
    );
  }

  // Render as indicatorPanel
  if (panelType === 'indicatorPanel' && indicatorPanel) {
    return <IndicatorPanelRenderer panel={indicatorPanel} context={context} />;
  }

  // Render as dialog
  if (panelType === 'dialog' && definition) {
    return (
      <div className="nested-panel">
        {definition.title && definition.title !== name && <div className="panel-title">{definition.title}</div>}
        <div className="panel-content">
          {definition.components.map((comp, i) => (
            <DialogComponentRenderer key={i} comp={comp} openTable={openTable} context={context} onUpdate={onUpdate} onFieldFocus={onFieldFocus} showAllHelpIcons={showAllHelpIcons} />
          ))}
        </div>
      </div>
    );
  }

  // Render as portEditor - placeholder for programmable outputs configuration
  if (panelType === 'portEditor' && portEditor) {
    return (
      <div className="embedded-port-editor">
        <div className="port-editor-title">{portEditor.label || name}</div>
        <div className="port-editor-placeholder">
          Programmable Output Configuration: {portEditor.name}
        </div>
      </div>
    );
  }

  // Unknown panel type - show error feedback so users can report missing panels
  return (
    <div className="panel-load-error">
      <span className="panel-error-icon"><AlertTriangle size={16} /></span>
      <span>Panel "{name}" could not be loaded</span>
    </div>
  );
});

function DialogFieldWrapper({ 
  comp, 
  context, 
  onUpdate,
  onOptimisticUpdate,
  onFieldFocus,
  showAllHelpIcons
}: { 
  comp: DialogComponent; 
  context: Record<string, number>; 
  onUpdate?: () => void;
  onOptimisticUpdate?: (name: string, value: number) => void;
  onFieldFocus?: (info: FieldInfo) => void;
  showAllHelpIcons?: boolean;
}) {
  const [fieldVisible, setFieldVisible] = useState<boolean>(true);
  const [fieldEnabled, setFieldEnabled] = useState<boolean>(true);
  
  // Evaluate visibility condition (hides field if false)
  useEffect(() => {
    const visCondition = comp.visibility_condition || (comp.condition && comp.enabled_condition ? undefined : comp.condition);
    if (visCondition) {
      invoke<boolean>('evaluate_expression', { 
        expression: visCondition, 
        context 
      })
        .then((result) => {
          console.log(`[DialogFieldWrapper] Visibility condition '${visCondition}' for '${comp.name}' evaluated to:`, result);
          setFieldVisible(result);
        })
        .catch((err) => {
          console.warn(`[DialogFieldWrapper] Failed to evaluate visibility condition '${visCondition}' for '${comp.name}':`, err);
          setFieldVisible(true); // Show on error
        });
    } else {
      setFieldVisible(true);
    }
  }, [comp.visibility_condition, comp.condition, comp.enabled_condition, context, comp.name]);
  
  // Evaluate enable condition (disables field if false)
  // Per closed-source program suggestion: "all 12 channels should be visible but disabled"
  useEffect(() => {
    const enCondition = comp.enabled_condition || (comp.condition && !comp.visibility_condition ? comp.condition : undefined);
    if (enCondition) {
      invoke<boolean>('evaluate_expression', { 
        expression: enCondition, 
        context 
      })
        .then((result) => {
          console.log(`[DialogFieldWrapper] Enable condition '${enCondition}' for '${comp.name}' evaluated to:`, result);
          setFieldEnabled(result);
        })
        .catch((err) => {
          console.warn(`[DialogFieldWrapper] Failed to evaluate enable condition '${enCondition}' for '${comp.name}':`, err);
          setFieldEnabled(true); // Enable on error
        });
    } else {
      setFieldEnabled(true);
    }
  }, [comp.enabled_condition, comp.condition, comp.visibility_condition, context, comp.name]);
  
  // Hide field if visibility condition is false
  if (!fieldVisible || !comp.name) return null;
  
  return <DialogField 
    label={comp.label || ''} 
    name={comp.name} 
    onUpdate={onUpdate} 
    context={context}
    fieldEnabledCondition={fieldEnabled}
    onOptimisticUpdate={onOptimisticUpdate}
    onFieldFocus={onFieldFocus}
    showAllHelpIcons={showAllHelpIcons}
  />;
}

function PanelVisibilityWrapper({
  comp,
  openTable,
  context,
  onUpdate,
  onFieldFocus,
  showAllHelpIcons,
}: {
  comp: DialogComponent;
  openTable: (name: string) => void;
  context: Record<string, number>;
  onUpdate?: () => void;
  onFieldFocus?: (info: FieldInfo) => void;
  showAllHelpIcons?: boolean;
}) {
  const [panelVisible, setPanelVisible] = useState<boolean>(true);
  
  // Log on every render to verify component is being rendered
  console.log(`[PanelVisibilityWrapper] Rendering for panel '${comp.name}', condition: '${comp.visibility_condition}', current visible state: ${panelVisible}`);
  
  // Use ref to track context without causing re-renders
  const contextRef = useRef(context);
  contextRef.current = context;
  
  const normalizedVisibilityExpression = useMemo(() => {
    if (!comp.visibility_condition) return '';
    let expression = comp.visibility_condition;
    if (!expression.includes('{') && !expression.includes('(') && !expression.includes(' ')) {
      expression = `{${expression}}`;
    }
    return expression;
  }, [comp.visibility_condition]);

  const visibilityContextKey = useMemo(() => {
    if (!normalizedVisibilityExpression) return '';
    const varMatches = normalizedVisibilityExpression.match(/\{?(\w+)\}?/g);
    if (!varMatches) return '';
    return varMatches
      .map(v => {
        const varName = v.replace(/[{}]/g, '');
        const value = contextRef.current[varName];
        return `${varName}:${value ?? 0}`;
      })
      .join('|');
  }, [normalizedVisibilityExpression, context]);

  useEffect(() => {
    if (normalizedVisibilityExpression) {
      // Log visibility condition evaluation for debugging
      console.log(`[PanelVisibilityWrapper] Evaluating visibility for '${comp.name}': original='${comp.visibility_condition}', parsed='${normalizedVisibilityExpression}'`);
      
      // Extract variable names from condition and log their values
      const varMatches = normalizedVisibilityExpression.match(/\{?(\w+)\}?/g);
      if (varMatches) {
        const varValues = varMatches.map(v => {
          const varName = v.replace(/[{}]/g, '');
          const value = contextRef.current[varName];
          return `${varName}=${value !== undefined ? value : 'undefined (defaults to 0)'}`;
        });
        console.log(`[PanelVisibilityWrapper] Context for '${comp.name}':`, varValues.join(', '));
      }
      
      invoke<boolean>('evaluate_expression', { 
        expression: normalizedVisibilityExpression, 
        context: contextRef.current 
      })
        .then((result) => {
          console.log(`[PanelVisibilityWrapper] '${comp.name}' visibility: ${normalizedVisibilityExpression} = ${result}`);
          setPanelVisible(result);
        })
        .catch((err) => {
          console.warn(`[PanelVisibilityWrapper] Failed to evaluate panel visibility condition '${normalizedVisibilityExpression}':`, err);
          setPanelVisible(true); // Show on error
        });
    } else {
      setPanelVisible(true);
    }
  }, [comp.visibility_condition, comp.name, normalizedVisibilityExpression, visibilityContextKey]);
  
  if (!panelVisible || !comp.name) {
    console.log(`[PanelVisibilityWrapper] Skipping render for '${comp.name}': panelVisible=${panelVisible}, comp.name=${comp.name}`);
    return null;
  }
  
  console.log(`[PanelVisibilityWrapper] ✅ About to render RecursivePanel for '${comp.name}'`);
  return <RecursivePanel key={`panel-${comp.name}`} name={comp.name} openTable={openTable} context={context} onUpdate={onUpdate} onFieldFocus={onFieldFocus} showAllHelpIcons={showAllHelpIcons} />;
}

function DialogComponentRenderer({
  comp,
  openTable,
  context,
  onUpdate,
  onOptimisticUpdate,
  onFieldFocus,
  showAllHelpIcons,
}: {
  comp: DialogComponent;
  openTable: (name: string) => void;
  context: Record<string, number>;
  onUpdate?: () => void;
  onOptimisticUpdate?: (name: string, value: number) => void;
  onFieldFocus?: (info: FieldInfo) => void;
  showAllHelpIcons?: boolean;
}) {
  if (comp.type === 'Field' && comp.name) {
    return <DialogFieldWrapper comp={comp} context={context} onUpdate={onUpdate} onOptimisticUpdate={onOptimisticUpdate} onFieldFocus={onFieldFocus} showAllHelpIcons={showAllHelpIcons} />;
  }
  if (comp.type === 'Label' && comp.text) {
    return <div className="dialog-label">{comp.text}</div>;
  }
  if (comp.type === 'Table' && comp.name) {
    // Use RecursivePanel to handle table rendering (embedded or link fallback)
    return <RecursivePanel name={comp.name} openTable={openTable} context={context} onUpdate={onUpdate} />;
  }
  if (comp.type === 'LiveGraph') {
    return (
      <div className="embedded-graph-placeholder">
        <Activity size={20} />
        <span>Live Graph: {comp.title || comp.name}</span>
      </div>
    );
  }
  if (comp.type === 'Panel' && comp.name) {
    console.log(`[DialogComponentRenderer] Rendering Panel component: ${comp.name}, visibility_condition: ${comp.visibility_condition || 'none'}`);
    return <PanelVisibilityWrapper comp={comp} openTable={openTable} context={context} onUpdate={onUpdate} onFieldFocus={onFieldFocus} showAllHelpIcons={showAllHelpIcons} />;
  }
  if (comp.type === 'Indicator') {
    return <Indicator comp={comp} context={context} />;
  }
  if (comp.type === 'CommandButton' && comp.command) {
    return <CommandButton comp={comp} context={context} />;
  }
  return null;
}

export interface DialogRendererProps {
  definition: DialogDefinition;
  onBack: () => void;
  openTable: (name: string) => void;
  context: Record<string, number>;
  onUpdate?: () => void;
  onOptimisticUpdate?: (name: string, value: number) => void;
  /** Override title for display (formatted as "Menu Label (ini_name)") */
  displayTitle?: string;
  /** Search term to highlight matching fields (scroll into view and flash animation) */
  highlightTerm?: string;
}

export default function DialogRenderer({ definition, onBack, openTable, context, onUpdate, onOptimisticUpdate, displayTitle, highlightTerm }: DialogRendererProps) {
  // The context is already dynamic - it contains the current values of all constants
  // Conditions like {cylindersCount > 5} will automatically evaluate based on the current cylindersCount value
  // This works for any cylinder count: 1, 2, 3, 4, 5, 6, 7, 8, 10, 12, etc.
  
  // State for showing field description in bottom panel
  const [selectedField, setSelectedField] = useState<FieldInfo | null>(null);
  
  // State for help icon visibility setting (default true = show on all fields)
  const [showAllHelpIcons, setShowAllHelpIcons] = useState(true);
  
  // Ref for scrolling to highlighted field
  const containerRef = useRef<HTMLDivElement>(null);
  
  // Fetch the help icon visibility setting on mount
  useEffect(() => {
    invoke<{ show_all_help_icons?: boolean }>("get_settings")
      .then((settings) => {
        if (settings.show_all_help_icons !== undefined) {
          setShowAllHelpIcons(settings.show_all_help_icons);
        }
      })
      .catch(console.error);
  }, []);

  
  // Scroll to and highlight matching field when highlightTerm is provided
  useEffect(() => {
    if (!highlightTerm || !containerRef.current) return;
    
    // Wait for DOM to render
    const timer = setTimeout(() => {
      const container = containerRef.current;
      if (!container) return;
      
      // Find field labels that match the search term
      const lowerTerm = highlightTerm.toLowerCase();
      const labels = container.querySelectorAll('.dialog-field label, .dialog-field-label');
      
      for (const label of labels) {
        if (label.textContent?.toLowerCase().includes(lowerTerm)) {
          // Found a matching label - scroll to its parent field row
          const fieldRow = label.closest('.dialog-field') || label.closest('.dialog-row');
          if (fieldRow) {
            fieldRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
            // Add flash animation class
            fieldRow.classList.add('search-highlight-flash');
            // Remove class after animation
            setTimeout(() => {
              fieldRow.classList.remove('search-highlight-flash');
            }, 2000);
            break;
          }
        }
      }
    }, 100);
    
    return () => clearTimeout(timer);
  }, [highlightTerm, definition.name]);
  
  const handleFieldFocus = (info: FieldInfo) => {
    setSelectedField(info);
  };
  
  // Log all components for debugging
  useEffect(() => {
    console.log(`[DialogRenderer] Rendering dialog '${definition.name}' with ${definition.components.length} components:`);
    definition.components.forEach((comp, i) => {
      console.log(`  [${i}] type=${comp.type}, name=${comp.name || 'N/A'}, position=${comp.position || 'none'}, visibility=${comp.visibility_condition || 'none'}`);
    });
  }, [definition]);
  
  // Group components by position for multi-column layout
  const organizeComponents = () => {
    const rows: { west: DialogComponent[], east: DialogComponent[], unpositioned: DialogComponent[] }[] = [];
    let currentRow: { west: DialogComponent[], east: DialogComponent[], unpositioned: DialogComponent[] } | null = null;
    
    for (const comp of definition.components) {
      const position = comp.position?.toLowerCase();
      
      if (position === 'west' || position === 'east') {
        // Start a new row if we don't have one or if current row already has items in this position
        if (!currentRow || (position === 'west' && currentRow.west.length > 0) || (position === 'east' && currentRow.east.length > 0)) {
          currentRow = { west: [], east: [], unpositioned: [] };
          rows.push(currentRow);
        }
        
        if (position === 'west') {
          currentRow.west.push(comp);
        } else {
          currentRow.east.push(comp);
        }
      } else {
        // Unpositioned components - add to unpositioned array
        if (!currentRow) {
          currentRow = { west: [], east: [], unpositioned: [] };
          rows.push(currentRow);
        }
        currentRow.unpositioned.push(comp);
      }
    }
    
    return rows;
  };
  
  const componentRows = useMemo(() => organizeComponents(), [definition.components]);
  
  return (
    <div className="dialog-view view-transition">
      <div className="editor-header">
        <button onClick={onBack} className="icon-btn" title="Back">
          <ArrowLeft size={20} />
        </button>
        <h2 className="content-title" style={{ margin: 0 }}>
          {displayTitle || definition.title}
        </h2>
      </div>

      <div className="glass-card dialog-container" ref={containerRef}>
        {componentRows.map((row, rowIndex) => {
          const hasPositioned = row.west.length > 0 || row.east.length > 0;
          
          if (!hasPositioned) {
            // No positioned components - render unpositioned components normally
            return (
              <React.Fragment key={`row-${rowIndex}`}>
                {row.unpositioned.map((comp, i) => (
                  <DialogComponentRenderer 
                    key={`unpositioned-${rowIndex}-${i}`} 
                    comp={comp} 
                    openTable={openTable} 
                    context={context} 
                    onUpdate={onUpdate} 
                    onOptimisticUpdate={onOptimisticUpdate} 
                    onFieldFocus={handleFieldFocus} 
                    showAllHelpIcons={showAllHelpIcons} 
                  />
                ))}
              </React.Fragment>
            );
          }
          
          // Has positioned components - use grid layout
          return (
            <React.Fragment key={`row-${rowIndex}`}>
              {row.unpositioned.map((comp, i) => (
                <DialogComponentRenderer 
                  key={`pre-${rowIndex}-${i}`} 
                  comp={comp} 
                  openTable={openTable} 
                  context={context} 
                  onUpdate={onUpdate} 
                  onOptimisticUpdate={onOptimisticUpdate} 
                  onFieldFocus={handleFieldFocus} 
                  showAllHelpIcons={showAllHelpIcons} 
                />
              ))}
              <div className="dialog-row-container">
                {row.west.length > 0 && (
                  <div className="dialog-column">
                    {row.west.map((comp, i) => (
                      <DialogComponentRenderer 
                        key={`west-${rowIndex}-${i}`} 
                        comp={comp} 
                        openTable={openTable} 
                        context={context} 
                        onUpdate={onUpdate} 
                        onOptimisticUpdate={onOptimisticUpdate} 
                        onFieldFocus={handleFieldFocus} 
                        showAllHelpIcons={showAllHelpIcons} 
                      />
                    ))}
                  </div>
                )}
                {row.east.length > 0 && (
                  <div className="dialog-column">
                    {row.east.map((comp, i) => (
                      <DialogComponentRenderer 
                        key={`east-${rowIndex}-${i}`} 
                        comp={comp} 
                        openTable={openTable} 
                        context={context} 
                        onUpdate={onUpdate} 
                        onOptimisticUpdate={onOptimisticUpdate} 
                        onFieldFocus={handleFieldFocus} 
                        showAllHelpIcons={showAllHelpIcons} 
                      />
                    ))}
                  </div>
                )}
              </div>
            </React.Fragment>
          );
        })}
      </div>
      
      <div className="dialog-description-panel">
        {selectedField ? (
          <>
            <strong>{selectedField.label}</strong>
            <p>{selectedField.help || 'No description available for this setting.'}</p>
          </>
        ) : (
          <p className="description-placeholder">Click the ? icon next to any setting to see its description</p>
        )}
      </div>
    </div>
  );
}

// Export types for use in App.tsx
export type { DialogDefinition, DialogComponent };
