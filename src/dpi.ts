export const DPI_SCALE = 1.25;

export function scaleSize<T extends { width: number; height: number }>(
  size: T,
  scale = DPI_SCALE,
): T {
  const { width, height, ...rest } = size;
  return {
    width: Math.floor(width / scale),
    height: Math.floor(height / scale),
    ...rest,
  } as T;
}
