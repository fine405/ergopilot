import {
  type ChairErgonomics,
  defaultChairErgonomics,
  type TaskSpec,
  type WorkstationConfiguration,
  type WorkstationSnapshot,
} from "@ergopilot/contracts";

export interface WorkstationPreset {
  id: string;
  name: string;
  description: string;
  configuration: WorkstationConfiguration;
}

const officeChair: ChairErgonomics = {
  ...defaultChairErgonomics,
  lumbarSupportPercent: 55,
  reclineResistancePercent: 65,
  headrestHeightMm: 55,
};

export const builtInWorkstationPresets: WorkstationPreset[] = [
  {
    id: "builtin-office",
    name: "Office",
    description: "Upright support, neutral daylight and a 45 minute reminder.",
    configuration: {
      deskHeightMm: 740,
      chair: officeChair,
      light: { brightnessPercent: 78, colorTemperatureK: 4_800 },
      reminder: { enabled: true, intervalMinutes: 45 },
    },
  },
  {
    id: "builtin-nap",
    name: "Nap",
    description: "Deep recline, warm low light and reminders paused.",
    configuration: {
      deskHeightMm: 680,
      chair: {
        ...officeChair,
        seatDepthMm: 470,
        lumbarSupportPercent: 35,
        armrestHeightMm: 220,
        armrestDepthMm: 20,
        reclineAngleDeg: 135,
        reclineResistancePercent: 15,
        reclineLocked: true,
        headrestHeightMm: 85,
        headrestAngleDeg: 15,
      },
      light: { brightnessPercent: 22, colorTemperatureK: 2_900 },
      reminder: { enabled: false, intervalMinutes: 45 },
    },
  },
  {
    id: "builtin-standing",
    name: "Standing",
    description:
      "Raised desk, cool task light and a shorter movement interval.",
    configuration: {
      deskHeightMm: 1_080,
      chair: officeChair,
      light: { brightnessPercent: 88, colorTemperatureK: 5_200 },
      reminder: { enabled: true, intervalMinutes: 30 },
    },
  },
];

export function configurationFromSnapshot(
  snapshot: WorkstationSnapshot,
): WorkstationConfiguration {
  return {
    deskHeightMm: snapshot.deskHeightMm,
    chair: {
      seatHeightMm: snapshot.seatHeightMm,
      seatDepthMm: snapshot.seatDepthMm,
      lumbarSupportPercent: snapshot.lumbarSupportPercent,
      armrestHeightMm: snapshot.armrestHeightMm,
      armrestDepthMm: snapshot.armrestDepthMm,
      armrestWidthMm: snapshot.armrestWidthMm,
      armrestAngleDeg: snapshot.armrestAngleDeg,
      reclineAngleDeg: snapshot.reclineAngleDeg,
      reclineResistancePercent: snapshot.reclineResistancePercent,
      reclineLocked: snapshot.reclineLocked,
      headrestHeightMm: snapshot.headrestHeightMm,
      headrestAngleDeg: snapshot.headrestAngleDeg,
    },
    light: {
      brightnessPercent: snapshot.lightBrightnessPercent,
      colorTemperatureK: snapshot.lightColorTemperatureK,
    },
    reminder: {
      enabled: snapshot.reminderEnabled,
      intervalMinutes: snapshot.reminderIntervalMinutes,
    },
  };
}

interface BuildWorkstationProfileTaskInput {
  taskId: string;
  requestedBy: string;
  durationMinutes: number;
  configuration: WorkstationConfiguration;
}

export function buildWorkstationProfileTask(
  input: BuildWorkstationProfileTaskInput,
): TaskSpec {
  return {
    schemaVersion: 1,
    taskId: input.taskId,
    goal: "restore_profile",
    requestedBy: input.requestedBy,
    constraints: {
      durationMinutes: input.durationMinutes,
      interruptionPolicy: "normal",
    },
    assumptions: ["Desk movement area is clear"],
    steps: [
      {
        stepId: "desk-1",
        action: {
          type: "desk.move_to_height",
          input: { heightMm: input.configuration.deskHeightMm },
        },
      },
      {
        stepId: "chair-1",
        action: {
          type: "chair.adjust_ergonomics",
          input: input.configuration.chair,
        },
      },
      {
        stepId: "light-1",
        action: {
          type: "light.configure",
          input: input.configuration.light,
        },
      },
      {
        stepId: "reminder-1",
        action: {
          type: "reminder.configure",
          input: input.configuration.reminder,
        },
      },
    ],
  };
}
