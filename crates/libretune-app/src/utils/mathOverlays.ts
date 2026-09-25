/**
 * Math overlay plumbing for strip charts.
 *
 * Overlays are project math channels evaluated over recorded rows by the
 * `evaluate_math_series` backend command. Results come back per overlay as
 * nullable series and are injected here as synthetic `math:<name>` channels,
 * which GraphLog slots accept like any other channel. Nulls become gaps:
 * the key is simply left out, which the pane painters skip.
 */
export const MATH_OVERLAY_PREFIX = 'math:';

export function overlayChannelName(name: string): string {
  return `${MATH_OVERLAY_PREFIX}${name}`;
}

export type MathSeriesMap = Record<string, Array<number | null>>;

export interface OverlaySampleRow {
  t: number;
  values: Record<string, number>;
}

/** Merge evaluated overlay series into a copy of the rows.
 *  Returns the merged rows plus the injected overlay channel names. Pure. */
export function applyMathOverlays<S extends OverlaySampleRow>(
  samples: S[],
  series: MathSeriesMap,
): { samples: S[]; channels: string[] } {
  const channels: string[] = [];
  const merged = samples.map((row) => ({ ...row, values: { ...row.values } }));
  for (const [name, values] of Object.entries(series)) {
    const key = overlayChannelName(name);
    channels.push(key);
    for (let i = 0; i < merged.length && i < values.length; i++) {
      const v = values[i];
      if (v !== null && v !== undefined && Number.isFinite(v)) {
        merged[i].values[key] = v;
      }
    }
  }
  return { samples: merged, channels };
}
