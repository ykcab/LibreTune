//! Serial port handling
//!
//! Provides low-level serial port access for ECU communication.

use serialport::{SerialPort, SerialPortInfo, SerialPortType};
use std::collections::HashMap;
#[cfg(target_os = "linux")]
use std::fs;
use std::time::Duration;

use super::{ProtocolError, DEFAULT_BAUD_RATE};

/// Information about an available serial port
#[derive(Debug, Clone)]
pub struct PortInfo {
    /// Port name (e.g., "/dev/ttyUSB0" or "COM3")
    pub name: String,

    /// USB vendor ID (if USB device)
    pub vid: Option<u16>,

    /// USB product ID (if USB device)
    pub pid: Option<u16>,

    /// Manufacturer name (if available)
    pub manufacturer: Option<String>,

    /// Product name (if available)
    pub product: Option<String>,

    /// Serial number (if available)
    pub serial_number: Option<String>,
}

impl From<SerialPortInfo> for PortInfo {
    fn from(info: SerialPortInfo) -> Self {
        let (vid, pid, manufacturer, product, serial_number) = match info.port_type {
            SerialPortType::UsbPort(usb_info) => (
                Some(usb_info.vid),
                Some(usb_info.pid),
                usb_info.manufacturer,
                usb_info.product,
                usb_info.serial_number,
            ),
            _ => (None, None, None, None, None),
        };

        Self {
            name: info.port_name,
            vid,
            pid,
            manufacturer,
            product,
            serial_number,
        }
    }
}

/// Helper used to sort port names so that:
///  - ttyACM* ports come first (sorted numerically by suffix)
///  - then ttyUSB* ports (sorted numerically)
///  - then other ports (sorted by name)
fn port_sort_key(name: &str) -> (u8, usize, String) {
    let basename = name.rsplit('/').next().unwrap_or(name);
    if let Some(rest) = basename.strip_prefix("ttyACM") {
        let num = rest.parse::<usize>().unwrap_or(usize::MAX);
        return (0, num, basename.to_string());
    }
    if let Some(rest) = basename.strip_prefix("ttyUSB") {
        let num = rest.parse::<usize>().unwrap_or(usize::MAX);
        return (1, num, basename.to_string());
    }
    (2, 0, basename.to_string())
}

/// Windows leaves a stale entry in `HKLM\HARDWARE\DEVICEMAP\SERIALCOMM` for
/// some USB-serial devices whose driver doesn't clean it up on unplug — most
/// notably the ST-Link/STM32 Virtual COM Port that rusEFI boards use. Device
/// Manager correctly shows the device as not present, but `serialport`'s
/// Windows enumeration reads that registry map and lists the "ghost" port
/// anyway. A quick open-then-close probe filters these out: a genuinely
/// disconnected port fails fast (the OS has nothing to open), while a real,
/// unused port opens fine in a few milliseconds.
#[cfg(target_os = "windows")]
fn is_port_actually_present(name: &str) -> bool {
    serialport::new(name, DEFAULT_BAUD_RATE)
        .timeout(Duration::from_millis(50))
        .open()
        .is_ok()
}

/// List serial ports, filtering Windows ghost COM entries with an open-probe.
pub fn list_ports() -> Vec<PortInfo> {
    collect_ports(true)
}

/// Registry/device-node names only — no open-probe. Used by auto-connect so a
/// just-appeared ECU is visible immediately and is not DTR-reset by a probe.
pub fn list_ports_unprobed() -> Vec<PortInfo> {
    collect_ports(false)
}

