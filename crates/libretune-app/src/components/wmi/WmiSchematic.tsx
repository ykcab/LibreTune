import { formatNumber } from './wmiFormat';

export interface WmiSchematicProps {
  /** WMI master switch in the tune. */
  enabled: boolean;
  /** Pump is actually being driven (priming or active). */
  running: boolean;
  /** Any WMI guard has tripped. */
  fault: boolean;
  /** ECU is connected; when false, live values are unknown rather than zero. */
  isConnected: boolean;
  /** Commanded pump duty, %. */
  duty: number | undefined;
  /** PWM switching frequency, Hz. 0 or undefined = on/off control. */
  pwmFrequency?: number;
  /** A fluid level switch is configured in the tune. */
  fluidFitted: boolean;
  /** Fluid level switch state; undefined when no sensor is fitted or offline. */
  fluidOk: number | undefined;
  /** A Hall flow meter is configured. */
  flowMonitored: boolean;
  /** Measured flow, g/s. */
  measuredFlow: number | undefined;
  /** Calibrated nozzle flow, cc/min. */
  nozzleCc: number;
  /** Water/fuel ratio while spraying. */
  wf: number | undefined;
}

const FLOW = 'var(--wmi-flow)';
const FAULT = 'var(--wmi-danger)';
const IDLE = 'var(--wmi-line-strong)';

/**
 * Single-line fluid schematic for the WMI circuit.
 *
 * Only devices the ECU actually knows about are drawn: tank (level switch),
 * pump output, optional Hall flow meter and the nozzle. Nothing is invented
 * for hardware that is not fitted — absent sensors render as an empty stub,
 * and offline values read "NO DATA" rather than a fabricated zero.
 */
export function WmiSchematic({
  enabled,
  running,
  fault,
  isConnected,
  duty,
  pwmFrequency,
  fluidFitted,
  fluidOk,
  flowMonitored,
  measuredFlow,
  nozzleCc,
  wf,
}: WmiSchematicProps) {
  const pipe = fault ? FAULT : running ? FLOW : IDLE;
  const pipeWidth = running || fault ? 2.4 : 1.6;
  const levelOk = fluidOk !== undefined && fluidOk >= 0.5;
  const levelKnown = fluidFitted && isConnected && fluidOk !== undefined;

  const levelText = !fluidFitted
    ? 'NO LEVEL SENSOR'
    : !levelKnown
      ? 'NO DATA'
      : levelOk ? 'LEVEL OK' : 'LEVEL LOW';

  const pumpText = !enabled
    ? 'DISABLED'
    : !isConnected
      ? 'NO DATA'
      : pwmFrequency && pwmFrequency > 0
        ? `${formatNumber(duty, 0, ' %')} · ${pwmFrequency.toFixed(0)} Hz`
        : `${formatNumber(duty, 0, ' %')} · on/off`;

  const flowText = !flowMonitored
    ? 'NOT FITTED'
    : !isConnected
      ? 'NO DATA'
      : formatNumber(measuredFlow, 1, ' g/s');

  return (
    <div className="wmi-schem">
      <svg viewBox="0 0 620 260" role="img" aria-label="WMI fluid circuit">
        {/* ---- tank ---- */}
        <g className={!enabled ? 'is-off' : undefined}>
          <rect x="42" y="58" width="78" height="132" className="wmi-schem__vessel" />
          <rect x="44" y="60" width="74" height="128" className="wmi-schem__vessel-fill" />
          <line x1="42" y1="124" x2="120" y2="124" className="wmi-schem__tick" />
          <text x="81" y="50" className="wmi-schem__label" textAnchor="middle">TANK</text>
          <text
            x="81"
            y="205"
            className={`wmi-schem__sub${levelKnown && !levelOk ? ' is-fault' : ''}`}
            textAnchor="middle"
          >
            {levelText}
          </text>
        </g>

        {/* ---- tank -> pump ---- */}
        <path d="M120 170 H162" stroke={pipe} strokeWidth={pipeWidth} fill="none" />
        <path d="M162 170 V196 H182" stroke={pipe} strokeWidth={pipeWidth} fill="none" />

        {/* ---- pump ---- */}
        <g className={!enabled ? 'is-off' : undefined}>
          <circle
            cx="206"
            cy="196"
            r="24"
            className="wmi-schem__device"
            stroke={fault ? FAULT : running ? FLOW : IDLE}
          />
          <path
            d="M197 187 L219 196 L197 205 Z"
            fill={fault ? FAULT : running ? FLOW : IDLE}
            opacity={enabled ? 0.85 : 0.4}
          />
          <text x="206" y="240" className="wmi-schem__label" textAnchor="middle">PUMP</text>
          <text x="206" y="252" className="wmi-schem__sub" textAnchor="middle">
            {pumpText}
          </text>
        </g>

        {/* ---- pump -> meter ---- */}
        <path d="M230 196 H286" stroke={pipe} strokeWidth={pipeWidth} fill="none" />

        {/* ---- flow meter (optional) ---- */}
        {flowMonitored ? (
          <g>
            <circle
              cx="304"
              cy="196"
              r="16"
              className="wmi-schem__device"
              stroke={fault ? FAULT : running ? FLOW : IDLE}
            />
            <path d="M296 196 H312 M304 188 V204" stroke={running ? FLOW : IDLE} strokeWidth="1.1" />
            <text x="304" y="240" className="wmi-schem__label" textAnchor="middle">FLOW</text>
            <text x="304" y="252" className="wmi-schem__sub" textAnchor="middle">
              {flowText}
            </text>
          </g>
        ) : (
          <g>
            <circle cx="304" cy="196" r="16" className="wmi-schem__stub" />
            <text x="304" y="240" className="wmi-schem__label" textAnchor="middle">FLOW</text>
            <text x="304" y="252" className="wmi-schem__sub" textAnchor="middle">NOT FITTED</text>
          </g>
        )}

        {/* ---- meter -> nozzle ---- */}
        <path d="M320 196 H392 V150 H424" stroke={pipe} strokeWidth={pipeWidth} fill="none" />

        {/* ---- nozzle ---- */}
        <g className={!enabled ? 'is-off' : undefined}>
          <path
            d="M410 136 H438 L424 158 Z"
            className="wmi-schem__device-fill"
            stroke={running ? FLOW : IDLE}
          />
          <text x="424" y="128" className="wmi-schem__label" textAnchor="middle">NOZZLE</text>
          <text x="424" y="182" className="wmi-schem__sub" textAnchor="middle">
            {nozzleCc > 0 ? `${nozzleCc.toFixed(0)} cc/min` : 'NOT CALIBRATED'}
          </text>
        </g>

        {/* ---- intake ---- */}
        <path d="M360 168 H556" stroke="var(--wmi-line-strong)" strokeWidth="6" />
        <text x="520" y="186" className="wmi-schem__sub" textAnchor="middle">
          {wf !== undefined ? `W/F ${wf.toFixed(2)}` : 'INTAKE'}
        </text>

        {/* ---- level switch on tank ---- */}
        <rect x="126" y="96" width="10" height="16" className={fluidFitted ? 'wmi-schem__device' : 'wmi-schem__stub'} />
        <path d="M120 104 H126" stroke="var(--wmi-line-strong)" strokeWidth="1.2" />
        <text x="140" y="108" className="wmi-schem__sub">LEVEL SW</text>
      </svg>
    </div>
  );
}

export default WmiSchematic;
