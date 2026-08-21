export const normalizePrintIdentity = (
  value: string | number | undefined,
  zeroIsAbsent: boolean
): string | undefined => {
  const normalized = value === undefined ? "" : String(value).trim();
  return normalized && (!zeroIsAbsent || normalized !== "0") ? normalized : undefined;
};
