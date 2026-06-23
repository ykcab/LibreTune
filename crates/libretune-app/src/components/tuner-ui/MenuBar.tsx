import { useState, useRef, useEffect, useCallback, useLayoutEffect, KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Check } from 'lucide-react';
import { MenuItem } from './TunerLayout';
import './MenuBar.css';

interface MenuBarProps {
  items: MenuItem[];
}

export function MenuBar({ items }: MenuBarProps) {
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const [dropdownAnchor, setDropdownAnchor] = useState<DOMRect | null>(null);
  const menuBarRef = useRef<HTMLDivElement>(null);
  const dropdownPortalRef = useRef<HTMLDivElement>(null);
  const buttonRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  const openMenu = useCallback((item: MenuItem, index: number) => {
    const btn = buttonRefs.current.get(item.id);
    setOpenMenuId(item.id);
    setFocusedIndex(index);
    setDropdownAnchor(btn?.getBoundingClientRect() ?? null);
  }, []);

  const closeMenu = useCallback(() => {
    setOpenMenuId(null);
    setFocusedIndex(-1);
    setDropdownAnchor(null);
  }, []);

  useLayoutEffect(() => {
    if (!openMenuId) return;
    const btn = buttonRefs.current.get(openMenuId);
    if (!btn) return;

    const updateAnchor = () => setDropdownAnchor(btn.getBoundingClientRect());
    updateAnchor();
    window.addEventListener('resize', updateAnchor);
    window.addEventListener('scroll', updateAnchor, true);
    return () => {
      window.removeEventListener('resize', updateAnchor);
      window.removeEventListener('scroll', updateAnchor, true);
    };
  }, [openMenuId]);

  // Parse accelerator from label (e.g., "&File" -> { label: "File", accelerator: "F" })
  const parseLabel = (label: string) => {
    const match = label.match(/&(.)/);
    if (match) {
      const char = match[1];
      const parts = label.split('&' + char);
      return {
        before: parts[0],
        accelerator: char,
        after: parts.slice(1).join(char),
      };
    }
    return { before: label, accelerator: null, after: '' };
  };

  // Close menu when clicking outside (include portaled dropdown)
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (menuBarRef.current?.contains(target)) return;
      if (dropdownPortalRef.current?.contains(target)) return;
      closeMenu();
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [closeMenu]);

  // Handle Alt+key accelerators
  useEffect(() => {
    const handleKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.altKey && !e.ctrlKey && !e.metaKey) {
        const key = e.key.toLowerCase();
        const index = items.findIndex((item) => {
          const parsed = parseLabel(item.label);
          return parsed.accelerator?.toLowerCase() === key;
        });
        if (index !== -1) {
          e.preventDefault();
          openMenu(items[index], index);
        }
      }
      // Escape closes menu
      if (e.key === 'Escape' && openMenuId) {
        closeMenu();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [items, openMenuId, openMenu, closeMenu]);

  const handleMenuClick = (item: MenuItem, index: number) => {
    if (openMenuId === item.id) {
      closeMenu();
    } else {
      openMenu(item, index);
    }
  };

  const handleMenuHover = (item: MenuItem, index: number) => {
    if (openMenuId !== null) {
      openMenu(item, index);
    }
  };

  const handleMenuKeyDown = (e: KeyboardEvent, index: number) => {
    switch (e.key) {
      case 'ArrowRight':
        e.preventDefault();
        const nextIndex = (index + 1) % items.length;
        if (openMenuId) {
          openMenu(items[nextIndex], nextIndex);
        } else {
          setFocusedIndex(nextIndex);
        }
        break;
      case 'ArrowLeft':
        e.preventDefault();
        const prevIndex = (index - 1 + items.length) % items.length;
        if (openMenuId) {
          openMenu(items[prevIndex], prevIndex);
        } else {
          setFocusedIndex(prevIndex);
        }
        break;
      case 'ArrowDown':
      case 'Enter':
      case ' ':
        e.preventDefault();
        openMenu(items[index], index);
        break;
    }
  };

  const openMenuItem = items.find((item) => item.id === openMenuId);
  const portaledDropdown =
    openMenuItem?.items && openMenuItem.items.length > 0 && dropdownAnchor
      ? createPortal(
          <div
            ref={dropdownPortalRef}
            className="menu-dropdown-portal"
            style={{ top: dropdownAnchor.bottom, left: dropdownAnchor.left }}
          >
            <MenuDropdown
              items={openMenuItem.items}
              onClose={closeMenu}
              onDismissAll={closeMenu}
              parentLabel={openMenuItem.label}
            />
          </div>,
          document.body,
        )
      : null;

  return (
    <>
    <div className="menubar" ref={menuBarRef} role="menubar">
      {items.map((item, index) => {
        const parsed = parseLabel(item.label);
        const isOpen = openMenuId === item.id;
        
        return (
          <div key={item.id} className="menubar-item-wrapper">
            <button
              ref={(el) => {
                if (el) buttonRefs.current.set(item.id, el);
                else buttonRefs.current.delete(item.id);
              }}
              className={`menubar-item ${isOpen ? 'menubar-item-open' : ''} ${
                focusedIndex === index ? 'menubar-item-focused' : ''
              }`}
              onClick={() => handleMenuClick(item, index)}
              onMouseEnter={() => handleMenuHover(item, index)}
              onKeyDown={(e) => handleMenuKeyDown(e, index)}
              role="menuitem"
              aria-haspopup={!!item.items?.length}
              aria-expanded={isOpen}
            >
              {parsed.before}
              {parsed.accelerator && (
                <span className="menubar-accelerator">{parsed.accelerator}</span>
              )}
              {parsed.after}
            </button>
          </div>
        );
      })}
    </div>
    {portaledDropdown}
    </>
  );
}

