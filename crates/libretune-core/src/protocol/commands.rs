//! Protocol command parameters
//!
//! Parameter structs for the read/write/burn requests and the text console.
//! There is deliberately no fixed table of command bytes here: the bytes
//! come from the INI format strings through `CommandBuilder`, so a static
//! mapping would only ever be wrong for some firmware.

/// Read memory command parameters
#[derive(Debug, Clone, Copy)]
pub struct ReadMemoryParams {
    /// Page to read from
    pub page: u8,
    /// Offset within page
    pub offset: u16,
    /// Number of bytes to read
    pub length: u16,
    /// CAN ID for CAN-enabled ECUs (0 for local)
    pub can_id: u8,
}

impl ReadMemoryParams {
    pub fn new(page: u8, offset: u16, length: u16) -> Self {
        Self {
            page,
            offset,
            length,
            can_id: 0,
        }
    }
}

/// Write memory command parameters
#[derive(Debug, Clone)]
pub struct WriteMemoryParams {
    /// Page to write to
    pub page: u8,
    /// Offset within page
    pub offset: u16,
    /// Data to write
    pub data: Vec<u8>,
    /// CAN ID for CAN-enabled ECUs (0 for local)
    pub can_id: u8,
}

impl WriteMemoryParams {
    pub fn new(page: u8, offset: u16, data: Vec<u8>) -> Self {
        Self {
            page,
            offset,
            data,
            can_id: 0,
        }
    }
}

/// Burn command parameters
#[derive(Debug, Clone, Copy)]
pub struct BurnParams {
    /// Page to burn
    pub page: u8,
    /// CAN ID for CAN-enabled ECUs (0 for local)
    pub can_id: u8,
}

impl BurnParams {
    pub fn new(page: u8) -> Self {
        Self { page, can_id: 0 }
    }
}

/// Console command for rusEFI/FOME/epicEFI text-based console I/O
/// These commands are sent as plain text strings (typically ASCII) to the ECU's
/// text-based console interface and receive text-based responses.
#[derive(Debug, Clone)]
pub struct ConsoleCommand {
    /// The text command to send (e.g., "help", "status", "set someVar 100")
    pub command: String,
    /// Timeout for this specific command (ms). If None, uses default 1000ms
    pub timeout_ms: Option<u64>,
}

impl ConsoleCommand {
    /// Create a new console command
    pub fn new(command: impl Into<String>) -> Self {
        Self {
            command: command.into(),
            timeout_ms: None,
        }
    }

    /// Create a console command with custom timeout
    pub fn with_timeout(command: impl Into<String>, timeout_ms: u64) -> Self {
        Self {
            command: command.into(),
            timeout_ms: Some(timeout_ms),
        }
    }

    /// Get effective timeout for this command
    pub fn get_timeout_ms(&self) -> u64 {
        self.timeout_ms.unwrap_or(1000)
    }

    /// Convert command to bytes, appending newline for transmission
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut bytes = self.command.as_bytes().to_vec();
        bytes.push(b'\n'); // Append newline for ECU to detect end of command
        bytes
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_console_command_creation() {
        let cmd = ConsoleCommand::new("help");
        assert_eq!(cmd.command, "help");
        assert_eq!(cmd.timeout_ms, None);
        assert_eq!(cmd.get_timeout_ms(), 1000);
    }

    #[test]
    fn test_console_command_with_timeout() {
        let cmd = ConsoleCommand::with_timeout("status", 2000);
        assert_eq!(cmd.command, "status");
        assert_eq!(cmd.get_timeout_ms(), 2000);
    }

    #[test]
    fn test_console_command_to_bytes() {
        let cmd = ConsoleCommand::new("help");
        let bytes = cmd.to_bytes();
        assert_eq!(bytes, b"help\n".to_vec());
    }
}
