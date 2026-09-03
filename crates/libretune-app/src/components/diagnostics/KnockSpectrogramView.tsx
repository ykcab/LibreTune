/**
 * Knock Spectrogram — live rusEFI-family FFT view (no TunerStudio plugin).
 *
 * Reads packed OCH fields m_knockSpectrum1..16 and draws a scrolling heat map.
 * Start/Stop writes enableKnockSpectrogram on the ECU.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Activity, Play, Square, X } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useChannels } from "../../stores/realtimeStore";
import {
  amplitudeColor,
  frameFromOch,
  frequencyHz,
  KNOCK_SPECTRUM_CHANNELS,
  peakBin,
  SPECTRUM_BIN_COUNT,
  type KnockSpectrumFrame,
} from "../../utils/knockSpectrum";
import "./KnockSpectrogramView.css";

const MAX_COLUMNS = 480;

interface Props {
  onClose?: () => void;
  isConnected?: boolean;
  /** Compact chrome for embedding under Live Telemetry. */
  embedded?: boolean;
  /**
   * When set (Live Telemetry toolbar), auto start/stop firmware streaming
   * and hide the Start/Stop chrome — parent owns enable/disable.
   */
  active?: boolean;
}

export const KnockSpectrogramView: React.FC<Props> = ({
  onClose,
  isConnected = false,
  embedded = false,
  active,
}) => {
  const live = useChannels(KNOCK_SPECTRUM_CHANNELS);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<KnockSpectrumFrame[]>([]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const magRef = useRef<HTMLCanvasElement>(null);
  const lastSig = useRef<string>("");
  const controlled = active !== undefined;

  const frame = useMemo(() => frameFromOch(live), [live]);

  useEffect(() => {
    if (!enabled || !frame) return;
    // Skip identical packed snapshots so a stalled OCH doesn't flood history.
    const sig = KNOCK_SPECTRUM_CHANNELS.slice(0, 16)
      .map((n) => live[n] ?? 0)
      .join(",");
    if (sig === lastSig.current) return;
    lastSig.current = sig;
    setHistory((prev) => {
      const next = prev.concat(frame);
      return next.length > MAX_COLUMNS ? next.slice(-MAX_COLUMNS) : next;
    });
  }, [enabled, frame, live]);

  const setSpectrogramEnabled = useCallback(async (on: boolean) => {
    setBusy(true);
    setError(null);
    try {
      await invoke("update_constant", { name: "enableKnockSpectrogram", value: on ? 1 : 0 });
      setEnabled(on);
      if (on) {
        setHistory([]);
        lastSig.current = "";
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  // Toolbar-driven: mount = stream on, unmount/active=false = stream off.
  useEffect(() => {
    if (!controlled) return;
    if (active) {
      void setSpectrogramEnabled(true);
    } else {
      void setSpectrogramEnabled(false);
    }
  }, [controlled, active, setSpectrogramEnabled]);

  useEffect(() => {
    if (!controlled) return;
    return () => {
      invoke("update_constant", { name: "enableKnockSpectrogram", value: 0 }).catch(() => {});
    };
  }, [controlled]);

  // Spectrogram heat map: x = time (columns), y = frequency bins (low → high upward)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth || 640;
    const cssH = canvas.clientHeight || 280;
    canvas.width = Math.floor(cssW * dpr);
    canvas.height = Math.floor(cssH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#0a0e14";
    ctx.fillRect(0, 0, cssW, cssH);

    if (history.length === 0) {
      if (!embedded) {
        ctx.fillStyle = "rgba(255,255,255,0.35)";
        ctx.font = "13px sans-serif";
        ctx.fillText(
          enabled
            ? "Waiting for knock spectrum OCH…"
            : "Press Start to enable firmware spectrogram streaming",
          16,
          cssH / 2,
        );
      }
      return;
    }

    const colW = cssW / Math.max(history.length, 1);
    const rowH = cssH / SPECTRUM_BIN_COUNT;
    for (let x = 0; x < history.length; x++) {
      const bins = history[x]!.bins;
      for (let b = 0; b < SPECTRUM_BIN_COUNT; b++) {
        // Low frequency at bottom
        const y = cssH - (b + 1) * rowH;
        ctx.fillStyle = amplitudeColor(bins[b]!);
        ctx.fillRect(x * colW, y, Math.ceil(colW) + 0.5, Math.ceil(rowH) + 0.5);
      }
    }

    const latest = history[history.length - 1]!;
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.font = "11px monospace";
    ctx.fillText(`${latest.freqStartHz.toFixed(0)} Hz`, 6, cssH - 6);
    const topHz = frequencyHz(latest, SPECTRUM_BIN_COUNT - 1);
    ctx.fillText(`${topHz.toFixed(0)} Hz`, 6, 14);
  }, [history, enabled, embedded]);

  // Current-frame magnitude strip
  useEffect(() => {
    const canvas = magRef.current;
    if (!canvas || !frame) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth || 640;
    const cssH = canvas.clientHeight || 72;
    canvas.width = Math.floor(cssW * dpr);
    canvas.height = Math.floor(cssH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#0a0e14";
    ctx.fillRect(0, 0, cssW, cssH);

    const barW = cssW / SPECTRUM_BIN_COUNT;
    for (let b = 0; b < SPECTRUM_BIN_COUNT; b++) {
      const v = frame.bins[b]! / 255;
      const h = Math.max(1, v * (cssH - 4));
      ctx.fillStyle = amplitudeColor(frame.bins[b]!);
      ctx.fillRect(b * barW, cssH - h, Math.ceil(barW) - 0.5, h);
    }
  }, [frame]);

  const peak = frame ? peakBin(frame) : null;
  const peakHz = frame && peak ? frequencyHz(frame, peak.index) : null;

  return (
    <div className={`knock-spectrogram-view${embedded ? " embedded" : ""}`}>
      {!controlled && (
        <div className="knock-spectrogram-header">
          <div className="knock-spectrogram-title">
            <Activity size={embedded ? 14 : 18} />
            <h2>{embedded ? "Knock Sensing · Spectrogram" : "Knock Spectrogram"}</h2>
          </div>
          <div className="knock-spectrogram-controls">
            {!enabled ? (
              <button
                type="button"
                className="knock-btn start"
                disabled={busy || !isConnected}
                onClick={() => setSpectrogramEnabled(true)}
                title={isConnected ? "Enable firmware spectrogram" : "Connect to ECU first"}
              >
                <Play size={14} /> Start
              </button>
            ) : (
              <button
                type="button"
                className="knock-btn stop"
                disabled={busy}
                onClick={() => setSpectrogramEnabled(false)}
              >
                <Square size={14} /> Stop
              </button>
            )}
            {!embedded && onClose && (
              <button type="button" className="knock-btn close" onClick={onClose}>
                <X size={14} />
              </button>
            )}
          </div>
        </div>
      )}

      {error && <div className="knock-spectrogram-error">{error}</div>}

      <div className="knock-spectrogram-meta">
        <span>ch {frame?.channel ?? "—"}</span>
        <span>cyl {frame?.cylinder ?? "—"}</span>
        <span>
          peak{" "}
          {peakHz != null && peak
            ? `${peakHz.toFixed(0)} Hz`
            : "—"}
        </span>
        <span>knock {(live.m_knockLevel ?? 0).toFixed(1)}</span>
        <span>ret {(live.m_knockRetard ?? 0).toFixed(1)}°</span>
        {!embedded && (
          <>
            <span>Count {Math.round(live.m_knockCount ?? 0)}</span>
            <span>RPM {Math.round(live.rpm ?? 0)}</span>
            <span>Cols {history.length}</span>
          </>
        )}
      </div>

      <div className="knock-spectrogram-canvas-wrap">
        <canvas ref={canvasRef} className="knock-spectrogram-canvas" />
      </div>
      {!embedded && (
        <div className="knock-magnitude-wrap">
          <div className="knock-magnitude-label">Current magnitude</div>
          <canvas ref={magRef} className="knock-magnitude-canvas" />
        </div>
      )}

      {!embedded && (
        <p className="knock-spectrogram-hint">
          Native LibreTune view of rusEFI / FOME / epicEFI packed FFT OCH
          (m_knockSpectrum1…16). No TunerStudio plugin required. Requires firmware
          built with knock spectrogram support and software knock enabled.
        </p>
      )}
    </div>
  );
};

export default KnockSpectrogramView;
