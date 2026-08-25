import { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ArrowLeft } from 'lucide-react';
import './DialogRenderer.css';
import {
  type DialogDefinition,
  type DialogComponent,
  type FieldInfo,
} from './types';
import { DialogComponentsLayout } from './DialogComponentsLayout';

function panelGateExpression(comp: DialogComponent): string | null {
  if (comp.type !== 'Panel') return null;
  return comp.visibility_condition || comp.enabled_condition || null;
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
  const [isDialogEmpty, setIsDialogEmpty] = useState(false);
  const [hiddenPanelHints, setHiddenPanelHints] = useState<string[]>([]);
  
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

  
  // Scroll to and highlight matching field when highlightTerm is provided.
  // Two delays, both chosen empirically:
  //   - 100ms outer: wait for the dialog DOM to finish rendering after the
  //     highlight term is set, otherwise querySelector can't find the field.
  //   - 2000ms inner: how long the search-highlight-flash CSS animation runs
  //     before the class is removed (matches the CSS keyframe duration).
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

  // Some INI dialogs are composed only of conditional panels. When all
  // conditions evaluate false, the content area appears blank; show a clear
  // empty-state hint instead of a silent black panel.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const contentSelector = [
      '.dialog-field',
      '.nested-panel',
      '.panel-loading',
      '.embedded-table-link',
      '.embedded-table',
      '.embedded-port-editor',
      '.runtime-value-readout',
      '.dialog-label',
      '.command-button',
      '.dialog-indicator',
      '.indicator-panel',
      '.readout-panel',
      '.dialog-gauge-stack',
    ].join(', ');

    let cancelled = false;

    const refresh = async () => {
      const hasContent = container.querySelector(contentSelector) !== null;
      setIsDialogEmpty(!hasContent);
      if (hasContent) {
        setHiddenPanelHints([]);
        return;
      }

      const gatedPanels = definition.components.filter(
        (c) => c.type === 'Panel' && panelGateExpression(c),
      );
      const hints: string[] = [];
      for (const panel of gatedPanels) {
        const expr = panelGateExpression(panel);
        if (!expr) continue;
        try {
          const visible = await invoke<boolean>('evaluate_expression', {
            expression: expr,
            context,
          });
          if (!visible) {
            const vars = Array.from(
              expr.matchAll(/\b([A-Za-z_]\w*)\b/g),
              (m) => m[1],
            ).filter((v) => !['and', 'or', 'not'].includes(v.toLowerCase()));
            const uniqueVars = [...new Set(vars)];
            const values = uniqueVars
              .map((v) => `${v}=${context[v] ?? 0}`)
              .join(', ');
            hints.push(
              `${panel.name ?? 'panel'} needs {${expr}}${values ? ` (now ${values})` : ''}`,
            );
          }
        } catch {
          // ignore eval errors for the hint list
        }
      }
      if (!cancelled) setHiddenPanelHints(hints);
    };

    void refresh();
    const obs = new MutationObserver(() => {
      void refresh();
    });
    obs.observe(container, { childList: true, subtree: true });
    return () => {
      cancelled = true;
      obs.disconnect();
    };
  }, [definition.name, definition.components, context]);
  
  const handleFieldFocus = (info: FieldInfo) => {
    setSelectedField(info);
  };
  
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
        <DialogComponentsLayout
          dialogName={definition.name}
          components={definition.components}
          openTable={openTable}
          context={context}
          onUpdate={onUpdate}
          onOptimisticUpdate={onOptimisticUpdate}
          onFieldFocus={handleFieldFocus}
          showAllHelpIcons={showAllHelpIcons}
          layoutHint={definition.layout_hint}
        />
        {isDialogEmpty ? (
          <div className="dialog-empty-state">
            <p>
              No settings are currently visible for this dialog. Panels are
              hidden by INI conditions based on your current tune.
            </p>
            {hiddenPanelHints.length > 0 ? (
              <ul className="dialog-empty-state-list">
                {hiddenPanelHints.map((hint) => (
                  <li key={hint}>{hint}</li>
                ))}
              </ul>
            ) : null}
            {definition.name.toLowerCase().includes('trigger') ? (
              <p>
                For Trigger, rusEFI/epicEFI only show these panels when{' '}
                <code>consumeObdSensors == 0</code>. If that setting is on
                (CAN/OBD consumer mode), open the CAN/OBD dialog and turn it
                off — then Trigger settings return.
              </p>
            ) : null}
          </div>
        ) : null}
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
export type { DialogDefinition };
export type { DialogComponent } from './types';
