import { Product, ProductVariant, RecentScanEntry } from '../types';

export interface ParsedScanPayload {
  raw: string;
  normalizedCode: string;
  productId?: string;
  variantId?: string;
  payloadKind: 'protiva_variant_qr' | 'protiva_product_qr' | 'json_qr' | 'url_qr' | 'plain_code';
}

export interface ScannedProductMatch {
  found: boolean;
  rawCode: string;
  normalizedCode: string;
  matchType:
    | 'qr_variant'
    | 'qr_product'
    | 'variant_barcode'
    | 'product_barcode'
    | 'variant_sku'
    | 'product_sku'
    | 'none';
  product?: Product;
  variant?: ProductVariant;
  requiresVariantSelection?: boolean;
}

export interface ScannerHidPreferences {
  terminator: 'enter' | 'tab' | 'both';
  duplicateCooldownMs: number;
  autoFocusInPos: boolean;
  beepOnScan: boolean;
}

const HID_PREFS_KEY = 'PROTIVA_SCANNER_HID_PREFS';
const RECENT_SCANS_KEY_PREFIX = 'PROTIVA_RECENT_SCANS';
const MAX_RECENT_SCANS = 40;

export const DEFAULT_HID_PREFERENCES: ScannerHidPreferences = {
  terminator: 'both',
  duplicateCooldownMs: 1200,
  autoFocusInPos: false,
  beepOnScan: true,
};

export function getScannerHidPreferences(): ScannerHidPreferences {
  if (typeof window === 'undefined') return DEFAULT_HID_PREFERENCES;
  try {
    const raw = localStorage.getItem(HID_PREFS_KEY);
    if (!raw) return DEFAULT_HID_PREFERENCES;
    const parsed = JSON.parse(raw);
    return {
      terminator:
        parsed.terminator === 'enter' || parsed.terminator === 'tab' || parsed.terminator === 'both'
          ? parsed.terminator
          : 'both',
      duplicateCooldownMs:
        typeof parsed.duplicateCooldownMs === 'number' && parsed.duplicateCooldownMs >= 0
          ? Math.min(10000, parsed.duplicateCooldownMs)
          : 1200,
      autoFocusInPos: Boolean(parsed.autoFocusInPos),
      beepOnScan: parsed.beepOnScan !== false,
    };
  } catch {
    return DEFAULT_HID_PREFERENCES;
  }
}

export function saveScannerHidPreferences(prefs: ScannerHidPreferences): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(HID_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // ignore quota errors
  }
}

/**
 * Play a short subtle non-blocking WebAudio confirmation beep when scanning succeeds.
 */
export function playScanBeep(tone: 'success' | 'error' = 'success'): void {
  if (typeof window === 'undefined') return;
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = tone === 'success' ? 'sine' : 'triangle';
    osc.frequency.setValueAtTime(tone === 'success' ? 1180 : 320, ctx.currentTime);
    gain.gain.setValueAtTime(0.06, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + (tone === 'success' ? 0.09 : 0.16));
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + (tone === 'success' ? 0.095 : 0.17));
    window.setTimeout(() => {
      ctx.close().catch(() => {});
    }, 250);
  } catch {
    // ignore audio restrictions
  }
}

/**
 * Parse raw scanned text from 1D barcodes or QR payloads into structured lookup hints.
 */
