//! Online INI Repository
//!
//! Provides functionality to search for and download INI files from online
//! repositories like GitHub (Speeduino, rusEFI, etc.).
//!
//! ## Supported Sources
//!
//! - Speeduino: https://github.com/noisymime/speeduino/tree/master/reference/tunerstudio
//! - rusEFI: https://github.com/rusefi/rusefi/tree/master/firmware/tunerstudio
//!
//! ## Usage
//!
//! ```ignore
//! let online = OnlineIniRepository::new();
//! let results = online.search("speeduino 202305").await?;
//! for entry in results {
//!     println!("{}: {}", entry.name, entry.signature);
//! }
//! online.download(&results[0], "./definitions/").await?;
//! ```

use serde::{Deserialize, Serialize};
use std::io;
use std::path::Path;

/// Information about an online INI file
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OnlineIniEntry {
    /// Source repository (speeduino, rusefi, etc.)
    pub source: IniSource,
    /// Display name
    pub name: String,
    /// Firmware signature (if known)
    pub signature: Option<String>,
    /// GitHub raw download URL
    pub download_url: String,
    /// File path within the repository
    pub repo_path: String,
    /// File size in bytes (if known)
    pub size: Option<u64>,
}

/// Known INI sources
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum IniSource {
    Speeduino,
    RusEFI,
    /// FOME — a rusEFI fork; its TunerStudio INIs live under
    /// `FOME-Tech/fome-fw/firmware/tunerstudio`.
    Fome,
    Custom,
}

impl IniSource {
    /// Every source the online search fetches from, in priority order.
    ///
    /// `Custom` is intentionally excluded — it has no upstream URL and is only
    /// used to tag user-imported files. Add new upstream platforms here (and
    /// give them URLs below) to widen auto-discovery coverage.
    pub fn online_sources() -> &'static [IniSource] {
        &[IniSource::Speeduino, IniSource::RusEFI, IniSource::Fome]
    }

    /// Get the GitHub API URL for searching this source
    pub fn github_api_url(&self) -> Option<&'static str> {
        match self {
            // The .ini used to live under reference/tunerstudio/, which no longer
            // exists; the single canonical definition is reference/speeduino.ini.
            IniSource::Speeduino => {
                Some("https://api.github.com/repos/noisymime/speeduino/contents/reference")
            }
            IniSource::RusEFI => {
                Some("https://api.github.com/repos/rusefi/rusefi/contents/firmware/tunerstudio")
            }
            IniSource::Fome => {
                Some("https://api.github.com/repos/FOME-Tech/fome-fw/contents/firmware/tunerstudio")
            }
            IniSource::Custom => None,
        }
    }

    /// Get the raw content URL prefix for this source
    pub fn raw_url_prefix(&self) -> Option<&'static str> {
        match self {
            IniSource::Speeduino => {
                Some("https://raw.githubusercontent.com/noisymime/speeduino/master/reference")
            }
            IniSource::RusEFI => {
                Some("https://raw.githubusercontent.com/rusefi/rusefi/master/firmware/tunerstudio")
            }
            IniSource::Fome => Some(
                "https://raw.githubusercontent.com/FOME-Tech/fome-fw/master/firmware/tunerstudio",
            ),
            IniSource::Custom => None,
        }
    }

    pub fn display_name(&self) -> &'static str {
        match self {
            IniSource::Speeduino => "Speeduino",
            IniSource::RusEFI => "rusEFI",
            IniSource::Fome => "FOME",
            IniSource::Custom => "Custom",
        }
    }
}

/// GitHub API response for directory listing
#[derive(Debug, Deserialize)]
struct GitHubFile {
    name: String,
    path: String,
    size: Option<u64>,
    download_url: Option<String>,
    #[serde(rename = "type")]
    file_type: String,
}

/// Online INI repository client
pub struct OnlineIniRepository {
    /// HTTP client for API requests
    client: reqwest::Client,
    /// Cache of known INI entries (signature -> entry)
    cache: Vec<OnlineIniEntry>,
}

impl OnlineIniRepository {
    /// Create a new online repository client
    pub fn new() -> Self {
        // Ignore any inherited proxy configuration and pin HTTP/1.1: some
        // GUI-process environments and CDNs reject the request otherwise
        // (observed as a spurious 400 on rusEFI's online-INI host, while the
        // exact same request over HTTP/1.1 with no proxy returns 200).
        let client = reqwest::Client::builder()
            .user_agent("LibreTune/0.1")
            .no_proxy()
            .http1_only()
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());