interface MenuDropdownProps {
  items: MenuItem[];
  onClose: () => void;
  onDismissAll: () => void;
  parentLabel: string;
  level?: number;
}

function MenuDropdown({ items, onClose, onDismissAll, level = 0 }: MenuDropdownProps) {
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [openSubmenuId, setOpenSubmenuId] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Focus first item on mount
  useEffect(() => {
    const firstFocusable = items.findIndex(
      (item) => !item.separator && !item.disabled
    );
    setFocusedIndex(firstFocusable >= 0 ? firstFocusable : 0);
  }, [items]);

  const handleItemClick = (item: MenuItem) => {
    if (item.disabled || item.separator) return;
    
    if (item.items && item.items.length > 0) {
      setOpenSubmenuId(openSubmenuId === item.id ? null : item.id);
    } else if (item.onClick) {
      item.onClick();
      onDismissAll();
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    const focusableItems = items
      .map((item, i) => ({ item, index: i }))
      .filter(({ item }) => !item.separator && !item.disabled);

    const currentFocusableIndex = focusableItems.findIndex(
      ({ index }) => index === focusedIndex
    );

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        e.stopPropagation();
        const nextIndex =
          (currentFocusableIndex + 1) % focusableItems.length;
        setFocusedIndex(focusableItems[nextIndex].index);
        break;
      case 'ArrowUp':
        e.preventDefault();
        e.stopPropagation();
        const prevIndex =
          (currentFocusableIndex - 1 + focusableItems.length) %
          focusableItems.length;
        setFocusedIndex(focusableItems[prevIndex].index);
        break;
      case 'ArrowRight':
        e.stopPropagation();
        const currentItem = items[focusedIndex];
        if (currentItem?.items && currentItem.items.length > 0) {
          e.preventDefault();
          setOpenSubmenuId(currentItem.id);
        }
        break;
      case 'ArrowLeft':
        e.stopPropagation();
        if (level > 0) {
          e.preventDefault();
          onClose();
        }
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        e.stopPropagation();
        handleItemClick(items[focusedIndex]);
        break;
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        onClose();
        break;
    }
  };

  // Parse accelerator and shortcut from menu item
  const parseMenuItem = (label: string) => {
    // Check for shortcut (e.g., "Save\tCtrl+S")
    const [text, shortcut] = label.split('\t');
    const parsed = parseAccelerator(text);
    return { ...parsed, shortcut };
  };

  const parseAccelerator = (label: string) => {
    const match = label.match(/&(.)/);
    if (match) {
      const char = match[1];
      const parts = label.split('&' + char);
      return {
        before: parts[0],
        accelerator: char,
        after: parts.slice(1).join(char),
      };
    }
    return { before: label, accelerator: null, after: '' };
  };

  return (
    <div
      className={`menu-dropdown menu-dropdown-level-${level}`}
      ref={dropdownRef}
      role="menu"
      onKeyDown={handleKeyDown}
      tabIndex={-1}
    >
      {items.map((item, index) => {
        if (item.separator) {
          return <div key={`sep-${index}`} className="menu-separator" role="separator" />;
        }

        const parsed = parseMenuItem(item.label);
        const hasSubmenu = item.items && item.items.length > 0;
        const isOpen = openSubmenuId === item.id;

        return (
          <div key={item.id} className="menu-item-wrapper">
            <button
              className={`menu-item ${
                focusedIndex === index ? 'menu-item-focused' : ''
              } ${item.disabled ? 'menu-item-disabled' : ''} ${
                item.checked ? 'menu-item-checked' : ''
              }`}
              onClick={() => handleItemClick(item)}
              onMouseEnter={() => {
                setFocusedIndex(index);
                if (hasSubmenu) {
                  setOpenSubmenuId(item.id);
                } else {
                  setOpenSubmenuId(null);
                }
              }}
              disabled={item.disabled}
              title={item.disabled ? item.disabledReason || "Not available" : undefined}
              role="menuitem"
              aria-haspopup={hasSubmenu}
              aria-expanded={isOpen}
            >
              <span className="menu-item-check">
                {item.checked && <Check size={12} />}
              </span>
              <span className="menu-item-label">
                {parsed.before}
                {parsed.accelerator && (
                  <span className="menu-item-accelerator">{parsed.accelerator}</span>
                )}
                {parsed.after}
              </span>
              {parsed.shortcut && (
                <span className="menu-item-shortcut">{parsed.shortcut}</span>
              )}
              {hasSubmenu && (
                <span className="menu-item-arrow">▶</span>
              )}
            </button>
            
            {isOpen && hasSubmenu && (
              <MenuDropdown
                items={item.items!}
                onClose={() => setOpenSubmenuId(null)}
                onDismissAll={onDismissAll}
                parentLabel={item.label}
                level={level + 1}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
