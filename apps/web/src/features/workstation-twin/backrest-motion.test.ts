import {
  type ChairErgonomics,
  defaultChairErgonomics,
} from "@ergopilot/contracts";
import { describe, expect, it } from "vitest";

import { backrestResponseRate, backrestTargetAngle } from "./backrest-motion";

describe("backrest motion", () => {
  it("holds the configured angle when locked", () => {
    const chair = { ...defaultChairErgonomics, reclineLocked: true };

    expect(backrestTargetAngle(chair, 0)).toBe(backrestTargetAngle(chair, 10));
  });

  it("makes an unlocked low-resistance backrest more compliant", () => {
    const lowResistance: ChairErgonomics = {
      ...defaultChairErgonomics,
      reclineLocked: false,
      reclineResistancePercent: 10,
    };
    const highResistance: ChairErgonomics = {
      ...lowResistance,
      reclineResistancePercent: 90,
    };
    const elapsedSeconds = Math.PI / (2 * 1.4);
    const baseline = backrestTargetAngle(
      { ...lowResistance, reclineLocked: true },
      elapsedSeconds,
    );

    expect(
      backrestTargetAngle(lowResistance, elapsedSeconds) - baseline,
    ).toBeGreaterThan(
      backrestTargetAngle(highResistance, elapsedSeconds) - baseline,
    );
    expect(backrestResponseRate(lowResistance)).toBeGreaterThan(
      backrestResponseRate(highResistance),
    );
  });
});
