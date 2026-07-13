const tabletopHalfHeight = 0.07;
const innerColumnBottomY = 0.95;
const outerColumnBottomY = 0.07;
const outerColumnTopY = 1.15;

export function deskFrameGeometry(heightMm: number) {
  const tabletopBottomY = sceneHeight(heightMm) - tabletopHalfHeight;
  const innerColumnHeight = Math.max(
    0.02,
    tabletopBottomY - innerColumnBottomY,
  );
  return {
    tabletopBottomY,
    outerColumnTopY,
    outerColumnHeight: outerColumnTopY - outerColumnBottomY,
    outerColumnCenterY: (outerColumnBottomY + outerColumnTopY) / 2,
    innerColumnHeight,
    innerColumnCenterY: innerColumnBottomY + innerColumnHeight / 2,
  };
}

export function lampLightState(brightnessPercent: number) {
  return {
    lightIntensity: (brightnessPercent / 100) * 3.2,
    emissiveIntensity: (brightnessPercent / 100) * 2,
  };
}

export function temperatureColor(temperatureK: number) {
  const temperature = temperatureK / 100;
  const red = 255;
  const green = 99.470_802_586_1 * Math.log(temperature) - 161.119_568_166_1;
  const blue =
    138.517_731_223_1 * Math.log(temperature - 10) - 305.044_792_730_7;

  return `#${[red, green, blue].map(colorChannel).join("")}`;
}

export function sceneHeight(heightMm: number) {
  return heightMm / 500;
}

function colorChannel(value: number) {
  return Math.round(value).toString(16).padStart(2, "0");
}
