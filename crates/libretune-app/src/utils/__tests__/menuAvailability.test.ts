import { describe, expect, it } from "vitest";
import { processMenuAvailability } from "../menuAvailability";
import type { BackendMenuItem } from "../../types/app";

function leaf(
  target: string,
  label: string,
  opts?: Partial<BackendMenuItem>,
): BackendMenuItem {
  return {
    type: "Dialog",
    target,
    label,
    visible: true,
    enabled: true,
    ...opts,
  };
}

function group(label: string, children: BackendMenuItem[], opts?: Partial<BackendMenuItem>): BackendMenuItem {
  return {
    type: "SubMenu",
    label,
    items: children,
    visible: true,
    enabled: true,
    ...opts,
  };
}

describe("processMenuAvailability", () => {
  it("disables descendants when a group menu is inactive", () => {
    const items: BackendMenuItem[] = [
      group(
        "Injector Setup",
        [leaf("injectorConfig", "Injection configuration"), leaf("injectionSettings", "Injection hardware")],
        { enabled: false, enabled_condition: "isInjectionEnabled == 1" },
      ),
    ];

    const [groupNode] = processMenuAvailability(items);
    expect(groupNode.availability.disabled).toBe(true);
    expect(groupNode.children?.[0].availability.disabled).toBe(true);
    expect(groupNode.children?.[1].availability.disabled).toBe(true);
  });

  it("cascades disable to subsequent siblings until separator", () => {
    const items: BackendMenuItem[] = [
      leaf("fuelTrimTbl1", "Fuel trim cyl 1"),
      leaf("fuelTrimTbl2", "Fuel trim cyl 2", {
        enabled: false,
        enabled_condition: "cylindersCount >= 2",
      }),
      leaf("fuelTrimTbl3", "Fuel trim cyl 3"),
      { type: "Separator" },
      leaf("stagedInjection", "Staged Injector Settings"),
    ];

    const result = processMenuAvailability(items);
    expect(result[0].availability.disabled).toBe(false);
    expect(result[1].availability.disabled).toBe(true);
    expect(result[2].availability.disabled).toBe(true);
    expect(result[3].availability.disabled).toBe(false);
    expect(result[4].availability.disabled).toBe(false);
  });

  it("resets cascade after a SubMenu group", () => {
    const items: BackendMenuItem[] = [
      group("Limits", [leaf("limits", "Limits")], {
        enabled: false,
        enabled_condition: "uiMode == 0",
      }),
      leaf("triggerConfiguration", "Trigger"),
    ];

    const result = processMenuAvailability(items);
    expect(result[0].availability.disabled).toBe(true);
    expect(result[1].availability.disabled).toBe(false);
  });

  it("does not cascade when only visibility is false", () => {
    const items: BackendMenuItem[] = [
      leaf("first", "First"),
      leaf("second", "Second", {
        visible: false,
        visibility_condition: "featureEnabled == 1",
        enabled: true,
      }),
      leaf("third", "Third"),
    ];

    const result = processMenuAvailability(items);
    expect(result[0].availability.disabled).toBe(false);
    expect(result[1].availability.disabled).toBe(true);
    expect(result[2].availability.disabled).toBe(false);
  });
});
