/**
 * Decision helper for Android hardware back button listener (rule U1).
 * In React Native, BackHandler is Android-only; on web and iOS it does not exist
 * or throws "BackHandler is not supported on web and should not be used."
 */
export function shouldListenForHardwareBack(os: string): boolean {
  return os === 'android';
}

