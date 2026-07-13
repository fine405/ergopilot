import {
  defaultWorkstationSnapshotFields,
  taskSpecSchema,
  type WorkstationSnapshot,
} from "@ergopilot/contracts";
import { describe, expect, it } from "vitest";

import {
  buildWorkstationProfileTask,
  builtInWorkstationPresets,
  configurationFromSnapshot,
} from "./workstation-profile";

describe("workstation profiles", () => {
  it("keeps all built-in modes inside the runtime contract", () => {
    for (const preset of builtInWorkstationPresets) {
      const task = buildWorkstationProfileTask({
        taskId: `task-${preset.id}`,
        requestedBy: "user-1",
        durationMinutes: 45,
        configuration: preset.configuration,
      });

      expect(taskSpecSchema.parse(task).steps).toHaveLength(4);
    }
  });

  it("captures the complete verified state for custom preset memory", () => {
    const snapshot: WorkstationSnapshot = {
      ...defaultWorkstationSnapshotFields,
      schemaVersion: 1,
      stationId: "station-1",
      stateVersion: 3,
      observedAtMs: 1_000,
      deskHeightMm: 760,
      seatDepthMm: 480,
      reclineAngleDeg: 125,
      lightBrightnessPercent: 40,
      reminderIntervalMinutes: 30,
      movementCount: 2,
    };

    expect(configurationFromSnapshot(snapshot)).toMatchObject({
      deskHeightMm: 760,
      chair: { seatDepthMm: 480, reclineAngleDeg: 125 },
      light: { brightnessPercent: 40 },
      reminder: { intervalMinutes: 30 },
    });
  });
});
