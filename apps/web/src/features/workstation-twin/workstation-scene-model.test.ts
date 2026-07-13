import { describe, expect, it } from "vitest";

import {
  deskFrameGeometry,
  lampLightState,
  temperatureColor,
} from "./workstation-scene-model";

describe("workstation scene model", () => {
  it.each([
    620, 720, 1_280,
  ])("keeps telescoping desk columns attached at %i mm", (heightMm) => {
    const geometry = deskFrameGeometry(heightMm);

    expect(
      geometry.innerColumnCenterY + geometry.innerColumnHeight / 2,
    ).toBeCloseTo(geometry.tabletopBottomY);
    expect(
      geometry.innerColumnCenterY - geometry.innerColumnHeight / 2,
    ).toBeCloseTo(0.95);
    expect(geometry.outerColumnTopY).toBeLessThanOrEqual(
      geometry.tabletopBottomY,
    );
  });

  it("turns the modeled lamp fully off at zero brightness", () => {
    expect(lampLightState(0)).toEqual({
      lightIntensity: 0,
      emissiveIntensity: 0,
    });
    expect(lampLightState(50).lightIntensity).toBeGreaterThan(0);
    expect(lampLightState(50).emissiveIntensity).toBeGreaterThan(0);
  });

  it("maps the full color-temperature range continuously", () => {
    const colors = [2_700, 3_200, 4_300, 5_400, 6_500].map(temperatureColor);

    expect(new Set(colors).size).toBe(colors.length);
    expect(colors.every((color) => /^#[0-9a-f]{6}$/i.test(color))).toBe(true);
  });
});
