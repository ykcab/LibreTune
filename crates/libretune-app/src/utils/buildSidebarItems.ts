import type { SidebarNode } from "../components/tuner-ui";
import type { BackendMenuItem } from "../types/app";
import { processMenuAvailability, type ProcessedMenuNode } from "./menuAvailability";

export type SidebarNodeWithType = SidebarNode & { itemType?: string };

function processedNodeToSidebar(
  node: ProcessedMenuNode,
  prefix: string,
  idx: number,
): SidebarNodeWithType | null {
  const { item, availability, children } = node;

  if (item.type === "Separator") {
    return null;
  }

  const disabled = availability.disabled;
  const disabledReason = availability.disabledReason;

  if (item.type === "SubMenu") {
    const childNodes = (children ?? [])
      .map((child, childIdx) => processedNodeToSidebar(child, `${prefix}-${idx}`, childIdx))
      .filter((n): n is SidebarNodeWithType => n !== null);

    return {
      id: `${prefix}-submenu-${idx}`,
      label: item.label || "",
      type: "folder" as const,
      children: childNodes,
      disabled,
      disabledReason,
    };
  }

  let nodeType: string = "dialog";
  if (item.type === "Table") {
    nodeType = "table";
  } else if (item.type === "Help") {
    nodeType = "help";
  }

  return {
    id: item.target || `${prefix}-${idx}`,
    label: item.label || "",
    type: nodeType as "table" | "dialog" | "help",
    itemType: item.type,
    disabled,
    disabledReason,
  };
}

/**
 * Recursively converts backend menu items into sidebar tree nodes.
 * Handles SubMenu, Table, Dialog, Std, Help types and propagates
 * visibility/enabled state from condition evaluation.
 */
export function buildSidebarItems(items: BackendMenuItem[], prefix: string): SidebarNodeWithType[] {
  return processMenuAvailability(items)
    .map((node, idx) => processedNodeToSidebar(node, prefix, idx))
    .filter((n): n is SidebarNodeWithType => n !== null);
}
