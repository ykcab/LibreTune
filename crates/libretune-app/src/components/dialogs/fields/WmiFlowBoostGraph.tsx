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

  const domain = useMemo(() => {
    if (points.length === 0) return null;
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    let xMin = Math.min(...xs);
    let xMax = Math.max(...xs);
    let yMin = Math.min(...ys);
    let yMax = Math.max(...ys);
    if (currentBoostPsi !== undefined) {
      xMin = Math.min(xMin, currentBoostPsi);
      xMax = Math.max(xMax, currentBoostPsi);
    }
    if (currentFlow !== undefined) {
      yMin = Math.min(yMin, currentFlow);
      yMax = Math.max(yMax, currentFlow);
    }
    const padX = Math.max(1, (xMax - xMin) * 0.08);
    const padY = Math.max(1, (yMax - yMin) * 0.08);
    return {
      x0: xMin - padX,
      x1: xMax + padX,
      y0: Math.max(0, yMin - padY),
      y1: yMax + padY,
    };
  }, [points, currentBoostPsi, currentFlow]);

  const path = useMemo(() => {
    if (!domain || points.length < 2) return '';
    const W = 100;
    const H = 44;
    return points
      .map((p, i) => {
        const px = ((p.x - domain.x0) / Math.max(1e-6, domain.x1 - domain.x0)) * W;
        const py = H - ((p.y - domain.y0) / Math.max(1e-6, domain.y1 - domain.y0)) * H;
        return `${i === 0 ? 'M' : 'L'}${px.toFixed(1)},${py.toFixed(1)}`;
      })
      .join(' ');
  }, [domain, points]);

  const currentPoint = useMemo(() => {
    if (!domain || currentBoostPsi === undefined || currentFlow === undefined) return null;
    const px = ((currentBoostPsi - domain.x0) / Math.max(1e-6, domain.x1 - domain.x0)) * 100;
    const py = 44 - ((currentFlow - domain.y0) / Math.max(1e-6, domain.y1 - domain.y0)) * 44;
    return { x: px, y: py };
  }, [domain, currentBoostPsi, currentFlow]);

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
          <line x1="0" y1="22" x2="100" y2="22" stroke="rgba(232,234,240,0.08)" strokeWidth="0.5" />
          <path d={path} fill="none" stroke="#b7ff00" strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
          {currentPoint && <circle cx={currentPoint.x} cy={currentPoint.y} r="2.4" fill="#ff3cac" />}
        </svg>
      ) : (
        <div className="wmi-flow-graph-empty">connect to stream flow and boost</div>
      )}
      <div className="wmi-flow-graph-axis">
        <span>boost psi</span>
        <span>flow g/s</span>
      </div>
    </div>
  );
}
