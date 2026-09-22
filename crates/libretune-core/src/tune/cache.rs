//! Tune Cache - Local data buffer for ECU tuning
//!
//! The TuneCache holds a local copy of ECU memory, enabling:
//! - Offline editing without ECU connection
//! - Dirty tracking for modified values
//! - Batch writes to minimize ECU communication
//! - Loading state tracking per page

use crate::ecu::ShadowMemory;
use crate::ini::EcuDefinition;
use std::collections::HashMap;

/// Loading state for a memory page
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PageState {
    /// Page has not been loaded yet
    NotLoaded,
    /// Page is currently being loaded from ECU
    Loading,
    /// Page data is current and matches ECU
    Clean,
    /// Page has local modifications not yet sent to ECU
    Dirty,
    /// Page has been sent to ECU but not burned to flash
    Pending,
    /// Failed to load page
    Error,
}

/// Holds local copy of ECU data with change tracking
#[derive(Default)]
pub struct TuneCache {
    /// Raw page data
    pages: HashMap<u8, Vec<u8>>,
    /// Page sizes from definition
    page_sizes: Vec<u16>,
    /// Number of pages
    n_pages: u8,
    /// State of each page
    page_states: HashMap<u8, PageState>,
    /// Dirty byte tracking
    shadow: ShadowMemory,
    /// Whether we have any pending burns
    has_pending_burn: bool,
    /// Local values for PC variables (not stored on ECU)
    pub local_values: HashMap<String, f64>,
}

impl TuneCache {
    /// Create a new tune cache from ECU definition
    pub fn from_definition(definition: &EcuDefinition) -> Self {
        let pages = HashMap::new();
        let mut page_states = HashMap::new();

        for i in 0..definition.page_sizes.len() {
            page_states.insert(i as u8, PageState::NotLoaded);
        }

        Self {
            pages,
            page_sizes: definition.page_sizes.clone(),
            n_pages: definition.n_pages,
            page_states,
            shadow: ShadowMemory::new(),
            has_pending_burn: false,
            local_values: HashMap::new(),
        }
    }

    /// Get the number of pages
    pub fn page_count(&self) -> u8 {
        self.n_pages
    }

    /// Get the size of a page
    pub fn page_size(&self, page: u8) -> Option<u16> {
        self.page_sizes.get(page as usize).copied()
    }

    /// Get the state of a page
    pub fn page_state(&self, page: u8) -> PageState {
        *self.page_states.get(&page).unwrap_or(&PageState::NotLoaded)
    }

    /// Check if all pages are loaded
    pub fn is_fully_loaded(&self) -> bool {
        for page in 0..self.n_pages {
            match self.page_state(page) {
                PageState::Clean | PageState::Dirty | PageState::Pending => continue,
                _ => return false,
            }
        }
        true
    }

    /// Check if any page is currently loading
    pub fn is_loading(&self) -> bool {
        self.page_states.values().any(|s| *s == PageState::Loading)
    }

    /// Get list of pages that need to be loaded
    pub fn pages_to_load(&self) -> Vec<u8> {
        (0..self.n_pages)
            .filter(|p| self.page_state(*p) == PageState::NotLoaded)
            .collect()
    }

    /// Mark a page as loading
    pub fn mark_loading(&mut self, page: u8) {
        self.page_states.insert(page, PageState::Loading);
    }

    /// Mark a page as failed to load
    pub fn mark_error(&mut self, page: u8) {
        self.page_states.insert(page, PageState::Error);
    }

    /// Load page data from ECU response
    pub fn load_page(&mut self, page: u8, data: Vec<u8>) {
        self.pages.insert(page, data);
        self.page_states.insert(page, PageState::Clean);
    }

    /// Mark a whole loaded page dirty (file content not yet sent to the ECU).
    ///
    /// No-op unless the page already holds a real image — same guard as
    /// `write_bytes`, so a missing page can never become a zero page here.
    /// File imports (`load_msq_pages_into_cache`) land via `load_page`,
    /// which marks Clean; without this the Burn step cannot tell an
    /// MSQ-loaded page from an ECU-synced one and the file never reaches
    /// the ECU.
    pub fn mark_page_dirty(&mut self, page: u8) {
        let len = match self.pages.get(&page) {
            Some(data) => data.len(),
            None => return,
        };
        match self.page_state(page) {
            PageState::Clean | PageState::Dirty | PageState::Pending => {}
            _ => return,
        }
        let len = len.min(u16::MAX as usize) as u16;
        self.shadow.mark_dirty(page, 0, len);
        self.page_states.insert(page, PageState::Dirty);
    }

