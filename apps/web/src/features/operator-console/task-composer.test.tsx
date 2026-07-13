// @vitest-environment jsdom

import {
  defaultWorkstationSnapshotFields,
  type SaveWorkstationProfileRequest,
  type TaskSpec,
  type WorkstationSnapshot,
} from "@ergopilot/contracts";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TaskComposer } from "./task-composer";

const snapshot: WorkstationSnapshot = {
  ...defaultWorkstationSnapshotFields,
  schemaVersion: 1,
  stationId: "station-1",
  stateVersion: 1,
  observedAtMs: 1_000,
  deskHeightMm: 720,
  movementCount: 0,
};

afterEach(cleanup);

describe("TaskComposer", () => {
  it("turns a named mode into the same four-step task used by Chat", async () => {
    const onSubmit = vi.fn<(task: TaskSpec) => Promise<void>>(
      async () => undefined,
    );
    render(
      <TaskComposer
        snapshot={snapshot}
        profiles={[]}
        onSubmit={onSubmit}
        onSaveProfile={vi.fn()}
        isPending={false}
        isSaving={false}
        error={null}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Apply Nap preset" }));
    fireEvent.click(screen.getByRole("button", { name: "Create profile run" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    const task = onSubmit.mock.calls[0]?.[0];
    expect(task?.steps).toHaveLength(4);
    expect(task?.steps[1]?.action).toMatchObject({
      type: "chair.adjust_ergonomics",
      input: { reclineAngleDeg: 135 },
    });
    expect(task?.steps[2]?.action).toEqual({
      type: "light.configure",
      input: { brightnessPercent: 22, colorTemperatureK: 2_900 },
    });
  });

  it("saves the current complete configuration as station memory", async () => {
    const onSaveProfile = vi.fn<
      (profile: SaveWorkstationProfileRequest) => Promise<void>
    >(async () => undefined);
    render(
      <TaskComposer
        snapshot={snapshot}
        profiles={[]}
        onSubmit={vi.fn()}
        onSaveProfile={onSaveProfile}
        isPending={false}
        isSaving={false}
        error={null}
      />,
    );

    fireEvent.change(screen.getByLabelText("Preset name"), {
      target: { value: "My reading mode" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Save current preset" }),
    );

    await waitFor(() => expect(onSaveProfile).toHaveBeenCalledOnce());
    expect(onSaveProfile.mock.calls[0]?.[0]).toMatchObject({
      name: "My reading mode",
      configuration: { deskHeightMm: 720 },
    });
  });
});