        OnlineIniRepository {
            client,
            cache: Vec::new(),
        }
    }

    /// Search for INI files matching a signature
    ///
    /// If signature is None, returns all known INIs from all sources.
    pub async fn search(
        &mut self,
        signature: Option<&str>,
    ) -> Result<Vec<OnlineIniEntry>, io::Error> {
        // Refresh cache if empty
        if self.cache.is_empty() {
            self.refresh_cache().await?;
        }

        match signature {
            Some(sig) => {
                let sig_lower = sig.to_lowercase();
                Ok(self
                    .cache
                    .iter()
                    .filter(|e| {
                        if let Some(ref entry_sig) = e.signature {
                            entry_sig.to_lowercase().contains(&sig_lower)
                                || sig_lower.contains(&entry_sig.to_lowercase())
                        } else {
                            // Match by name if no signature
                            e.name.to_lowercase().contains(&sig_lower)
                        }
                    })
                    .cloned()
                    .collect())
            }
            None => Ok(self.cache.clone()),
        }
    }

    /// Refresh the cache by fetching INI lists from all sources
    async fn refresh_cache(&mut self) -> Result<(), io::Error> {
        self.cache.clear();

        // Fetch from each upstream source
        for &source in IniSource::online_sources() {
            match self.fetch_source_inis(source).await {
                Ok(entries) => self.cache.extend(entries),
                Err(e) => {
                    eprintln!("Warning: Failed to fetch INIs from {:?}: {}", source, e);
                    // Continue with other sources
                }
            }
        }

        Ok(())
    }

    /// Fetch INI list from a specific source
    async fn fetch_source_inis(&self, source: IniSource) -> Result<Vec<OnlineIniEntry>, io::Error> {
        let api_url = source
            .github_api_url()
            .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "No API URL for source"))?;

        let response = self
            .client
            .get(api_url)
            .send()
            .await
            .map_err(|e| io::Error::other(e.to_string()))?;

        if !response.status().is_success() {
            return Err(io::Error::other(format!(
                "GitHub API error: {}",
                response.status()
            )));
        }

        let files: Vec<GitHubFile> = response
            .json()
            .await
            .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e.to_string()))?;

        let mut entries = Vec::new();

        for file in files {
            // Only include .ini files
            if file.file_type == "file" && file.name.to_lowercase().ends_with(".ini") {
                if let Some(download_url) = file.download_url {
                    entries.push(OnlineIniEntry {
                        source,
                        name: file.name,
                        signature: None, // Would need to download to get signature
                        download_url,
                        repo_path: file.path,
                        size: file.size,
                    });
                }
            }
        }

        Ok(entries)
    }

    /// Download an INI file to the specified directory
    ///
    /// Returns the path to the downloaded file.
    pub async fn download(
        &self,
        entry: &OnlineIniEntry,
        target_dir: &Path,
    ) -> Result<std::path::PathBuf, io::Error> {
        eprintln!("[online-ini] downloading {}", entry.download_url);
        let response = self
            .client
            .get(&entry.download_url)
            .header(reqwest::header::ACCEPT, "*/*")
            .send()
            .await
            .map_err(|e| io::Error::other(e.to_string()))?;

        let status = response.status();
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            eprintln!(
                "[online-ini] {} -> {} body: {}",
                entry.download_url,
                status,
                body.chars().take(300).collect::<String>()
            );
            return Err(io::Error::other(format!("Download failed: {}", status)));
        }

        let content = response
            .bytes()
            .await
            .map_err(|e| io::Error::other(e.to_string()))?;

        // Create target directory if it doesn't exist
        std::fs::create_dir_all(target_dir)?;

        // Generate unique filename
        let filename = format!(
            "{}_{}",
            entry.source.display_name().to_lowercase(),
            entry.name
        );
        let target_path = target_dir.join(&filename);

        std::fs::write(&target_path, &content)?;

        Ok(target_path)
    }

    /// Check if we have internet connectivity
    pub async fn check_connectivity(&self) -> bool {
        // Try to reach GitHub
        match self
            .client
            .head("https://api.github.com")
            .timeout(std::time::Duration::from_secs(5))
            .send()
            .await
        {
            Ok(resp) => resp.status().is_success() || resp.status().as_u16() == 403, // 403 = rate limited but reachable
            Err(_) => false,
        }
    }
}

impl Default for OnlineIniRepository {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ini_source_urls() {
        assert!(IniSource::Speeduino.github_api_url().is_some());
        assert!(IniSource::RusEFI.github_api_url().is_some());
        assert!(IniSource::Fome.github_api_url().is_some());
        assert!(IniSource::Custom.github_api_url().is_none());
    }

    #[test]
    fn test_online_sources_all_have_urls() {
        // Every source the search iterates over must have both a GitHub API URL
        // and a raw-content prefix, and must not be the Custom (no-upstream) tag.
        for &source in IniSource::online_sources() {
            assert_ne!(source, IniSource::Custom);
            assert!(
                source.github_api_url().is_some(),
                "{:?} has no github_api_url",
                source
            );
            assert!(
                source.raw_url_prefix().is_some(),
                "{:?} has no raw_url_prefix",
                source
            );
        }
    }

    #[test]
    fn test_fome_is_an_online_source() {
        assert!(IniSource::online_sources().contains(&IniSource::Fome));
        assert_eq!(IniSource::Fome.display_name(), "FOME");
    }
}
