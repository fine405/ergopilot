import type { DeviceAction } from "@ergopilot/contracts";

export function presentDeviceAction(action: DeviceAction) {
  if (action.type === "desk.move_to_height") {
    const target = `${action.input.heightMm} mm`;
    return {
      capabilityId: action.type,
      target,
      goal: "Focus session",
      approvalSummary: `The runtime is ready to move the simulated desk to ${target}.`,
      pendingSummary: `Move the simulated desk from its current state to ${target}.`,
      authorizationTitle: "Authorize desk motion?",
      scopeTarget: `target height ${target}`,
      executionTitle: "Desk motion executing",
      executionSummary:
        "Progress is streamed from the Rust device adapter, not inferred by the model.",
      verifiedState: "requested desk height",
    };
  }

  const target = `${action.input.levelPercent}%`;
  return {
    capabilityId: action.type,
    target,
    goal: "Seated support",
    approvalSummary: `The runtime is ready to adjust the simulated chair lumbar support to ${target}.`,
    pendingSummary: `Adjust the simulated chair lumbar support from its current state to ${target}.`,
    authorizationTitle: "Authorize chair lumbar support?",
    scopeTarget: `target level ${target}`,
    executionTitle: "Chair adjustment executing",
    executionSummary:
      "The Rust device adapter owns the adjustment and authoritative readback.",
    verifiedState: "requested lumbar support level",
  };
}
