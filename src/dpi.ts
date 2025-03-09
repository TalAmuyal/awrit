export const dpi_scale = {
  current: undefined as number | undefined,
};
export function scaleSize<T extends { width: number; height: number }>(
  size: T,
  scale = dpi_scale.current ?? 1,
): T {
  const { width, height, ...rest } = size;
  return {
    width: Math.floor(width / scale),
    height: Math.floor(height / scale),
    ...rest,
  } as T;
}

export function unscaleSize<T extends { width: number; height: number }>(
  size: T,
  scale = dpi_scale.current ?? 1,
): T {
  const { width, height, ...rest } = size;
  return {
    width: Math.ceil(width * scale),
    height: Math.ceil(height * scale),
    ...rest,
  } as T;
}