export function parseScannedPayload(rawInput: string): ParsedScanPayload {
  const raw = (rawInput || '').trim();
  if (!raw) {
    return { raw: '', normalizedCode: '', payloadKind: 'plain_code' };
  }

  // 1. PROTIVA structured QR payload:
  //    PROTIVA:V:<productId>:<variantId>
  //    PROTIVA:P:<productId>
  if (/^PROTIVA:V:/i.test(raw)) {
    const parts = raw.split(':');
    const productId = parts[2]?.trim();
    const variantId = parts.slice(3).join(':').trim();
    if (productId && variantId) {
      return {
        raw,
        normalizedCode: raw,
        productId,
        variantId,
        payloadKind: 'protiva_variant_qr',
      };
    }
  }

  if (/^PROTIVA:P:/i.test(raw)) {
    const productId = raw.slice('PROTIVA:P:'.length).trim();
    if (productId) {
      return {
        raw,
        normalizedCode: raw,
        productId,
        payloadKind: 'protiva_product_qr',
      };
    }
  }

  // 2. JSON QR payload (e.g., {"productId":"...","variantId":"...","barcode":"..."})
  if (raw.startsWith('{') && raw.endsWith('}')) {
    try {
      const obj = JSON.parse(raw);
      if (obj && typeof obj === 'object') {
        const productId = typeof obj.productId === 'string' ? obj.productId.trim() : undefined;
        const variantId = typeof obj.variantId === 'string' ? obj.variantId.trim() : undefined;
        const codeCandidate =
          (typeof obj.barcode === 'string' && obj.barcode.trim()) ||
          (typeof obj.sku === 'string' && obj.sku.trim()) ||
          (typeof obj.code === 'string' && obj.code.trim()) ||
          raw;
        return {
          raw,
          normalizedCode: codeCandidate,
          productId,
          variantId,
          payloadKind: 'json_qr',
        };
      }
    } catch {
      // fall through as plain code
    }
  }

  // 3. URL QR payload with ?barcode= / ?sku= / ?productId= / ?variantId=
  if (/^https?:\/\//i.test(raw)) {
    try {
      const url = new URL(raw);
      const productId = url.searchParams.get('productId')?.trim() || undefined;
      const variantId = url.searchParams.get('variantId')?.trim() || undefined;
      const paramCode =
        url.searchParams.get('barcode')?.trim() ||
        url.searchParams.get('code')?.trim() ||
        url.searchParams.get('sku')?.trim();
      if (productId || paramCode) {
        return {
          raw,
          normalizedCode: paramCode || productId || raw,
          productId,
          variantId,
          payloadKind: 'url_qr',
        };
      }
    } catch {
      // ignore invalid URL
    }
  }

  return {
    raw,
    normalizedCode: raw,
    payloadKind: 'plain_code',
  };
}

/**
 * Filter active products while honoring branch isolation when products carry a branchId.
 */
export function filterProductsForBranch(products: Product[], activeBranchId?: string): Product[] {
  return products.filter(p => {
    if (p.isActive === false) return false;
    if (p.branchId && activeBranchId && p.branchId !== activeBranchId) return false;
    return true;
  });
}

/**
 * Exact lookup against active branch-scoped products and their active variants.
 * Precedence:
 *   1. Explicit PROTIVA QR product+variant reference
 *   2. Explicit PROTIVA QR product reference
 *   3. Exact variant barcode
 *   4. Exact product barcode
 *   5. Exact variant SKU (case-insensitive)
 *   6. Exact product SKU (case-insensitive)
 */
export function lookupProductByScannedCode(
  rawCode: string,
  products: Product[],
  activeBranchId?: string
): ScannedProductMatch {
  const parsed = parseScannedPayload(rawCode);
  if (!parsed.normalizedCode && !parsed.productId) {
    return {
      found: false,
      rawCode,
      normalizedCode: '',
      matchType: 'none',
    };
  }

  const scopedProducts = filterProductsForBranch(products, activeBranchId);

  // 1 & 2: Direct ID lookup from PROTIVA QR / JSON / URL payload
  if (parsed.productId) {
    const directProduct = scopedProducts.find(p => p.id === parsed.productId);
    if (directProduct) {
      if (parsed.variantId && Array.isArray(directProduct.variants)) {
        const directVariant = directProduct.variants.find(
          v => v.id === parsed.variantId && v.status !== 'inactive'
        );
        if (directVariant) {
          return {
            found: true,
            rawCode,
            normalizedCode: directVariant.barcode || directVariant.sku || parsed.normalizedCode,
            matchType: 'qr_variant',
            product: directProduct,
            variant: directVariant,
          };
        }
      }

      const hasVariants = Boolean(directProduct.hasVariants && directProduct.variants && directProduct.variants.length > 0);
      return {
        found: true,
        rawCode,
        normalizedCode: directProduct.barcode || directProduct.code || parsed.normalizedCode,
        matchType: 'qr_product',
        product: directProduct,
        requiresVariantSelection: hasVariants,
      };
    }
  }

  const qLower = parsed.normalizedCode.toLowerCase();

  // 3. Exact variant barcode match first (most specific)
  for (const prod of scopedProducts) {
    if (prod.hasVariants && Array.isArray(prod.variants)) {
      const matchedVariant = prod.variants.find(
        v => v.status !== 'inactive' && (v.barcode || '').trim().toLowerCase() === qLower
      );
      if (matchedVariant) {
        return {
          found: true,
          rawCode,
          normalizedCode: parsed.normalizedCode,
          matchType: 'variant_barcode',
          product: prod,
          variant: matchedVariant,
        };
      }
    }
  }

  // 4. Exact product-level barcode match
  const matchedProductBarcode = scopedProducts.find(
    p => (p.barcode || '').trim().toLowerCase() === qLower
  );
  if (matchedProductBarcode) {
    const hasVariants = Boolean(
      matchedProductBarcode.hasVariants &&
        matchedProductBarcode.variants &&
        matchedProductBarcode.variants.length > 0
    );
    return {
      found: true,
      rawCode,
      normalizedCode: parsed.normalizedCode,
      matchType: 'product_barcode',
      product: matchedProductBarcode,
      requiresVariantSelection: hasVariants,
    };
  }

  // 5. Exact variant SKU match
  for (const prod of scopedProducts) {
    if (prod.hasVariants && Array.isArray(prod.variants)) {
      const matchedVariantSku = prod.variants.find(
        v => v.status !== 'inactive' && (v.sku || '').trim().toLowerCase() === qLower
      );
      if (matchedVariantSku) {
        return {
          found: true,
          rawCode,
          normalizedCode: parsed.normalizedCode,
          matchType: 'variant_sku',
          product: prod,
          variant: matchedVariantSku,
        };
      }
    }
  }

  // 6. Exact product SKU / code match
  const matchedProductSku = scopedProducts.find(
    p => (p.code || '').trim().toLowerCase() === qLower
  );
  if (matchedProductSku) {
    const hasVariants = Boolean(
      matchedProductSku.hasVariants &&
        matchedProductSku.variants &&
        matchedProductSku.variants.length > 0
    );
    return {
      found: true,
      rawCode,
      normalizedCode: parsed.normalizedCode,
      matchType: 'product_sku',
      product: matchedProductSku,
      requiresVariantSelection: hasVariants,
    };
  }

  return {
    found: false,
    rawCode,
    normalizedCode: parsed.normalizedCode,
    matchType: 'none',
  };
}