    /// Full-size dirty pages with real content, ready to write to ECU RAM.
    ///
    /// Clean pages already match the ECU; zero-filled or short pages are
    /// never returned — writing those is what bricks tunes.
    pub fn dirty_page_images(&self) -> Vec<(u8, Vec<u8>)> {
        let mut pages: Vec<(u8, Vec<u8>)> = self
            .shadow
            .dirty_pages()
            .into_iter()
            .filter(|page| self.page_state(*page) == PageState::Dirty)
            .filter_map(|page| {
                let data = self.pages.get(&page)?;
                let expected = self.page_size(page)? as usize;
                if data.len() == expected && data.iter().any(|&b| b != 0) {
                    Some((page, data.clone()))
                } else {
                    None
                }
            })
            .collect();
        pages.sort_by_key(|(p, _)| *p);
        pages
    }

    /// Read raw bytes from a page (returns None if page not loaded)
    pub fn read_bytes(&self, page: u8, offset: u16, length: u16) -> Option<&[u8]> {
        // Check page is loaded
        match self.page_state(page) {
            PageState::Clean | PageState::Dirty | PageState::Pending => {}
            _ => return None,
        }

        let page_data = self.pages.get(&page)?;
        let start = offset as usize;
        let end = start + length as usize;

        if end <= page_data.len() {
            Some(&page_data[start..end])
        } else {
            None
        }
    }

    /// Write raw bytes to a page (marks as dirty).
    ///
    /// Refuses if the page has no real image yet, or if the write would grow
    /// the buffer — inventing zeros here is what later gets burned to the ECU.
    pub fn write_bytes(&mut self, page: u8, offset: u16, data: &[u8]) -> bool {
        match self.page_state(page) {
            PageState::Clean | PageState::Dirty | PageState::Pending => {}
            _ => return false,
        }

        let start = offset as usize;
        let end = start + data.len();
        let Some(page_data) = self.pages.get_mut(&page) else {
            return false;
        };
        if end > page_data.len() {
            return false;
        }

        page_data[start..end].copy_from_slice(data);
        self.shadow.mark_dirty(page, offset, data.len() as u16);
        self.page_states.insert(page, PageState::Dirty);
        true
    }

    /// Get a complete page. `None` until the page has been loaded from the ECU
    /// or a real tune image — never a synthetic zero buffer.
    pub fn get_page(&self, page: u8) -> Option<&[u8]> {
        match self.page_state(page) {
            PageState::Clean | PageState::Dirty | PageState::Pending => {
                self.pages.get(&page).map(|v| v.as_slice())
            }
            _ => None,
        }
    }

    /// Check if there are any local modifications
    pub fn has_dirty_data(&self) -> bool {
        self.shadow.has_changes()
    }

    /// Check if there are pending burns (sent to ECU but not burned)
    pub fn has_pending_burn(&self) -> bool {
        self.has_pending_burn
    }

    /// Get count of dirty bytes
    pub fn dirty_byte_count(&self) -> usize {
        self.shadow.dirty_count()
    }

    /// Get pages with dirty data
    pub fn dirty_pages(&self) -> Vec<u8> {
        self.shadow.dirty_pages()
    }

    /// Mark pages as pending (sent to ECU but not burned)
    pub fn mark_pending(&mut self) {
        for page in self.shadow.dirty_pages() {
            self.page_states.insert(page, PageState::Pending);
        }
        self.shadow.clear();
        self.has_pending_burn = true;
    }

    /// Mark burn as complete
    pub fn mark_burned(&mut self) {
        for state in self.page_states.values_mut() {
            if *state == PageState::Pending {
                *state = PageState::Clean;
            }
        }
        self.has_pending_burn = false;
    }

    /// Revert to clean state (discard changes)
    pub fn revert(&mut self) {
        self.shadow.clear();
        for state in self.page_states.values_mut() {
            if *state == PageState::Dirty {
                *state = PageState::NotLoaded; // Will need to reload
            }
        }
    }

