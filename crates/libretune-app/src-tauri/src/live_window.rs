//! Rolling drive-pack window fed by the realtime stream.
//!
//! Process-wide (not an [`crate::state::AppState`] field) so the many
//! `AppState { .. }` test literals stay untouched.

use std::collections::{HashMap, VecDeque};
use std::sync::{Mutex, OnceLock};

use serde_json::{json, Value};

const MAX_SAMPLES: usize = 300;
const MAX_CHANNELS: usize = 16;

const KEEP: &[&str] = &[
    "rpm", "map", "tps", "clt", "iat", "afr", "lambda", "batt", "volt", "baro", "ego", "advance",
    "spark", "dwell", "pw", "duty", "knock", "fuelload", "oil",
];

fn keep_channel(name: &str) -> bool {
    let lower = name.to_lowercase();
    if lower == "pw" || lower == "oil" || lower.starts_with("oilp") {
        return true;
    }
    KEEP.iter()
        .any(|k| *k != "pw" && *k != "oil" && (lower == *k || lower.contains(k)))
}

struct LiveWindow {
    times_ms: VecDeque<u64>,
    channels: HashMap<String, VecDeque<f64>>,
}

impl LiveWindow {
    fn new() -> Self {
        Self {
            times_ms: VecDeque::new(),
            channels: HashMap::new(),
        }
    }

    fn clear(&mut self) {
        self.times_ms.clear();
        self.channels.clear();
    }

    fn push(&mut self, t_ms: u64, data: &HashMap<String, f64>) {
        if self.times_ms.len() == MAX_SAMPLES {
            self.times_ms.pop_front();
            let cap = self.times_ms.len();
            for q in self.channels.values_mut() {
                if q.len() > cap {
                    q.pop_front();
                }
            }
        }
        self.times_ms.push_back(t_ms);

        for (k, v) in data {
            if !keep_channel(k) {
                continue;
            }
            if let Some(q) = self.channels.get_mut(k) {
                q.push_back(*v);
                continue;
            }
            if self.channels.len() < MAX_CHANNELS {
                let mut q = VecDeque::with_capacity(MAX_SAMPLES);
                q.push_back(*v);
                self.channels.insert(k.clone(), q);
            }
        }
    }

    fn summarize(&self, seconds: f64) -> Value {
        let Some(&t1) = self.times_ms.back() else {
            return json!({
                "samples": 0,
                "note": "no live window yet; start realtime streaming",
            });
        };
        let span_ms = (seconds * 1000.0) as u64;
        let t0 = t1.saturating_sub(span_ms);
        let keep = self.times_ms.iter().filter(|&&t| t >= t0).count().max(1);
        let t_first = self
            .times_ms
            .iter()
            .rev()
            .nth(keep - 1)
            .copied()
            .unwrap_or(t1);

        let mut channels = Vec::new();
        for (name, q) in &self.channels {
            let slice: Vec<f64> = q
                .iter()
                .copied()
                .rev()
                .take(keep)
                .filter(|v| v.is_finite())
                .collect();
            let n = slice.len();
            if n == 0 {
                continue;
            }
            let last = slice[0];
            let (min, max, sum) = slice.iter().fold(
                (f64::INFINITY, f64::NEG_INFINITY, 0.0),
                |(mn, mx, s), &v| (mn.min(v), mx.max(v), s + v),
            );
            channels.push(json!({
                "name": name,
                "min": min,
                "max": max,
                "mean": sum / n as f64,
                "last": last,
                "n": n,
            }));
        }
        channels.sort_by(|a, b| {
            a["name"]
                .as_str()
                .unwrap_or("")
                .cmp(b["name"].as_str().unwrap_or(""))
        });

        json!({
            "samples": keep.min(self.times_ms.len()),
            "window_s": (t1.saturating_sub(t_first) as f64) / 1000.0,
            "channels": channels,
        })
    }
}

fn slot() -> &'static Mutex<LiveWindow> {
    static W: OnceLock<Mutex<LiveWindow>> = OnceLock::new();
    W.get_or_init(|| Mutex::new(LiveWindow::new()))
}

/// Record one stream tick. Never blocks the stream (drops the sample if busy).
pub fn push(t_ms: u64, data: &HashMap<String, f64>) {
    if let Ok(mut w) = slot().try_lock() {
        w.push(t_ms, data);
    }
}

/// Drop the ring when a new stream session starts.
pub fn clear() {
    if let Ok(mut w) = slot().lock() {
        w.clear();
    }
}

/// Drive-pack min/max/mean/last over the last `seconds` (clamped 2–30).
pub fn summarize(seconds: f64) -> Value {
    let seconds = seconds.clamp(2.0, 30.0);
    slot()
        .lock()
        .map(|w| w.summarize(seconds))
        .unwrap_or_else(|_| json!({"error": "live window lock poisoned"}))
}

#[cfg(test)]
mod tests {
    use super::LiveWindow;
    use std::collections::HashMap;

    #[test]
    fn empty_window_is_honest() {
        let w = LiveWindow::new();
        let v = w.summarize(15.0);
        assert_eq!(v["samples"], 0);
        assert!(v["note"].as_str().unwrap().contains("no live window"));
    }

    #[test]
    fn tracks_drive_pack_stats() {
        let mut w = LiveWindow::new();
        for i in 0..10 {
            let mut d = HashMap::new();
            d.insert("rpm".into(), 1000.0 + i as f64 * 100.0);
            d.insert("noise".into(), 1.0);
            w.push(i as u64 * 100, &d);
        }
        let v = w.summarize(15.0);
        assert_eq!(v["samples"], 10);
        let ch = v["channels"].as_array().unwrap();
        assert_eq!(ch.len(), 1);
        assert_eq!(ch[0]["name"], "rpm");
        assert_eq!(ch[0]["min"], 1000.0);
        assert_eq!(ch[0]["max"], 1900.0);
        assert_eq!(ch[0]["last"], 1900.0);
        assert!((v["window_s"].as_f64().unwrap() - 0.9).abs() < 1e-9);
    }

    #[test]
    fn ignores_coil_but_keeps_oil_pressure() {
        assert!(!super::keep_channel("coil"));
        assert!(super::keep_channel("oil"));
        assert!(super::keep_channel("oilPressure"));
    }

    #[test]
    fn seconds_trims_old_samples() {
        let mut w = LiveWindow::new();
        for i in 0..20 {
            let mut d = HashMap::new();
            d.insert("map".into(), i as f64);
            w.push(i as u64 * 1000, &d);
        }
        let v = w.summarize(5.0);
        assert_eq!(v["samples"], 6);
        assert_eq!(v["channels"][0]["min"], 14.0);
        assert_eq!(v["channels"][0]["max"], 19.0);
    }
}
