import React, { useEffect, useMemo, useState } from 'react';
import { evaluateIniBoolean, expressionContextKey } from '../../../utils/iniExpression';
import { getConstantValues } from '../../../stores/constantValuesStore';
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
  const indicators = panel.indicators ?? [];
  const [indicatorValues, setIndicatorValues] = useState<Record<string, boolean>>({});

  const ctxKey = useMemo(
    () => indicators.map((ind) => expressionContextKey(ind.expression, context)).join(';'),
    [indicators, context],
  );

  useEffect(() => {
    const values: Record<string, boolean> = {};
    const ctx = getConstantValues();
    for (const ind of indicators) {
      values[ind.expression] = evaluateIniBoolean(ind.expression, ctx);
    }
    setIndicatorValues(values);
  }, [indicators, ctxKey]);

  if (indicators.length === 0) {
    return (
      <div className="panel-loading">{panel.name ? `${panel.name}: no indicators` : 'No indicators'}</div>
    );
  }

  const columns = Math.max(1, panel.columns || 2);
  const gridStyle: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: `repeat(${columns}, 1fr)`,
    gap: '8px',
  };

  return (
    <div className="indicator-panel">
      <div style={gridStyle}>
        {indicators.map((ind, i) => {
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