fn collect_ports(probe_windows: bool) -> Vec<PortInfo> {
    let mut map: HashMap<String, PortInfo> = HashMap::new();
    for info in serialport::available_ports()
        .unwrap_or_default()
        .into_iter()
    {
        let p = PortInfo::from(info);
        map.entry(p.name.clone()).or_insert(p);
    }

    #[cfg(target_os = "windows")]
    if probe_windows {
        map.retain(|name, _| is_port_actually_present(name));
    }
    #[cfg(not(target_os = "windows"))]
    let _ = probe_windows;

    // Linux-only: Add /dev/ttyACM* and /dev/ttyUSB* entries if present but not found by API
    #[cfg(target_os = "linux")]
    if let Ok(entries) = fs::read_dir("/dev") {
        for entry in entries.flatten() {
            if let Some(fname) = entry.file_name().to_str() {
                if fname.starts_with("ttyACM") || fname.starts_with("ttyUSB") {
                    let full = format!("/dev/{}", fname);
                    map.entry(full.clone()).or_insert_with(|| PortInfo {
                        name: full,
                        vid: None,
                        pid: None,
                        manufacturer: None,
                        product: None,
                        serial_number: None,
                    });
                }
            }
        }
    }

    // Collect and sort deterministically
    let mut v: Vec<PortInfo> = map.into_values().collect();
    v.sort_by_key(|p| port_sort_key(&p.name));
    v
}

/// Open a serial port with default settings
pub fn open_port(name: &str, baud_rate: Option<u32>) -> Result<Box<dyn SerialPort>, ProtocolError> {
    let baud = baud_rate.unwrap_or(DEFAULT_BAUD_RATE);

    // Use short timeout (100ms) for responsive non-blocking reads
    // This matches the behavior that works in standalone test
    serialport::new(name, baud)
        .timeout(Duration::from_millis(100))
        .open()
        .map_err(|e| ProtocolError::SerialError(annotate_serial_open_error(name, &e.to_string())))
}

fn annotate_serial_open_error(name: &str, err: &str) -> String {
    let lower = err.to_ascii_lowercase();

    // Linux reports `EACCES` as "Permission denied" — that is the device node
    // not granting the current user access (a missing serial-port group
    // membership), *not* another program holding the port. The held-port case
    // is `EBUSY` ("Device or resource busy"), which the kernel returns for a
    // TIOCEXCL lock. Conflating the two sent users down the "connect via TCP"
    // path for a permissions problem they fix with one `usermod` command.
    if lower.contains("permission denied") {
        return format!(
            "{err} The OS refused access to {name}.{}",
            serial_permission_hint(name)
        );
    }

    // Windows "Access is denied." and Linux "Device or resource busy" both mean
    // another program already has the port open.
    if lower.contains("busy")
        || lower.contains("in use")
        || lower.contains("access is denied")
        || lower.contains("access denied")
    {
        format!(
            "{err} Port {name} is held by another program (often ts_shim or TunerStudio). \
             Connect via TCP to 127.0.0.1:29001 instead."
        )
    } else {
        err.to_string()
    }
}

/// Build the "how to fix the refused serial open" hint appended to a
/// `Permission denied` error.
///
/// On Linux the owning group varies by distro — `dialout` on Debian/Ubuntu,
/// `uucp` on Arch/Manjaro — so resolve the device node's actual group and name
/// it directly rather than guessing. A hardcoded group name is exactly what
/// produced `usermod: group 'dialout' does not exist` on Arch.
#[cfg(target_os = "linux")]
fn serial_permission_hint(name: &str) -> String {
    use std::os::unix::fs::MetadataExt;

    let group = std::fs::metadata(name)
        .ok()
        .and_then(|m| group_name_from_gid(m.gid()))
        .unwrap_or_else(|| "dialout".to_string());

    format!(
        " On Linux, add your user to the `{group}` group \
         (`sudo usermod -a -G {group} $USER`), then log out and back in."
    )
}

#[cfg(target_os = "linux")]
fn group_name_from_gid(gid: u32) -> Option<String> {
    // SAFETY: getgrgid returns a pointer into shared static storage. The name
    // is copied out immediately, and the only caller is the connect path, which
    // is serialized behind the connection-transition lock, so there is no
    // practical race with another getgr* caller overwriting the buffer.
    let entry = unsafe { libc::getgrgid(gid) };
    if entry.is_null() {
        return None;
    }
    let name = unsafe { std::ffi::CStr::from_ptr((*entry).gr_name) };
    Some(name.to_string_lossy().into_owned())
}

#[cfg(not(target_os = "linux"))]
fn serial_permission_hint(_name: &str) -> String {
    " Add your user to the serial-port group (`uucp` on macOS/BSD), then log out and back in."
        .to_string()
}

