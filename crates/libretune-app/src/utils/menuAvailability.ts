import type { BackendMenuItem } from "../types/app";

export interface MenuItemAvailability {
  disabled: boolean;
  disabledReason?: string;
}

export interface ProcessedMenuNode {
  item: BackendMenuItem;
  availability: MenuItemAvailability;
  children?: ProcessedMenuNode[];
}

function isSelfActive(item: BackendMenuItem): boolean {
  return item.visible !== false && item.enabled !== false;
}

function hasAvailabilityCondition(item: BackendMenuItem): boolean {
  return !!(
    item.visibility_condition?.trim() ||
    item.enabled_condition?.trim() ||
    item.condition?.trim()
  );
}

function selfDisabledReason(item: BackendMenuItem): string | undefined {
  if (item.visible === false && item.visibility_condition) {
    return `Condition not met: ${item.visibility_condition}`;
  }
  if (item.enabled === false && item.enabled_condition) {
    return `Condition not met: ${item.enabled_condition}`;
  }
  if (!isSelfActive(item) && hasAvailabilityCondition(item)) {
    return "Not available with current ECU settings";
  }
  return undefined;
}

function resolveDisabled(
  ancestorInactive: boolean,
  cascadeInactive: boolean,
  selfActive: boolean,
  inheritedReason?: string,
  cascadeReason?: string,
  selfReason?: string,
): MenuItemAvailability {
  if (ancestorInactive) {
    return {
      disabled: true,
      disabledReason: inheritedReason || "Parent menu is not available",
    };
  }
  if (cascadeInactive) {
    return {
      disabled: true,
      disabledReason: cascadeReason || "Previous menu item is not available",
    };
  }
  if (!selfActive) {
    return {
      disabled: true,
      disabledReason: selfReason || "Not available with current ECU settings",
    };
  }
  return { disabled: false };
}

/**
 * Apply TunerStudio-style menu availability to a sibling list:
 * - inactive ancestors disable all descendants
 * - when a conditional item is inactive, subsequent siblings are grayed until
 *   a separator or SubMenu group boundary
 */
export function processMenuAvailability(
  items: BackendMenuItem[],
  ancestorInactive = false,
  inheritedReason?: string,
): ProcessedMenuNode[] {
  let cascadeInactive = false;
  let cascadeReason: string | undefined;
  const result: ProcessedMenuNode[] = [];

  for (const item of items) {
    if (item.type === "Separator") {
      cascadeInactive = false;
      cascadeReason = undefined;
      result.push({
        item,
        availability: { disabled: false },
      });
      continue;
    }

    const selfActive = isSelfActive(item);
    const selfReason = selfDisabledReason(item);

    if (item.type === "SubMenu") {
      const parentInactive = ancestorInactive || cascadeInactive || !selfActive;
      const parentReason = ancestorInactive
        ? inheritedReason
        : cascadeInactive
          ? cascadeReason
          : selfReason;

      const availability = resolveDisabled(
        ancestorInactive,
        cascadeInactive,
        selfActive,
        inheritedReason,
        cascadeReason,
        selfReason,
      );

      const children = item.items
        ? processMenuAvailability(item.items, parentInactive, parentReason)
        : undefined;

      result.push({
        item,
        availability,
        children,
      });

      cascadeInactive = false;
      cascadeReason = undefined;
      continue;
    }

    const availability = resolveDisabled(
      ancestorInactive,
      cascadeInactive,
      selfActive,
      inheritedReason,
      cascadeReason,
      selfReason,
    );

    result.push({ item, availability });

    // Cascade only when an enabled_condition evaluated to false — not for visibility-only
    // or missing context, so one inactive item does not gray out an entire menu section.
    if (
      !ancestorInactive
      && item.enabled === false
      && item.enabled_condition?.trim()
    ) {
      cascadeInactive = true;
      cascadeReason = selfReason || "Not available with current ECU settings";
    }
  }

  return result;
}
