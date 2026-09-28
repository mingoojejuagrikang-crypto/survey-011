/** UA versions freeze on iOS; device tokens and touch-capable desktop iPad UA do not. */
export function isIOSDevice(device: { userAgent: string; maxTouchPoints: number } | undefined =
  typeof navigator === 'undefined' ? undefined : navigator): boolean {
  return !!device && (/iPhone|iPad|iPod/i.test(device.userAgent) ||
    (/Macintosh/i.test(device.userAgent) && device.maxTouchPoints > 1));
}

export const HYBRID_DEFER_MS = 5_000;
export function hybridPolicy(option: boolean, ios = isIOSDevice()) {
  return { platform: ios ? 'ios' as const : 'other' as const, option, enabled: ios || option };
}
