/**
 * Lightweight Runtime Polyfills for Cross-Browser & Cross-Device Compatibility
 * Ensures Chrome 88+ / Edge 88+ / Firefox 85+ / Safari 14+ (including Windows 7 browsers
 * and non-HTTPS LAN access) work reliably without throwing modern API TypeErrors.
 */

(function installCompatibilityPolyfills() {
  // 1. Array.prototype.at & String.prototype.at (Chrome < 92, Safari < 15.4)
  if (typeof Array.prototype.at !== 'function') {
    Object.defineProperty(Array.prototype, 'at', {
      value: function <T>(this: T[], n: number): T | undefined {
        const idx = Math.trunc(n) || 0;
        const resolved = idx < 0 ? this.length + idx : idx;
        if (resolved < 0 || resolved >= this.length) return undefined;
        return this[resolved];
      },
      writable: true,
      enumerable: false,
      configurable: true,
    });
  }

  if (typeof String.prototype.at !== 'function') {
    Object.defineProperty(String.prototype, 'at', {
      value: function (this: string, n: number): string | undefined {
        const idx = Math.trunc(n) || 0;
        const resolved = idx < 0 ? this.length + idx : idx;
        if (resolved < 0 || resolved >= this.length) return undefined;
        return this.charAt(resolved);
      },
      writable: true,
      enumerable: false,
      configurable: true,
    });
  }

  // 2. Object.hasOwn (Chrome < 93, Firefox < 92, Safari < 15.4)
  if (typeof (Object as unknown as { hasOwn?: unknown }).hasOwn !== 'function') {
    Object.defineProperty(Object, 'hasOwn', {
      value: function (obj: object, prop: PropertyKey): boolean {
        if (obj === null || obj === undefined) {
          throw new TypeError('Cannot convert undefined or null to object');
        }
        return Object.prototype.hasOwnProperty.call(Object(obj), prop);
      },
      writable: true,
      enumerable: false,
      configurable: true,
    });
  }

  // 3. String.prototype.replaceAll (Chrome < 85, Firefox < 77, Safari < 13.1)
  if (typeof String.prototype.replaceAll !== 'function') {
    Object.defineProperty(String.prototype, 'replaceAll', {
      value: function (
        this: string,
        searchValue: string | RegExp,
        replaceValue: string | ((substring: string, ...args: unknown[]) => string)
      ): string {
        if (searchValue instanceof RegExp) {
          if (!searchValue.global) {
            throw new TypeError('replaceAll must be called with a global RegExp');
          }
          return this.replace(searchValue, replaceValue as string);
        }
        const str = String(this);
        const search = String(searchValue);
        if (search === '') {
          const chars = str.split('');
          const rep = typeof replaceValue === 'function' ? replaceValue('') : replaceValue;
          return rep + chars.join(rep) + rep;
        }
        return str.split(search).join(
          typeof replaceValue === 'function' ? replaceValue(search) : replaceValue
        );
      },
      writable: true,
      enumerable: false,
      configurable: true,
    });
  }

  // 4. crypto.randomUUID fallback (requires Chrome 92+ & Secure Context; fails over HTTP LAN or older Win7 browsers)
  if (typeof window !== 'undefined' && typeof window.crypto !== 'undefined' && typeof window.crypto.randomUUID !== 'function') {
    try {
      Object.defineProperty(window.crypto, 'randomUUID', {
        value: function (): `${string}-${string}-${string}-${string}-${string}` {
          const bytes = new Uint8Array(16);
          if (typeof window.crypto.getRandomValues === 'function') {
            window.crypto.getRandomValues(bytes);
          } else {
            for (let i = 0; i < 16; i++) {
              bytes[i] = Math.floor(Math.random() * 256);
            }
          }
          bytes[6] = (bytes[6] & 0x0f) | 0x40;
          bytes[8] = (bytes[8] & 0x3f) | 0x80;
          const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
          return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}` as `${string}-${string}-${string}-${string}-${string}`;
        },
        writable: true,
        enumerable: false,
        configurable: true,
      });
    } catch {
      // Ignore read-only Crypto prototype on locked environments; helper generateSafeUuid still handles it
    }
  }

  // 5. structuredClone fallback (Chrome < 98, Firefox < 94, Safari < 15.4)
  if (typeof globalThis !== 'undefined' && typeof (globalThis as unknown as { structuredClone?: unknown }).structuredClone !== 'function') {
    (globalThis as unknown as { structuredClone: <T>(val: T) => T }).structuredClone = function <T>(val: T): T {
      if (val === null || typeof val !== 'object') return val;
      return JSON.parse(JSON.stringify(val)) as T;
    };
  }
})();

export function generateSafeUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export async function copyTextSafely(text: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to legacy textarea copy
    }
  }
  if (typeof document !== 'undefined') {
    try {
      const el = document.createElement('textarea');
      el.value = text;
      el.setAttribute('readonly', '');
      el.style.position = 'fixed';
      el.style.left = '-9999px';
      el.style.top = '0';
      document.body.appendChild(el);
      el.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(el);
      return ok;
    } catch {
      return false;
    }
  }
  return false;
}
