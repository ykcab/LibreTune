import React, { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { IndicatorPanel } from '../types';

/// Renders an `IndicatorPanel` (grid of expression-driven lights). Re-evaluates
/// every indicator's expression whenever the channel `context` changes.
export function IndicatorPanelRenderer({
  panel,
  context,
}: {
  panel: IndicatorPanel;
  context: Record<string, number>;
}) {
  const [indicatorValues, setIndicatorValues] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const evaluations = panel.indicators.map((ind) =>
      invoke<boolean>('evaluate_expression', {
        expression: ind.expression,
        context,
      })
        .then((value) => ({ expression: ind.expression, value }))
        .catch(() => ({ expression: ind.expression, value: false }))
    );

    Promise.all(evaluations).then((results) => {
      const values: Record<string, boolean> = {};
      results.forEach(({ expression, value }) => {
        values[expression] = value;
      });
      setIndicatorValues(values);
    });
  }, [panel.indicators, context]);

  const columns = panel.columns || 2;
  const gridStyle: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: `repeat(${columns}, 1fr)`,
    gap: '8px',
  };

  return (
    <div className="indicator-panel">
      <div style={gridStyle}>
        {panel.indicators.map((ind, i) => {
          const isOn = indicatorValues[ind.expression] || false;
          const fgColor = isOn ? (ind.color_on_fg || 'red') : (ind.color_off_fg || 'white');
          const bgColor = isOn ? (ind.color_on_bg || 'black') : (ind.color_off_bg || 'black');

          return (
            <div key={i} className="indicator-field">
              <div
                className={`indicator-light ${isOn ? 'on' : 'off'}`}
                style={{
                  background: isOn ? fgColor : bgColor,
                  boxShadow: isOn ? `0 0 8px ${fgColor}` : 'none',
                }}
              />
              <span className="indicator-label" style={{ color: fgColor }}>
                {isOn ? ind.label_on : ind.label_off}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
