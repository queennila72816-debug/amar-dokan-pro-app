export interface BrowserCompatibilityReport {
  supported: boolean;
  missingFeatures: string[];
  recommendedAction: string | null;
}

/**
 * Checks only essential runtime browser capabilities required by PROTIVA.
 * Supported modern & Windows 7 browsers (Chrome 88+/109, Edge 88+/109, Firefox 85+/115 ESR,
 * Safari 14+) pass all checks cleanly and do NOT trigger any banner.
 * Only genuinely incompatible/ancient browsers (e.g., Internet Explorer, Chrome <80, disabled storage)
 * surface a clear, non-blocking guidance banner.
 */
export function evaluateBrowserCompatibility(): BrowserCompatibilityReport {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return { supported: true, missingFeatures: [], recommendedAction: null };
  }

  const missingFeatures: string[] = [];

  const isCssCustomPropsSupported =
    typeof window.CSS !== 'undefined' &&
    typeof window.CSS.supports === 'function' &&
    window.CSS.supports('--adp-test', '0');

  if (!isCssCustomPropsSupported) {
    missingFeatures.push('CSS Custom Properties');
  }

  const isFlexAndGridSupported =
    typeof window.CSS !== 'undefined' &&
    typeof window.CSS.supports === 'function' &&
    window.CSS.supports('display', 'flex') &&
    window.CSS.supports('display', 'grid');

  if (!isFlexAndGridSupported) {
    missingFeatures.push('CSS Grid & Flexbox Layout');
  }

  if (typeof window.fetch !== 'function' || typeof window.Promise !== 'function') {
    missingFeatures.push('Modern Network & Async APIs (Fetch/Promise)');
  }

  if (
    typeof Intl === 'undefined' ||
    typeof Intl.NumberFormat !== 'function' ||
    typeof Object.entries !== 'function'
  ) {
    missingFeatures.push('Standard JavaScript Formatting APIs (Intl/ES2017)');
  }

  let hasLocalStorage = false;
  try {
    const testKey = '__adp_compat_probe__';
    window.localStorage.setItem(testKey, '1');
    window.localStorage.removeItem(testKey);
    hasLocalStorage = true;
  } catch {
    hasLocalStorage = false;
  }

  if (!hasLocalStorage) {
    missingFeatures.push('Browser Local Storage (needed for session persistence)');
  }

  if (missingFeatures.length === 0) {
    return {
      supported: true,
      missingFeatures: [],
      recommendedAction: null,
    };
  }

  return {
    supported: false,
    missingFeatures,
    recommendedAction:
      'For the clearest display and reliable POS checkout, please use a modern browser such as Google Chrome, Microsoft Edge, Mozilla Firefox (115 ESR+ on Windows 7), or Safari, and ensure browser storage is enabled.',
  };
}