/**
 * Collect all barcodes currently in use across both products and product_variants.
 */
export function collectUsedBarcodes(
  products: Product[],
  exclude?: { productId?: string; variantId?: string }
): Set<string> {
  const used = new Set<string>();
  for (const p of products) {
    const pCode = (p.barcode || '').trim().toLowerCase();
    if (pCode && !(exclude?.productId === p.id && !exclude?.variantId)) {
      used.add(pCode);
    }
    if (Array.isArray(p.variants)) {
      for (const v of p.variants) {
        const vCode = (v.barcode || '').trim().toLowerCase();
        if (vCode && !(exclude?.productId === p.id && exclude?.variantId === v.id)) {
          used.add(vCode);
        }
      }
    }
  }
  return used;
}

/**
 * Check whether a barcode collides with any product or variant barcode in the business.
 */
export function isBarcodeDuplicate(
  barcode: string,
  products: Product[],
  exclude?: { productId?: string; variantId?: string }
): { duplicate: boolean; conflictLabel?: string } {
  const target = (barcode || '').trim().toLowerCase();
  if (!target) return { duplicate: false };

  for (const p of products) {
    if (
      p.id !== exclude?.productId &&
      (p.barcode || '').trim().toLowerCase() === target
    ) {
      return { duplicate: true, conflictLabel: `${p.name} (${p.code})` };
    }
    if (Array.isArray(p.variants)) {
      for (const v of p.variants) {
        if (
          !(p.id === exclude?.productId && v.id === exclude?.variantId) &&
          (v.barcode || '').trim().toLowerCase() === target
        ) {
          return {
            duplicate: true,
            conflictLabel: `${p.name} — ${[v.color, v.size].filter(Boolean).join('/') || v.sku}`,
          };
        }
      }
    }
  }

  return { duplicate: false };
}

function getRecentScansStorageKey(businessId?: string, branchId?: string): string {
  return `${RECENT_SCANS_KEY_PREFIX}_${businessId || 'local'}_${branchId || 'main'}`;
}

export function loadRecentScans(businessId?: string, branchId?: string): RecentScanEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(getRecentScansStorageKey(businessId, branchId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveRecentScan(
  entry: RecentScanEntry,
  businessId?: string,
  branchId?: string
): RecentScanEntry[] {
  const existing = loadRecentScans(businessId, branchId);
  const next = [entry, ...existing].slice(0, MAX_RECENT_SCANS);
  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(getRecentScansStorageKey(businessId, branchId), JSON.stringify(next));
    } catch {
      // ignore quota errors
    }
  }
  return next;
}

export function clearRecentScans(businessId?: string, branchId?: string): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(getRecentScansStorageKey(businessId, branchId));
  } catch {
    // ignore
  }
}
