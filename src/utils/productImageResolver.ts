import { Product, ProductColor, ProductColorImage, ProductVariant } from '../types';

export const PRESET_COLOR_HEX_MAP: Record<string, string> = {
  black: '#0f172a',
  white: '#ffffff',
  'navy blue': '#1e3a8a',
  navy: '#1e3a8a',
  'royal blue': '#2563eb',
  blue: '#2563eb',
  'sky blue': '#38bdf8',
  teal: '#087f8c',
  red: '#dc2626',
  crimson: '#b91c1c',
  maroon: '#831843',
  burgundy: '#7f1d1d',
  'olive green': '#3f6212',
  olive: '#4d7c0f',
  'forest green': '#14532d',
  green: '#15803d',
  emerald: '#059669',
  grey: '#64748b',
  gray: '#64748b',
  'ash grey': '#94a3b8',
  ash: '#94a3b8',
  charcoal: '#334155',
  beige: '#d4b996',
  cream: '#f5f0e1',
  khaki: '#c2b280',
  brown: '#78350f',
  coffee: '#5c3317',
  pink: '#f472b6',
  magenta: '#db2777',
  purple: '#7e22ce',
  lavender: '#a78bfa',
  yellow: '#eab308',
  mustard: '#ca8a04',
  orange: '#ea580c',
  gold: '#d6ad60',
  silver: '#cbd5e1',
};

export function normalizeColorKey(name?: string | null): string {
  return (name || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

export function inferColorHex(colorName?: string | null, explicitHex?: string | null): string {
  if (explicitHex && /^#[0-9a-f]{3,8}$/i.test(explicitHex.trim())) {
    return explicitHex.trim();
  }
  const key = normalizeColorKey(colorName);
  return PRESET_COLOR_HEX_MAP[key] || '#0f172a';
}

export function sortColorImages(images: ProductColorImage[]): ProductColorImage[] {
  return [...images].sort((a, b) => {
    if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return (a.createdAt || '').localeCompare(b.createdAt || '');
  });
}

/**
 * Returns authoritative ProductColor list for a product.
 * Always keeps persisted product.productColors first, and merges any unsynced
 * variant colors cleanly without creating duplicate normalized color names.
 */
export function resolveProductColors(product?: Product | null): ProductColor[] {
  if (!product) return [];
  const persisted = Array.isArray(product.productColors) ? product.productColors : [];
  const result: ProductColor[] = [...persisted].sort((a, b) => a.sortOrder - b.sortOrder);
  const seenKeys = new Set(result.map(c => normalizeColorKey(c.normalizedName || c.colorName)));

  (product.variants || []).forEach((v, idx) => {
    const cleanName = (v.color || '').trim();
    const key = normalizeColorKey(cleanName);
    if (!key || seenKeys.has(key)) return;
    seenKeys.add(key);
    result.push({
      id: v.colorId || `local-color-${product.id}-${key}`,
      productId: product.id,
      colorName: cleanName,
      normalizedName: key,
      colorHex: inferColorHex(cleanName, v.colorHex),
      sortOrder: result.length + idx,
      isActive: true,
    });
  });

  if (result.length === 0 && product.color && product.color.trim()) {
    const key = normalizeColorKey(product.color);
    result.push({
      id: `local-color-${product.id}-${key}`,
      productId: product.id,
      colorName: product.color.trim(),
      normalizedName: key,
      colorHex: inferColorHex(product.color),
      sortOrder: 0,
      isActive: true,
    });
  }

  return result;
}

export function resolveColorIdForVariant(
  product?: Product | null,
  variant?: ProductVariant | null,
  explicitColorName?: string
): string | undefined {
  if (!product) return variant?.colorId;
  if (variant?.colorId) return variant.colorId;
  const targetName = explicitColorName || variant?.color;
  const key = normalizeColorKey(targetName);
  if (!key) return undefined;
  const colors = resolveProductColors(product);
  return colors.find(c => normalizeColorKey(c.normalizedName || c.colorName) === key)?.id;
}

export function resolveColorImages(
  product?: Product | null,
  colorId?: string,
  colorName?: string
): ProductColorImage[] {
  if (!product) return [];
  const all = (product.productImages || []).filter(img => img.productId === product.id);
  if (all.length === 0) return [];

  if (colorId) {
    const byColorId = all.filter(img => img.colorId === colorId);
    if (byColorId.length > 0) return sortColorImages(byColorId);
  }

  const key = normalizeColorKey(colorName);
  if (key) {
    const colors = resolveProductColors(product);
    const matchedColor = colors.find(
      c => normalizeColorKey(c.normalizedName || c.colorName) === key
    );
    if (matchedColor) {
      const byColor = all.filter(img => img.colorId === matchedColor.id);
      if (byColor.length > 0) return sortColorImages(byColor);
    }
  }

  return [];
}

/**
 * Strictly resolves the right image URL using permanent product_id + color_id.
 * Never matches across products by product name.
 */
export function resolveProductImage(
  product?: Product | null,
  options?: {
    colorId?: string;
    variantId?: string;
    colorName?: string;
    fallbackToProductPrimary?: boolean;
  }
): string | undefined {
  if (!product) return undefined;
  const fallbackToProductPrimary = options?.fallbackToProductPrimary !== false;
  const images = (product.productImages || []).filter(img => img.productId === product.id);

  let targetColorId = options?.colorId;
  let targetColorName = options?.colorName;

  if (!targetColorId && options?.variantId && Array.isArray(product.variants)) {
    const matchedVariant = product.variants.find(v => v.id === options.variantId);
    if (matchedVariant) {
      targetColorId = matchedVariant.colorId || resolveColorIdForVariant(product, matchedVariant);
      if (!targetColorName) targetColorName = matchedVariant.color;
    }
  }

  if (!targetColorId && targetColorName) {
    targetColorId = resolveColorIdForVariant(product, undefined, targetColorName);
  }

  if (targetColorId && images.length > 0) {
    const matched = sortColorImages(images.filter(img => img.colorId === targetColorId));
    if (matched.length > 0) {
      return matched[0].imageUrl;
    }
  }

  // Legacy per-variant inline images fallback if present
  if (options?.variantId && Array.isArray(product.variants)) {
    const v = product.variants.find(vr => vr.id === options.variantId);
    if (v?.images && v.images.length > 0) return v.images[0];
  }

  if (!fallbackToProductPrimary) return undefined;

  if (product.primaryImageUrl) return product.primaryImageUrl;
  if (images.length > 0) {
    const sorted = sortColorImages(images);
    if (sorted[0]?.imageUrl) return sorted[0].imageUrl;
  }
  if (product.image) return product.image;
  if (product.images && product.images.length > 0) return product.images[0];
  return undefined;
}

export function getColorUploadCoverage(product: Product): {
  totalColors: number;
  colorsWithImages: number;
  missingColors: number;
  totalImages: number;
} {
  const colors = resolveProductColors(product);
  const images = (product.productImages || []).filter(img => img.productId === product.id);
  const colorIdsWithImage = new Set(images.map(i => i.colorId));
  const colorsWithImages = colors.filter(c => colorIdsWithImage.has(c.id)).length;
  return {
    totalColors: colors.length,
    colorsWithImages,
    missingColors: Math.max(0, colors.length - colorsWithImages),
    totalImages: images.length > 0 ? images.length : product.image ? 1 : 0,
  };
}