/// Configure a serial port for ECU communication
pub fn configure_port(port: &mut dyn SerialPort) -> Result<(), ProtocolError> {
    // Standard 8N1 configuration
    port.set_data_bits(serialport::DataBits::Eight)
        .map_err(|e| ProtocolError::SerialError(e.to_string()))?;
    port.set_parity(serialport::Parity::None)
        .map_err(|e| ProtocolError::SerialError(e.to_string()))?;
    port.set_stop_bits(serialport::StopBits::One)
        .map_err(|e| ProtocolError::SerialError(e.to_string()))?;
    port.set_flow_control(serialport::FlowControl::None)
        .map_err(|e| ProtocolError::SerialError(e.to_string()))?;

    // Set DTR high to maintain connection and prevent Arduino-based ECU reset
    // Opening a serial port typically toggles DTR which triggers bootloader reset
    // Keeping DTR asserted prevents this and maintains stable connection
    if let Err(e) = port.write_data_terminal_ready(true) {
        tracing::debug!("configure_port: failed to set DTR high: {} (continuing)", e);
    } else {
        tracing::debug!("configure_port: DTR set high");
    }

    // Set RTS high for proper flow control signaling
    if let Err(e) = port.write_request_to_send(true) {
        tracing::debug!("configure_port: failed to set RTS high: {} (continuing)", e);
    } else {
        tracing::debug!("configure_port: RTS set high");
    }

    Ok(())
}

/// Clear the serial port buffers
pub fn clear_buffers(port: &mut dyn SerialPort) -> Result<(), ProtocolError> {
    port.clear(serialport::ClearBuffer::All)
        .map_err(|e| ProtocolError::SerialError(e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_list_ports() {
        let _ = list_ports();
        let _ = list_ports_unprobed();
    }

    #[test]
    #[cfg(target_os = "windows")]
    fn test_is_port_actually_present_rejects_bogus_name() {
        assert!(!is_port_actually_present("COM_DOES_NOT_EXIST_9999"));
    }

    #[test]
    fn test_port_sorting() {
        let names = vec![
            "/dev/ttyUSB1",
            "/dev/ttyACM1",
            "/dev/ttyUSB0",
            "/dev/ttyACM0",
            "/dev/someport",
            "/dev/ttyACM10",
        ];
        let mut ports: Vec<PortInfo> = names
            .into_iter()
            .map(|n| PortInfo {
                name: n.to_string(),
                vid: None,
                pid: None,
                manufacturer: None,
                product: None,
                serial_number: None,
            })
            .collect();

        ports.sort_by_key(|p| port_sort_key(&p.name));
        let ordered: Vec<String> = ports.into_iter().map(|p| p.name).collect();

        assert_eq!(
            ordered,
            vec![
                "/dev/ttyACM0",
                "/dev/ttyACM1",
                "/dev/ttyACM10",
                "/dev/ttyUSB0",
                "/dev/ttyUSB1",
                "/dev/someport",
            ]
        );
    }

    #[test]
    fn busy_open_error_points_at_ts_shim_tcp() {
        let msg = annotate_serial_open_error("COM31", "Access is denied.");
        assert!(msg.contains("127.0.0.1:29001"), "{msg}");
        assert!(msg.contains("COM31"), "{msg}");
    }

    #[test]
    fn other_open_errors_are_unchanged() {
        assert_eq!(
            annotate_serial_open_error("COM31", "The system cannot find the file specified."),
            "The system cannot find the file specified."
        );
    }

    #[test]
    fn linux_permission_denied_is_a_permissions_error_not_a_held_port() {
        let msg = annotate_serial_open_error("/dev/libretune-no-such-port", "Permission denied");
        assert!(msg.contains("Permission denied"), "{msg}");
        assert!(!msg.contains("127.0.0.1:29001"), "{msg}");
        assert!(!msg.contains("held by another program"), "{msg}");
        // The hint must carry a real fix-up command, not the Debian-specific
        // "dialout" guess that breaks on Arch/Manjaro.
        #[cfg(target_os = "linux")]
        assert!(msg.contains("usermod"), "{msg}");
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn group_name_resolves_from_gid() {
        // gid 0 is the `root` group on every Linux system, so this exercises
        // the getgrgid path deterministically without depending on the test
        // machine's serial device group.
        assert_eq!(group_name_from_gid(0).as_deref(), Some("root"));
    }
}
