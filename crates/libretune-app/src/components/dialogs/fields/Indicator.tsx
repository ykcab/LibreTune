import { useEffect, useState } from 'react';
import { evaluateIniBoolean, expressionContextKey } from '../../../utils/iniExpression';
import { getConstantValues } from '../../../stores/constantValuesStore';
import type { DialogComponent } from '../types';

/// Renders a single boolean indicator (light + label) by evaluating
/// `comp.expression` against the supplied channel-value `context`.
export function Indicator({
  comp,
  context,
}: {
  comp: DialogComponent;
  context: Record<string, number>;
}) {
  const [isOn, setIsOn] = useState(false);

  const ctxKey = expressionContextKey(comp.expression, context);

  useEffect(() => {
    if (comp.expression) {
      setIsOn(evaluateIniBoolean(comp.expression, getConstantValues()));
    }
  }, [comp.expression, ctxKey]);

  return (
    <div className="indicator-field">
      <div className={`indicator-light ${isOn ? 'on' : 'off'}`} />
      <span className="indicator-label">{isOn ? comp.label_on : comp.label_off}</span>
    </div>
  );
}
