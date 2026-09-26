/** Small browser-detection helpers for support notes (never used for feature gating). */

function userAgent(): string {
  try {
    return globalThis.navigator?.userAgent ?? '';
  } catch {
    return '';
  }
}

/** Google Chrome (not Edge / Opera / Samsung…): its speech recognizer needs Google servers. */
export function isGoogleChrome(ua: string = userAgent()): boolean {
  return /Chrome\/\d/.test(ua) && !/(Edg|OPR|SamsungBrowser|YaBrowser|QQBrowser|UCBrowser|MicroMessenger)\//.test(ua);
}

export function isMicrosoftEdge(ua: string = userAgent()): boolean {
  return /Edg\/\d/.test(ua);
}

/** Microphone access needs a secure context (https or localhost). */
export function isSecureForMic(): boolean {
  try {
    return globalThis.isSecureContext !== false;
  } catch {
    return true;
  }
}
