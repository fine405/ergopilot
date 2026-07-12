import type { TaskRunView } from "@ergopilot/contracts";
import { describe, expect, it } from "vitest";

import { mergeTimeline } from "./run-timeline";

describe("mergeTimeline", () => {
  it("places station evidence between dispatch and the task terminal event", () => {
    const taskEvents: TaskRunView["events"] = [
      { sequence: 1, eventType: "run_started", atMs: 1_000 },
      { sequence: 2, eventType: "command_dispatched", atMs: 1_100 },
      { sequence: 3, eventType: "run_completed", atMs: 1_100 },
    ];
    const commandEvents: TaskRunView["commandEvents"] = [
      {
        sequence: 1,
        commandId: "cmd-1",
        eventType: "accepted",
        atMs: 1_100,
      },
      {
        sequence: 2,
        commandId: "cmd-1",
        eventType: "verified_succeeded",
        atMs: 1_100,
      },
    ];

    expect(
      mergeTimeline(taskEvents, commandEvents).map(
        (item) => `${item.source}:${item.event.eventType}`,
      ),
    ).toEqual([
      "task:run_started",
      "task:command_dispatched",
      "station:accepted",
      "station:verified_succeeded",
      "task:run_completed",
    ]);
  });
});
