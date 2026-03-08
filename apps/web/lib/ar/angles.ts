export function wrapAngle360(deg: number) {
  const v = deg % 360;
  return v < 0 ? v + 360 : v;
}