    /// Get dirty ranges for a page (for efficient writes)
    /// Returns list of (offset, length) pairs
    pub fn dirty_ranges(&self, page: u8) -> Vec<(u16, u16)> {
        let mut ranges = Vec::new();
        let mut start: Option<u16> = None;
        let mut length: u16 = 0;

        let page_size = self.page_size(page).unwrap_or(0);

        for offset in 0..page_size {
            if self.shadow.is_dirty(page, offset) {
                match start {
                    None => {
                        start = Some(offset);
                        length = 1;
                    }
                    Some(_) => {
                        length += 1;
                    }
                }
            } else if let Some(s) = start {
                ranges.push((s, length));
                start = None;
                length = 0;
            }
        }

        // Don't forget trailing range
        if let Some(s) = start {
            ranges.push((s, length));
        }

        ranges
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::field_reassign_with_default)]
    use super::*;

    fn create_test_cache() -> TuneCache {
        let mut cache = TuneCache::default();
        cache.n_pages = 2;
        cache.page_sizes = vec![256, 512];
        cache.pages.insert(0, vec![0u8; 256]);
        cache.pages.insert(1, vec![0u8; 512]);
        cache.page_states.insert(0, PageState::Clean);
        cache.page_states.insert(1, PageState::Clean);
        cache
    }

    #[test]
    fn test_read_write() {
        let mut cache = create_test_cache();

        assert!(!cache.has_dirty_data());

        // Write some data
        assert!(cache.write_bytes(0, 10, &[1, 2, 3, 4]));

        // Should be dirty now
        assert!(cache.has_dirty_data());
        assert_eq!(cache.page_state(0), PageState::Dirty);

        // Read back
        let data = cache.read_bytes(0, 10, 4).unwrap();
        assert_eq!(data, &[1, 2, 3, 4]);
    }

    #[test]
    fn test_dirty_ranges() {
        let mut cache = create_test_cache();

        // Write two non-contiguous ranges
        cache.write_bytes(0, 10, &[1, 2, 3]);
        cache.write_bytes(0, 20, &[4, 5]);

        let ranges = cache.dirty_ranges(0);
        assert_eq!(ranges, vec![(10, 3), (20, 2)]);
    }

    #[test]
    fn test_loading_state() {
        let mut cache = TuneCache::default();
        cache.n_pages = 2;
        cache.page_sizes = vec![256, 512];
        cache.pages.insert(0, vec![0u8; 256]);
        cache.pages.insert(1, vec![0u8; 512]);
        cache.page_states.insert(0, PageState::NotLoaded);
        cache.page_states.insert(1, PageState::NotLoaded);

        assert!(!cache.is_fully_loaded());
        assert_eq!(cache.pages_to_load(), vec![0, 1]);

        cache.load_page(0, vec![0u8; 256]);
        assert!(!cache.is_fully_loaded());
        assert_eq!(cache.pages_to_load(), vec![1]);

        cache.load_page(1, vec![0u8; 512]);
        assert!(cache.is_fully_loaded());
        assert!(cache.pages_to_load().is_empty());
    }

    #[test]
    fn from_definition_does_not_invent_zero_pages() {
        let mut def = crate::ini::EcuDefinition::default();
        def.n_pages = 1;
        def.page_sizes = vec![256];
        let mut cache = TuneCache::from_definition(&def);
        assert!(cache.get_page(0).is_none());
        assert!(!cache.write_bytes(0, 0, &[1, 2, 3]));
        cache.load_page(0, vec![9u8; 256]);
        assert!(cache.write_bytes(0, 0, &[1, 2, 3]));
        assert_eq!(&cache.get_page(0).unwrap()[..3], &[1, 2, 3]);
    }

    #[test]
    fn test_pending_burn() {
        let mut cache = create_test_cache();

        cache.write_bytes(0, 10, &[1, 2, 3]);
        assert!(cache.has_dirty_data());
        assert!(!cache.has_pending_burn());

        cache.mark_pending();
        assert!(!cache.has_dirty_data());
        assert!(cache.has_pending_burn());
        assert_eq!(cache.page_state(0), PageState::Pending);

        cache.mark_burned();
        assert!(!cache.has_pending_burn());
        assert_eq!(cache.page_state(0), PageState::Clean);
    }

    #[test]
    fn mark_page_dirty_needs_a_real_image() {
        let mut cache = create_test_cache();

        // Clean page with an image becomes dirty.
        cache.pages.insert(0, vec![7u8; 256]);
        cache.mark_page_dirty(0);
        assert_eq!(cache.page_state(0), PageState::Dirty);
        assert!(cache.has_dirty_data());

        // Missing page: no-op, never invents a zero image.
        cache.mark_page_dirty(9);
        assert!(cache.get_page(9).is_none());
        assert!(!cache.dirty_pages().contains(&9));

        // NotLoaded page with a stray buffer: no-op.
        cache.pages.insert(1, vec![7u8; 512]);
        cache.page_states.insert(1, PageState::NotLoaded);
        cache.mark_page_dirty(1);
        assert_eq!(cache.page_state(1), PageState::NotLoaded);
    }

    #[test]
    fn dirty_page_images_only_full_content_pages() {
        let mut cache = create_test_cache();

        // Clean pages are skipped: they already match the ECU.
        assert!(cache.dirty_page_images().is_empty());

        // Full-size page with content, marked dirty like an MSQ import.
        cache.pages.insert(0, vec![7u8; 256]);
        cache.mark_page_dirty(0);
        let images = cache.dirty_page_images();
        assert_eq!(images.len(), 1);
        assert_eq!(images[0].0, 0);
        assert_eq!(images[0].1, vec![7u8; 256]);

        // Zero-filled dirty page is never returned.
        cache.pages.insert(1, vec![0u8; 512]);
        cache.page_states.insert(1, PageState::Dirty);
        cache.shadow.mark_dirty(1, 0, 512);
        let images = cache.dirty_page_images();
        assert_eq!(images.len(), 1);

        // Short image is never returned.
        cache.pages.insert(1, vec![7u8; 100]);
        let images = cache.dirty_page_images();
        assert_eq!(images.len(), 1);
    }
}
