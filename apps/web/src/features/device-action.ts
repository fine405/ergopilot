import type { DeviceAction, TaskSpec } from "@ergopilot/contracts";

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

  if (action.type === "chair.set_lumbar_support") {
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

  if (action.type === "chair.adjust_ergonomics") {
    const target = `${action.input.seatHeightMm} mm seat · ${action.input.reclineAngleDeg}° recline`;
    return {
      capabilityId: action.type,
      target,
      goal: "Ergonomic chair",
      approvalSummary: `The runtime is ready to apply the complete chair posture (${target}).`,
      pendingSummary: `Adjust seat, lumbar support, armrests, recline and headrest to ${target}.`,
      authorizationTitle: "Authorize chair posture?",
      scopeTarget: target,
      executionTitle: "Chair posture executing",
      executionSummary:
        "The Rust adapter verifies every chair degree of freedom.",
      verifiedState: "requested ergonomic chair configuration",
    };
  }

  if (action.type === "light.configure") {
    const target = `${action.input.brightnessPercent}% · ${action.input.colorTemperatureK} K`;
    return {
      capabilityId: action.type,
      target,
      goal: "Task lighting",
      approvalSummary: `The runtime is ready to configure the task light to ${target}.`,
      pendingSummary: `Set task light brightness and color temperature to ${target}.`,
      authorizationTitle: "Authorize lighting change?",
      scopeTarget: target,
      executionTitle: "Lighting configuration executing",
      executionSummary: "The station owns the light state and readback.",
      verifiedState: "requested lighting configuration",
    };
  }

  const target = action.input.enabled
    ? `every ${action.input.intervalMinutes} min`
    : "paused";
  return {
    capabilityId: action.type,
    target,
    goal: "Sedentary reminder",
    approvalSummary: `The runtime is ready to set the movement reminder to ${target}.`,
    pendingSummary: `Configure the sedentary reminder as ${target}.`,
    authorizationTitle: "Authorize reminder change?",
    scopeTarget: target,
    executionTitle: "Reminder configuration executing",
    executionSummary: "The station persists the reminder schedule locally.",
    verifiedState: "requested reminder configuration",
  };
}

export function presentTask(task: Pick<TaskSpec, "steps">) {
  const actions = task.steps.map((step) => presentDeviceAction(step.action));
  if (actions.length === 1) {
    return { ...actions[0], actions };
  }

  const target = actions.map((action) => action.target).join(" → ");
  return {
    actions,
    capabilityId: "workstation.restore_profile",
    target,
    goal: "Workstation profile",
    approvalSummary: `The runtime is ready to execute ${actions.length} verified workstation steps in order.`,
    pendingSummary: actions.map((action) => action.target).join(" → "),
    authorizationTitle: "Authorize workstation profile?",
    scopeTarget: `ordered targets ${target}`,
    executionTitle: "Workstation profile executing",
    executionSummary:
      "The Rust runtime executes and verifies each device action in order.",
    verifiedState: "requested workstation profile",
  };
}
