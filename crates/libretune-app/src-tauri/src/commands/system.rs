//! System / environment Tauri commands.
//!
//! Exposes lightweight info commands like build version and serial port
//! enumeration that don't fit any specific domain.

use libretune_core::protocol::serial::{list_ports, list_ports_unprobed};
use serde::Serialize;
use std::net::{TcpStream, ToSocketAddrs};
use std::time::Duration;

#[derive(Serialize)]
pub struct BuildInfo {
    pub version: String,
    pub build_id: String,
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
