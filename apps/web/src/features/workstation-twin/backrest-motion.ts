import type { ChairErgonomics } from "@ergopilot/contracts";
import { MathUtils } from "three";

export function backrestTargetAngle(
  chair: ChairErgonomics,
  elapsedSeconds: number,
) {
  const baseAngle = MathUtils.degToRad(chair.reclineAngleDeg - 90);
  if (chair.reclineLocked) return baseAngle;

  const compliance = (100 - chair.reclineResistancePercent) / 100;
  const loadDeflection = Math.sin(elapsedSeconds * 1.4) * 1.5 * compliance;
  return baseAngle + MathUtils.degToRad(loadDeflection);
}

export function backrestResponseRate(chair: ChairErgonomics) {
  if (chair.reclineLocked) return 12;
  return 2 + ((100 - chair.reclineResistancePercent) / 100) * 5;
}
