/**
 * Tiny flow-vs-boost trace for WMI readout panels. Kept deliberately small
 * so it can sit under the readout rows without taking over the dialog.
 */
import { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  getChannelHistoryBuffer,
  useChannels,
} from '../../../stores/realtimeStore';
import type { ChannelInfo } from '../../../types/app';

function boostToPsi(value: number | undefined, units?: string): number | undefined {
  if (value === undefined || Number.isNaN(value)) return undefined;
  if (units && /kpa/i.test(units)) return value * 0.145037763;
  return value;
}

export function WmiFlowBoostGraph() {
  const channels = useChannels(['boost', 'map', 'wmiEstimatedFlowGps']);
  const [unitMap, setUnitMap] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    invoke<ChannelInfo[]>('get_available_channels')
      .then((chs) => {
        if (cancelled) return;
        const map: Record<string, string> = {};
        for (const ch of chs) map[ch.name.toLowerCase()] = ch.units;
        setUnitMap(map);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const boostName = channels.boost !== undefined ? 'boost' : 'map';
  const boostUnit = unitMap[boostName];
  const currentBoostPsi = boostToPsi(
    channels.boost !== undefined ? channels.boost : channels.map,
    boostUnit,
  );
  const currentFlow = channels.wmiEstimatedFlowGps;

  const points = useMemo(() => {
    const boostHist = getChannelHistoryBuffer(boostName);
    const flowHist = getChannelHistoryBuffer('wmiEstimatedFlowGps');
    const n = Math.min(boostHist.length, flowHist.length, 90);
    if (n < 2) return [];
    const out: { x: number; y: number }[] = [];
    const boosts = boostHist.slice(-n);
    const flows = flowHist.slice(-n);
    for (let i = 0; i < n; i++) {
      const x = boostToPsi(boosts[i], boostUnit);
      const y = flows[i];
      if (x !== undefined && Number.isFinite(x) && Number.isFinite(y)) out.push({ x, y });
    }
    return out;
  }, [boostName, boostUnit, currentBoostPsi, currentFlow]);

  const path = useMemo(() => {
    if (points.length < 2) return '';
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const minX = Math.min(...xs, currentBoostPsi ?? Infinity);
    const maxX = Math.max(...xs, currentBoostPsi ?? -Infinity);
    const minY = Math.min(...ys, currentFlow ?? Infinity);
    const maxY = Math.max(...ys, currentFlow ?? -Infinity);
    const padX = Math.max(1, (maxX - minX) * 0.08);
    const padY = Math.max(1, (maxY - minY) * 0.08);
    const x0 = minX - padX;
    const x1 = maxX + padX;
    const y0 = Math.max(0, minY - padY);
    const y1 = maxY + padY;
    const W = 100;
    const H = 44;
    return points
      .map((p, i) => {
        const px = ((p.x - x0) / Math.max(1e-6, x1 - x0)) * W;
        const py = H - ((p.y - y0) / Math.max(1e-6, y1 - y0)) * H;
        return `${i === 0 ? 'M' : 'L'}${px.toFixed(1)},${py.toFixed(1)}`;
      })
      .join(' ');
  }, [points, currentBoostPsi, currentFlow]);

  const currentPoint = useMemo(() => {
    if (currentBoostPsi === undefined || currentFlow === undefined) return null;
    const all = points;
    if (all.length < 2) return null;
    const xs = all.map((p) => p.x);
    const ys = all.map((p) => p.y);
    const minX = Math.min(...xs, currentBoostPsi);
    const maxX = Math.max(...xs, currentBoostPsi);
    const minY = Math.min(...ys, currentFlow);
    const maxY = Math.max(...ys, currentFlow);
    const padX = Math.max(1, (maxX - minX) * 0.08);
    const padY = Math.max(1, (maxY - minY) * 0.08);
    const x0 = minX - padX;
    const x1 = maxX + padX;
    const y0 = Math.max(0, minY - padY);
    const y1 = maxY + padY;
    const px = ((currentBoostPsi - x0) / Math.max(1e-6, x1 - x0)) * 100;
    const py = 44 - ((currentFlow - y0) / Math.max(1e-6, y1 - y0)) * 44;
    return { x: px, y: py };
  }, [points, currentBoostPsi, currentFlow]);

  return (
    <div className="wmi-flow-graph" aria-label="WMI flow versus boost graph">
      <div className="wmi-flow-graph-head">
        <span>FLOW vs BOOST</span>
        <strong>
          {currentBoostPsi !== undefined && currentFlow !== undefined
            ? `${currentBoostPsi.toFixed(1)} psi → ${currentFlow.toFixed(0)} g/s`
            : 'no data'}
        </strong>
      </div>
      {path ? (
        <svg viewBox="0 0 100 44" preserveAspectRatio="none" role="img">
          <path d={path} fill="none" stroke="#b7ff00" strokeWidth="1.4" vectorEffect="non-scaling-stroke" />
          {currentPoint && <circle cx={currentPoint.x} cy={currentPoint.y} r="2.2" fill="#ff3cac" />}
        </svg>
      ) : (
        <div className="wmi-flow-graph-empty">connect to stream flow and boost</div>
      )}
    </div>
  );
}
