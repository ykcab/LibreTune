//! System / environment Tauri commands.
//!
//! Exposes lightweight info commands like build version and serial port
//! enumeration that don't fit any specific domain.

use libretune_core::protocol::serial::{list_ports, list_ports_unprobed};
use serde::Serialize;
use std::net::{TcpStream, ToSocketAddrs};
use std::time::Duration;
use tauri::Manager;

#[derive(Serialize)]
pub struct BuildInfo {
    pub version: String,
    pub build_id: String,
}

/// Reveal the main window once the frontend has painted its first frame.
///
/// The window is created hidden (`"visible": false` in `tauri.conf.json`) so
/// start-up can never show an unpainted surface. The frontend calls this from
/// its mount effect, by which point React has committed the shell (menu bar,
/// toolbar, sidebar, status bar) to the DOM, and the first frame the compositor
/// produces after `show()` contains the real UI.
///
/// A custom command is used rather than `WebviewWindow::show()` from JS because
/// that path is ACL-gated (the frontend's call was refused with
/// "Command plugin:window|show not allowed by ACL") and because a hidden
/// WebKitGTK window throttles `requestAnimationFrame`/`setTimeout` to the point
/// where a JS-driven reveal never fired and the Rust 8 s safety net was doing
/// the work — which is why the app looked like it took 8 s to open.
#[tauri::command]
pub async fn frontend_ready(app: tauri::AppHandle) -> Result<(), String> {
    // The window is created hidden (`"visible": false` in `tauri.conf.json`) so
    // start-up can never show an unpainted surface. The frontend calls this from
    // its mount effect, by which point React has committed the shell (menu bar,
    // toolbar, sidebar, status bar) to the DOM, and the first frame the
    // compositor produces after `show()` contains the real UI.
    //
    // A custom command is used rather than `WebviewWindow::show()` from JS
    // because that path is ACL-gated (the frontend's call was refused with
    // "Command plugin:window|show not allowed by ACL") and because a hidden
    // WebKitGTK window throttles `requestAnimationFrame`/`setTimeout` to the
    // point where a JS-driven reveal never fired and the Rust 8 s safety net was
    // doing the work — which is why the app looked like it took 8 s to open.
    //
    // The window may not be registered in Tauri's manager yet when the first
    // JS runs (the webview starts executing during window creation), so retry
    // briefly instead of giving up and waiting for the 8 s safety net.
    for _ in 0..20 {
        let windows: Vec<_> = app.webview_windows().into_values().collect();
        if !windows.is_empty() {
            for window in windows {
                if matches!(window.is_visible(), Ok(false)) {
                    let _ = window.show();
                }
            }
            return Ok(());
        }
        if let Some(window) = app.get_webview_window("main") {
            if matches!(window.is_visible(), Ok(false)) {
                let _ = window.show();
            }
            return Ok(());
        }
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
    }
    Ok(())
}

/// Get application build information (version + nightly build ID).
#[tauri::command]
pub fn get_build_info(app: tauri::AppHandle) -> BuildInfo {
    let version = app.package_info().version.to_string();
    let build_id = option_env!("LIBRETUNE_BUILD_ID")
        .unwrap_or("unknown")
        .to_string();
    BuildInfo { version, build_id }
}

/// Lists serial ports. `probe` (default true) open-checks Windows ghost COMs
/// for the picker; auto-connect passes false so a new port is seen immediately.
#[tauri::command]
pub async fn get_serial_ports(probe: Option<bool>) -> Result<Vec<String>, String> {
    let ports = if probe.unwrap_or(true) {
        list_ports()
    } else {
        list_ports_unprobed()
    };
    Ok(ports.into_iter().map(|p| p.name).collect())
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
pub struct LocalTcpEcu {
    pub host: String,
    pub port: u16,
    pub label: String,
}

fn tcp_accepts(host: &str, port: u16) -> bool {
    let Ok(addrs) = (host, port).to_socket_addrs() else {
        return false;
    };
    addrs
        .into_iter()
        .any(|addr| TcpStream::connect_timeout(&addr, Duration::from_millis(200)).is_ok())
}

pub(crate) fn probe_local_tcp(ports: &[(u16, &str)]) -> Vec<LocalTcpEcu> {
    ports
        .iter()
        .filter(|(port, _)| tcp_accepts("127.0.0.1", *port))
        .map(|(port, label)| LocalTcpEcu {
            host: "127.0.0.1".into(),
            port: *port,
            label: (*label).into(),
        })
        .collect()
}

/// Local listeners that speak the same TunerStudio TCP path as `ts_shim` (29001)
/// or a shim in front of the Windows/POSIX simulator (29010).
#[tauri::command]
pub async fn list_local_tcp_ecus() -> Result<Vec<LocalTcpEcu>, String> {
    tokio::task::spawn_blocking(|| {
        probe_local_tcp(&[
            (29001, "ts_shim / local ECU"),
            (29010, "ts_shim (simulator upstream)"),
        ])
    })
    .await
    .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;

    #[test]
    fn probe_finds_a_bound_local_port() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
        let port = listener.local_addr().expect("addr").port();
        let found = probe_local_tcp(&[(port, "test listener")]);
        drop(listener);
        assert_eq!(
            found,
            vec![LocalTcpEcu {
                host: "127.0.0.1".into(),
                port,
                label: "test listener".into(),
            }]
        );
    }

    #[test]
    fn probe_skips_closed_ports() {
        assert!(probe_local_tcp(&[(1, "reserved")]).is_empty());
    }
}
