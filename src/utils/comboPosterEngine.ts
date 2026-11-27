import { jsPDF } from 'jspdf';
import QRCode from 'qrcode';
import {
  Branch,
  ComboOffer,
  ComboPosterConfig,
  PosterDimensionPreset,
  PosterTemplateId,
  Product,
  ShopSettings,
} from '../types';
import { resolveBusinessProfile } from '../config/appIdentity';
import { formatCurrency } from './formatters';
import { resolveProductImage } from './productImageResolver';
import { printDocument, PrintResult } from './printEngine';

import { removeLightBackgroundToDataUrl } from './posterCanvasEffects';

const round2 = (n: number): number => Math.round((Number(n) || 0) * 100) / 100;

export interface PosterTemplateDefinition {
  id: PosterTemplateId;
  name: string;
  tagline: string;
  badgeText: string;
  backgroundColor: string;
  secondaryColor: string;
  accentColor: string;
  textColor: string;
  cardBgColor: string;
  cardBorderColor: string;
  badgeBgColor: string;
  badgeTextColor: string;
  motif:
    | 'style_zone'
    | 'gold_frame'
    | 'geometric'
    | 'crescent'
    | 'confetti'
    | 'editorial'
    | 'frost'
    | 'playful'
    | 'floral'
    | 'tailored'
    | 'minimal';
}

export const POSTER_TEMPLATES: PosterTemplateDefinition[] = [
  {
    id: 'style_zone_reference',
    name: 'Style Zone Reference',
    tagline: 'Signature Red, Yellow & Black high-conversion retail combo offer showcase',
    badgeText: 'COMBO OFFER',
    backgroundColor: '#12131A',
    secondaryColor: '#D91E2A',
    accentColor: '#FFD21F',
    textColor: '#FFFFFF',
    cardBgColor: '#FFFFFF',
    cardBorderColor: '#FFD21F',
    badgeBgColor: '#FFD21F',
    badgeTextColor: '#0D0E14',
    motif: 'style_zone',
  },
  {
    id: 'premium_black_gold',
    name: 'Premium Black & Gold',
    tagline: 'Signature luxury dark canvas with champagne gold accents',
    badgeText: 'SIGNATURE COMBO',
    backgroundColor: '#0B0F19',
    secondaryColor: '#161E31',
    accentColor: '#D6AD60',
    textColor: '#F8FAFC',
    cardBgColor: '#141B2D',
    cardBorderColor: '#D6AD60',
    badgeBgColor: '#D6AD60',
    badgeTextColor: '#0B0F19',
    motif: 'gold_frame',
  },
  {
    id: 'modern_blue_yellow',
    name: 'Modern Blue & Yellow',
    tagline: 'Crisp navy retail banner with high-impact amber highlights',
    badgeText: 'MEGA VALUE PACK',
    backgroundColor: '#0A1931',
    secondaryColor: '#142B52',
    accentColor: '#FFAD29',
    textColor: '#FFFFFF',
    cardBgColor: '#FFFFFF',
    cardBorderColor: '#CBD5E1',
    badgeBgColor: '#FFAD29',
    badgeTextColor: '#0A1931',
    motif: 'geometric',
  },
  {
    id: 'eid_special',
    name: 'Eid Special',
    tagline: 'Deep emerald festive showcase with warm gold Crescent motifs',
    badgeText: 'EID MUBARAK OFFER',
    backgroundColor: '#063B2B',
    secondaryColor: '#0B533D',
    accentColor: '#E5B85C',
    textColor: '#F7FAF8',
    cardBgColor: '#0A4935',
    cardBorderColor: '#E5B85C',
    badgeBgColor: '#E5B85C',
    badgeTextColor: '#052E22',
    motif: 'crescent',
  },
  {
    id: 'festival_sale',
    name: 'Festival Sale',
    tagline: 'Vibrant crimson celebration layout built for flash & seasonal promos',
    badgeText: 'FESTIVAL SUPER DEAL',
    backgroundColor: '#881337',
    secondaryColor: '#9F1239',
    accentColor: '#FDE047',
    textColor: '#FFF1F2',
    cardBgColor: '#FFFFFF',
    cardBorderColor: '#FDA4AF',
    badgeBgColor: '#FDE047',
    badgeTextColor: '#881337',
    motif: 'confetti',
  },
  {
    id: 'luxury_fashion',
    name: 'Luxury Fashion',
    tagline: 'Warm ivory editorial lookbook with espresso & bronze detailing',
    badgeText: 'CURATED CAPSULE',
    backgroundColor: '#F5F0E8',
    secondaryColor: '#EAE1D3',
    accentColor: '#8B5E34',
    textColor: '#1F1A17',
    cardBgColor: '#FFFFFF',
    cardBorderColor: '#D6C7B2',
    badgeBgColor: '#1F1A17',
    badgeTextColor: '#F5F0E8',
    motif: 'editorial',
  },
  {
    id: 'winter_collection',
    name: 'Winter Collection',
    tagline: 'Arctic slate & glacier teal contrast crafted for knitwear & outerwear',
    badgeText: 'WINTER ESSENTIALS',
    backgroundColor: '#0F2537',
    secondaryColor: '#1B3A52',
    accentColor: '#38BDF8',
    textColor: '#F0F9FF',
    cardBgColor: '#153047',
    cardBorderColor: '#7DD3FC',
    badgeBgColor: '#38BDF8',
    badgeTextColor: '#082F49',
    motif: 'frost',
  },
  {
    id: 'kids_collection',
    name: 'Kids Collection',
    tagline: 'Bright sky & tangerine palette with friendly rounded framing',
    badgeText: 'KIDS BUNDLE JOY',
    backgroundColor: '#FFFBEB',
    secondaryColor: '#FEF3C7',
    accentColor: '#EA580C',
    textColor: '#1E293B',
    cardBgColor: '#FFFFFF',
    cardBorderColor: '#FDBA74',
    badgeBgColor: '#EA580C',
    badgeTextColor: '#FFFFFF',
    motif: 'playful',
  },
  {
    id: 'women_fashion',
    name: "Women's Fashion",
    tagline: 'Soft blush rose & wine typography tailored for boutique collections',
    badgeText: 'BOUTIQUE EXCLUSIVE',
    backgroundColor: '#FDF2F8',
    secondaryColor: '#FCE7F3',
    accentColor: '#BE185D',
    textColor: '#3B0764',
    cardBgColor: '#FFFFFF',
    cardBorderColor: '#F9A8D4',
    badgeBgColor: '#BE185D',
    badgeTextColor: '#FFFFFF',
    motif: 'floral',
  },
  {
    id: 'men_fashion',
    name: "Men's Fashion",
    tagline: 'Structured charcoal & steel slate tailoring with terracotta accent',
    badgeText: "MEN'S STYLE EDIT",
    backgroundColor: '#18181B',
    secondaryColor: '#27272A',
    accentColor: '#EA580C',
    textColor: '#FAFAFA',
    cardBgColor: '#222226',
    cardBorderColor: '#52525B',
    badgeBgColor: '#EA580C',
    badgeTextColor: '#FFFFFF',
    motif: 'tailored',
  },
  {
    id: 'couple_combo',
    name: 'Couple Combo',
    tagline: 'His & Hers coordinated duo palette in deep plum & warm gold',
    badgeText: 'COUPLE SPECIAL',
    backgroundColor: '#2D0F24',
    secondaryColor: '#581C47',
    accentColor: '#FBBF24',
    textColor: '#FFF7ED',
    cardBgColor: '#FFFFFF',
    cardBorderColor: '#FBBF24',
    badgeBgColor: '#FBBF24',
    badgeTextColor: '#2D0F24',
    motif: 'gold_frame',
  },
  {
    id: 'family_combo',
    name: 'Family Value Combo',
    tagline: 'Warm crimson & festive gold palette built for household value packs',
    badgeText: 'FAMILY VALUE PACK',
    backgroundColor: '#7F1D1D',
    secondaryColor: '#B91C1C',
    accentColor: '#FDE047',
    textColor: '#FFFFFF',
    cardBgColor: '#FFFFFF',
    cardBorderColor: '#FDE047',
    badgeBgColor: '#FDE047',
    badgeTextColor: '#7F1D1D',
    motif: 'confetti',
  },
  {
    id: 'accessories_combo',
    name: 'Accessories Combo',
    tagline: 'Sleek graphite & cobalt editorial framing for watches, bags & belts',
    badgeText: 'ACCESSORIES EDIT',
    backgroundColor: '#0F172A',
    secondaryColor: '#1E293B',
    accentColor: '#38BDF8',
    textColor: '#F8FAFC',
    cardBgColor: '#1E293B',
    cardBorderColor: '#38BDF8',
    badgeBgColor: '#38BDF8',
    badgeTextColor: '#0F172A',
    motif: 'geometric',
  },
  {
    id: 'cosmetics_combo',
    name: 'Cosmetics & Beauty Combo',
    tagline: 'Soft rosewood & champagne silk palette for beauty & skincare bundles',
    badgeText: 'GLOW BUNDLE DEAL',
    backgroundColor: '#FFF1F2',
    secondaryColor: '#FFE4E6',
    accentColor: '#E11D48',
    textColor: '#4C0519',
    cardBgColor: '#FFFFFF',
    cardBorderColor: '#FDA4AF',
    badgeBgColor: '#E11D48',
    badgeTextColor: '#FFFFFF',
    motif: 'floral',
  },
  {
    id: 'mixed_product_combo',
    name: 'Mixed Lifestyle Combo',
    tagline: 'Bold teal, ember & white retail catalog grid for cross-category bundles',
    badgeText: 'ALL-IN-ONE BUNDLE',
    backgroundColor: '#042F2E',
    secondaryColor: '#115E59',
    accentColor: '#F59E0B',
    textColor: '#F8FAFC',
    cardBgColor: '#FFFFFF',
    cardBorderColor: '#F59E0B',
    badgeBgColor: '#F59E0B',
    badgeTextColor: '#042F2E',
    motif: 'style_zone',
  },
  {
    id: 'minimal_professional',
    name: 'Minimal Professional',
    tagline: 'Ultra-clean white studio layout putting product photography first',
    badgeText: 'VALUE BUNDLE',
    backgroundColor: '#FFFFFF',
    secondaryColor: '#F8FAFC',
    accentColor: '#0F766E',
    textColor: '#0F172A',
    cardBgColor: '#F8FAFC',
    cardBorderColor: '#E2E8F0',
    badgeBgColor: '#0F766E',
    badgeTextColor: '#FFFFFF',
    motif: 'minimal',
  },
];

export interface PosterDimensionSpec {
  id: PosterDimensionPreset;
  label: string;
  shortLabel: string;
  widthPx: number;
  heightPx: number;
  printSizeLabel: string;
  pdfOrientation: 'portrait' | 'landscape';
}

export const POSTER_DIMENSION_PRESETS: Record<PosterDimensionPreset, PosterDimensionSpec> = {
  facebook_square: {
    id: 'facebook_square',
    label: 'Facebook Square Post (1080×1080)',
    shortLabel: 'FB Square 1:1',
    widthPx: 1080,
    heightPx: 1080,
    printSizeLabel: '1080×1080 px',
    pdfOrientation: 'portrait',
  },
  facebook_portrait: {
    id: 'facebook_portrait',
    label: 'Facebook Vertical Feed (1080×1350)',
    shortLabel: 'FB 4:5 Feed',
    widthPx: 1080,
    heightPx: 1350,
    printSizeLabel: '1080×1350 px',
    pdfOrientation: 'portrait',
  },
  facebook_story: {
    id: 'facebook_story',
    label: 'Facebook Story / Reels (1080×1920)',
    shortLabel: 'FB Story 9:16',
    widthPx: 1080,
    heightPx: 1920,
    printSizeLabel: '1080×1920 px',
    pdfOrientation: 'portrait',
  },
  facebook_post: {
    id: 'facebook_post',
    label: 'Facebook Wide Banner (1200×630)',
    shortLabel: 'FB Link Banner',
    widthPx: 1200,
    heightPx: 630,
    printSizeLabel: '1200×630 px',
    pdfOrientation: 'landscape',
  },
  instagram_post: {
    id: 'instagram_post',
    label: 'Instagram Portrait Post (1080×1350)',
    shortLabel: 'IG Portrait',
    widthPx: 1080,
    heightPx: 1350,
    printSizeLabel: '1080×1350 px',
    pdfOrientation: 'portrait',
  },
  instagram_story: {
    id: 'instagram_story',
    label: 'Instagram Story / Reels (1080×1920)',
    shortLabel: 'IG Story 9:16',
    widthPx: 1080,
    heightPx: 1920,
    printSizeLabel: '1080×1920 px',
    pdfOrientation: 'portrait',
  },
  square_social: {
    id: 'square_social',
    label: 'Square Social Post (1080×1080)',
    shortLabel: 'Square 1:1',
    widthPx: 1080,
    heightPx: 1080,
    printSizeLabel: '1080×1080 px',
    pdfOrientation: 'portrait',
  },
  a4_portrait: {
    id: 'a4_portrait',
    label: 'A4 Portrait (Print 210×297mm)',
    shortLabel: 'A4 Portrait',
    widthPx: 1240,
    heightPx: 1754,
    printSizeLabel: 'A4 portrait',
    pdfOrientation: 'portrait',
  },
  a4_landscape: {
    id: 'a4_landscape',
    label: 'A4 Landscape (Print 297×210mm)',
    shortLabel: 'A4 Landscape',
    widthPx: 1754,
    heightPx: 1240,
    printSizeLabel: 'A4 landscape',
    pdfOrientation: 'landscape',
  },
  a5_portrait: {
    id: 'a5_portrait',
    label: 'A5 Portrait Flyer (148×210mm)',
    shortLabel: 'A5 Portrait',
    widthPx: 874,
    heightPx: 1240,
    printSizeLabel: 'A5 portrait',
    pdfOrientation: 'portrait',
  },
  a5_landscape: {
    id: 'a5_landscape',
    label: 'A5 Landscape Flyer (210×148mm)',
    shortLabel: 'A5 Landscape',
    widthPx: 1240,
    heightPx: 874,
    printSizeLabel: 'A5 landscape',
    pdfOrientation: 'landscape',
  },
  a3_portrait: {
    id: 'a3_portrait',
    label: 'A3 Portrait (Large Print)',
    shortLabel: 'A3 Portrait',
    widthPx: 1754,
    heightPx: 2480,
    printSizeLabel: 'A3 portrait',
    pdfOrientation: 'portrait',
  },
  a3_landscape: {
    id: 'a3_landscape',
    label: 'A3 Landscape (Large Print)',
    shortLabel: 'A3 Landscape',
    widthPx: 2480,
    heightPx: 1754,
    printSizeLabel: 'A3 landscape',
    pdfOrientation: 'landscape',
  },
  custom: {
    id: 'custom',
    label: 'Custom Dimensions',
    shortLabel: 'Custom',
    widthPx: 1200,
    heightPx: 1500,
    printSizeLabel: 'Custom',
    pdfOrientation: 'portrait',
  },
};

export interface ResolvedPosterProductItem {
  itemKey: string;
  index: number;
  productId: string;
  variantId?: string;
  productName: string;
  category: string;
  color: string;
  size: string;
  variantDetails: string;
  sku: string;
  quantity: number;
  regularUnitPrice: number;
  lineRegularTotal: number;
  isFree: boolean;
  imageUrl: string | null;
  imageSource: 'product_db' | 'poster_override' | 'missing';
  hasMissingImage: boolean;
}

export function buildPosterItemKey(productId: string, variantId?: string): string {
  return `${productId}__${variantId || 'base'}`;
}

/**
 * Resolves exact product details and real images from inventory WITHOUT modifying original Product records.
 * Poster-only overrides (`posterProductImages`) are consulted when a product has no DB image or the user chose a poster override.
 */
export function resolvePosterProductItems(
  offer: ComboOffer,
  products: Product[],
  posterProductImages?: Record<string, string>
): ResolvedPosterProductItem[] {
  return (offer.items || []).map((item, idx) => {
    const itemKey = buildPosterItemKey(item.productId, item.variantId);
    const prod = products.find(p => p.id === item.productId);
    const variant =
      item.variantId && prod?.variants
        ? prod.variants.find(v => v.id === item.variantId)
        : undefined;

    const dbUrl = prod
      ? (
          resolveProductImage(prod, {
            variantId: item.variantId,
            colorId: variant?.colorId,
            colorName: variant?.color,
            fallbackToProductPrimary: true,
          }) || ''
        ).trim()
      : '';

    const overrideUrl = posterProductImages?.[itemKey]?.trim() || '';

    let imageUrl: string | null = null;
    let imageSource: ResolvedPosterProductItem['imageSource'] = 'missing';
    if (overrideUrl) {
      imageUrl = overrideUrl;
      imageSource = 'poster_override';
    } else if (dbUrl) {
      imageUrl = dbUrl;
      imageSource = 'product_db';
    }

    const size = (variant?.size || (!prod?.hasVariants ? prod?.size : '') || '').trim();
    const color = (
      variant?.color ||
      (!prod?.hasVariants ? prod?.color : '') ||
      ''
    ).trim();
    const variantDetails = [color, size].filter(Boolean).join(' · ') || item.variantDetails || '';

    const regularUnitPrice = round2(
      item.salePrice ??
        variant?.salePrice ??
        (variant?.additionalPrice && prod ? prod.salePrice + variant.additionalPrice : undefined) ??
        prod?.salePrice ??
        0
    );
    const quantity = Math.max(1, Number(item.quantity) || 1);

    return {
      itemKey,
      index: idx + 1,
      productId: item.productId,
      variantId: item.variantId,
      productName: item.productName || prod?.name || 'Product',
      category: prod?.category || 'Apparel & Retail',
      color,
      size,
      variantDetails,
      sku: variant?.sku || prod?.barcode || item.sku || '',
      quantity,
      regularUnitPrice,
      lineRegularTotal: round2(regularUnitPrice * quantity),
      isFree: Boolean(item.isFree),
      imageUrl,
      imageSource,
      hasMissingImage: !imageUrl,
    };
  });
}

export interface AutoDesignAnalysis {
  templateId: PosterTemplateId;
  headline: string;
  promoText: string;
  rationale: string;
}

const DARK_COLOR_TOKENS = ['black', 'onyx', 'noir', 'charcoal', 'jet', 'ebony', 'midnight', 'dark'];

export function analyzeComboForPosterDesign(
  offer: ComboOffer,
  items: ResolvedPosterProductItem[]
): AutoDesignAnalysis {
  const offerText = `${offer.name || ''} ${offer.comboCategory || ''} ${offer.description || ''}`.toLowerCase();
  const itemText = items
    .map(it => `${it.productName} ${it.category} ${it.color} ${it.variantDetails}`)
    .join(' ')
    .toLowerCase();
  const combined = `${offerText} ${itemText}`;

  const colorList = items.map(it => it.color.toLowerCase()).filter(Boolean);
  const allDarkProducts =
    colorList.length > 0 &&
    colorList.every(c => DARK_COLOR_TOKENS.some(tok => c.includes(tok)));

  const hasKeyword = (keywords: string[]) => keywords.some(k => combined.includes(k));

  let templateId: PosterTemplateId = 'modern_blue_yellow';
  let rationale = 'Balanced multi-product retail contrast palette';

  if (allDarkProducts) {
    templateId = 'premium_black_gold';
    rationale = 'All-black/dark product colors matched to Premium Black & Gold theme';
  } else if (hasKeyword(['eid', 'ramadan', 'mubarak', 'panjabi', 'jubbah', 'attar'])) {
    templateId = 'eid_special';
    rationale = 'Festive Eid / ethnic apparel keywords matched to Eid Special theme';
  } else if (hasKeyword(['winter', 'jacket', 'hoodie', 'sweater', 'cardigan', 'shawl', 'coat', 'blazer', 'fleece'])) {
    templateId = 'winter_collection';
    rationale = 'Outerwear & knitwear items matched to Winter Collection theme';
  } else if (hasKeyword(['kid', 'kids', 'baby', 'junior', 'child', 'boy', 'girl', 'toddler'])) {
    templateId = 'kids_collection';
    rationale = 'Kids product attributes matched to Kids Collection theme';
  } else if (hasKeyword(['women', 'woman', 'ladies', 'three-piece', 'three piece', 'burqa', 'hijab', 'saree', 'kurti', 'abaya', 'lehenga'])) {
    templateId = 'women_fashion';
    rationale = "Women's boutique categories matched to Women's Fashion theme";
  } else if (hasKeyword(['men', "men's", 'formal', 'chino', 'polo', 'trouser', 'denim', 'shirt', 't-shirt'])) {
    templateId = 'men_fashion';
    rationale = "Men's apparel categories matched to Men's Fashion theme";
  } else if (hasKeyword(['couple', 'his & hers', 'duo'])) {
    templateId = 'couple_combo';
    rationale = 'Couple/Duo combo keywords matched to Couple Combo theme';
  } else if (hasKeyword(['family', 'parents', 'household'])) {
    templateId = 'family_combo';
    rationale = 'Family combo keywords matched to Family Value Combo theme';
  } else if (hasKeyword(['lipstick', 'cosmetic', 'skincare', 'serum', 'beauty', 'perfume'])) {
    templateId = 'cosmetics_combo';
    rationale = 'Beauty & cosmetics keywords matched to Cosmetics Combo theme';
  } else if (hasKeyword(['watch', 'wallet', 'belt', 'bag', 'sunglass', 'jewelry', 'accessories'])) {
    templateId = 'accessories_combo';
    rationale = 'Accessories categories matched to Accessories Combo theme';
  } else if (hasKeyword(['festival', 'puja', 'boishakh', 'flash', 'mega', 'clearance', 'sale'])) {
    templateId = 'festival_sale';
    rationale = 'Promotional & festive sale tags matched to Festival Sale theme';
  } else if (hasKeyword(['luxury', 'silk', 'bridal', 'signature', 'premium', 'royal', 'oud'])) {
    templateId = 'luxury_fashion';
    rationale = 'Editorial luxury cues matched to Luxury Fashion theme';
  }

  const tpl = POSTER_TEMPLATES.find(t => t.id === templateId) || POSTER_TEMPLATES[0];
  const discountPct =
    offer.regularTotalPrice > 0
      ? round2(((offer.regularTotalPrice - offer.finalComboPrice) / offer.regularTotalPrice) * 100)
      : 0;

  return {
    templateId,
    headline: offer.name || 'Special Combo Offer',
    promoText:
      discountPct > 0
        ? `${tpl.badgeText} · SAVE ${discountPct}%`
        : tpl.badgeText,
    rationale,
  };
}

export function buildDefaultPosterConfig(
  offer: ComboOffer,
  products: Product[],
  existing?: ComboPosterConfig
): ComboPosterConfig {
  const items = resolvePosterProductItems(offer, products, existing?.posterProductImages);
  const analysis = analyzeComboForPosterDesign(offer, items);
  const templateId = existing?.templateId || 'style_zone_reference';
  const tpl = POSTER_TEMPLATES.find(t => t.id === templateId) || POSTER_TEMPLATES[0];

  if (existing) {
    return {
      ...existing,
      templateId,
      fashionSlogan: existing.fashionSlogan || 'PREMIUM FASHION · UNBEATABLE VALUE',
      ctaText: existing.ctaText || 'SHOP NOW',
      trustLine: existing.trustLine || 'PREMIUM QUALITY · BEST DISCOUNT · FAST DELIVERY',
      modelCategory: existing.modelCategory || 'auto',
      removeModelBg: existing.removeModelBg ?? true,
      posterProductImages: existing.posterProductImages || offer.posterConfig?.posterProductImages || {},
    };
  }

  return {
    mode: 'ai_creative',
    templateId,
    dimensionPreset: 'facebook_portrait',
    customWidthPx: 1080,
    customHeightPx: 1350,
    backgroundColor: tpl.backgroundColor,
    secondaryColor: tpl.secondaryColor,
    accentColor: tpl.accentColor,
    textColor: tpl.textColor,
    headline: offer.name || 'COMBO OFFER',
    promoText: analysis.promoText,
    footerText: 'Limited Stock Available · Order In-Store or Online',
    fashionSlogan: 'WEAR CONFIDENCE · OWN THE LOOK',
    ctaText: 'SHOP NOW',
    trustLine: 'PREMIUM QUALITY · BEST DISCOUNT · LIMITED STOCK',
    modelCategory: 'auto',
    removeModelBg: true,
    productImageSize: items.length <= 3 ? 'large' : items.length <= 6 ? 'standard' : 'compact',
    productImagePosition: 'showcase',
    productFontSize: items.length <= 6 ? 'md' : 'sm',
    showPrices: true,
    showDiscountBadge: true,
    showShopDetails: true,
    showBranchInfo: true,
    logoPosition: 'top_left',
    qrPosition: 'bottom_right',
    includeQrCode: true,
    posterProductImages: {},
  };
}

export function resolvePosterDimensions(config: Pick<ComboPosterConfig, 'dimensionPreset' | 'customWidthPx' | 'customHeightPx'>): {
  widthPx: number;
  heightPx: number;
  spec: PosterDimensionSpec;
} {
  const spec = POSTER_DIMENSION_PRESETS[config.dimensionPreset] || POSTER_DIMENSION_PRESETS.a4_portrait;
  if (config.dimensionPreset === 'custom') {
    const widthPx = Math.max(480, Math.min(3600, Math.round(Number(config.customWidthPx) || 1200)));
    const heightPx = Math.max(480, Math.min(3600, Math.round(Number(config.customHeightPx) || 1500)));
    return {
      widthPx,
      heightPx,
      spec: {
        ...spec,
        widthPx,
        heightPx,
        pdfOrientation: widthPx >= heightPx ? 'landscape' : 'portrait',
      },
    };
  }
  return { widthPx: spec.widthPx, heightPx: spec.heightPx, spec };
}

export interface PosterLayoutPage {
  pageIndex: number;
  totalPages: number;
  cols: number;
  rows: number;
  items: ResolvedPosterProductItem[];
}

/**
 * Adaptive grid & pagination calculator:
 * - 1–3 items: 1-row spotlight/showcase (1, 2, or 3 columns)
 * - 4–6 items: 3×2 or 2×3 balanced showcase
 * - 7–9 items: 3×3 or 4-col landscape grid
 * - 10–12 items: 3×4 or 4×3 clean catalog grid
 * - >12 items: automatic pagination across multiple poster/PDF pages (never omits a single product!)
 */
export function computePosterLayoutPlan(
  items: ResolvedPosterProductItem[],
  dimensionPreset: PosterDimensionPreset,
  widthPx: number,
  heightPx: number
): PosterLayoutPage[] {
  const count = items.length;
  if (count === 0) {
    return [{ pageIndex: 0, totalPages: 1, cols: 1, rows: 1, items: [] }];
  }

  const isWideShort = widthPx / Math.max(1, heightPx) >= 1.45;
  const maxPerPage = isWideShort || dimensionPreset === 'facebook_post' ? 8 : 12;

  const chunks: ResolvedPosterProductItem[][] = [];
  for (let i = 0; i < items.length; i += maxPerPage) {
    chunks.push(items.slice(i, i + maxPerPage));
  }

  return chunks.map((chunk, idx) => {
    const n = chunk.length;
    let cols = 3;
    if (n === 1) cols = 1;
    else if (n === 2) cols = 2;
    else if (n === 3) cols = isWideShort ? 3 : 3;
    else if (n === 4) cols = isWideShort ? 4 : 2;
    else if (n <= 6) cols = isWideShort ? 3 : 3;
    else if (n <= 9) cols = isWideShort ? 4 : 3;
    else cols = isWideShort ? 4 : 3;

    const rows = Math.max(1, Math.ceil(n / cols));
    return {
      pageIndex: idx,
      totalPages: chunks.length,
      cols,
      rows,
      items: chunk,
    };
  });
}

export interface PosterPricingSummary {
  regularTotalPrice: number;
  finalComboPrice: number;
  savingsAmount: number;
  discountPercent: number;
}

export function computePosterPricingSummary(
  offer: ComboOffer,
  items: ResolvedPosterProductItem[]
): PosterPricingSummary {
  const computedItemsTotal = round2(
    items.reduce((sum, it) => sum + (it.isFree ? 0 : it.lineRegularTotal), 0)
  );
  const regularTotalPrice = round2(
    offer.regularTotalPrice > 0 ? offer.regularTotalPrice : computedItemsTotal
  );
  const finalComboPrice = round2(Math.max(0, offer.finalComboPrice));
  const savingsAmount = round2(Math.max(0, regularTotalPrice - finalComboPrice));
  const discountPercent =
    regularTotalPrice > 0
      ? round2(Math.max(0, Math.min(100, (savingsAmount / regularTotalPrice) * 100)))
      : 0;

  return {
    regularTotalPrice,
    finalComboPrice,
    savingsAmount,
    discountPercent,
  };
}

export function normalizeSafeHttpUrl(raw?: string): string | null {
  const trimmed = (raw || '').trim();
  if (!trimmed) return null;
  try {
    const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const parsed = new URL(withProtocol);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    if (!parsed.hostname || !parsed.hostname.includes('.')) return null;
    return parsed.toString().replace(/\/+$/, '');
  } catch {
    return null;
  }
}

export function buildMarketplaceSlug(offer: ComboOffer): string {
  if (offer.marketplaceSlug?.trim()) return offer.marketplaceSlug.trim();
  const base = (offer.name || 'combo')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return `${base || 'combo'}-${offer.id.slice(-6)}`;
}

/**
 * Resolves a REAL validated Marketplace URL for scannable QR code embedding.
 * Never generates fake/placeholder links. Returns null when neither Marketplace URL nor valid custom URL is configured.
 */
export function resolveComboMarketplaceQrUrl(
  offer: ComboOffer,
  settings: Partial<ShopSettings>,
  customQrUrl?: string
): { url: string | null; isConfigured: boolean; source: 'custom' | 'marketplace' | 'website' | 'none' } {
  const custom = normalizeSafeHttpUrl(customQrUrl);
  if (custom) {
    return { url: custom, isConfigured: true, source: 'custom' };
  }

  const mktBase = normalizeSafeHttpUrl(settings.marketplaceUrl);
  const slug = buildMarketplaceSlug(offer);
  if (mktBase) {
    return { url: `${mktBase}/combo/${slug}`, isConfigured: true, source: 'marketplace' };
  }

  const siteBase = normalizeSafeHttpUrl(settings.websiteUrl);
  if (siteBase) {
    return { url: `${siteBase}/combo/${slug}`, isConfigured: true, source: 'website' };
  }

  return { url: null, isConfigured: false, source: 'none' };
}

export function buildAppPreviewComboLink(offer: ComboOffer): string {
  const origin =
    typeof window !== 'undefined' && window.location?.origin
      ? window.location.origin
      : '';
  return `${origin}/?marketplace_combo=${encodeURIComponent(offer.id)}`;
}

export function getBusinessCompletenessIssues(
  settings: ShopSettings,
  activeBranch?: Branch | null
): { missingFields: string[]; hasMarketplaceUrl: boolean } {
  const biz = resolveBusinessProfile(settings, activeBranch);
  const missingFields: string[] = [];
  if (!settings.shopName?.trim() || biz.shopName === 'My Shop') missingFields.push('Shop Name');
  if (!biz.mobile?.trim()) missingFields.push('Business Phone');
  if (!biz.address?.trim()) missingFields.push('Business Address');
  if (!biz.logoUrl?.trim()) missingFields.push('Business Logo');
  const hasMarketplaceUrl = Boolean(normalizeSafeHttpUrl(settings.marketplaceUrl));
  return { missingFields, hasMarketplaceUrl };
}

// ==============================================================================
// HIGH-DPI HTML5 CANVAS POSTER & MASTER IMAGE RENDERING
// ==============================================================================

async function loadImageForCanvas(src?: string | null): Promise<HTMLImageElement | null> {
  if (!src || typeof document === 'undefined') return null;
  const cleanSrc = src.trim();
  if (!cleanSrc) return null;

  const tryDirect = (url: string) =>
    new Promise<HTMLImageElement | null>(resolve => {
      const img = new Image();
      if (!url.startsWith('data:') && !url.startsWith('blob:')) {
        img.crossOrigin = 'anonymous';
      }
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = url;
    });

  if (cleanSrc.startsWith('data:') || cleanSrc.startsWith('blob:')) {
    return tryDirect(cleanSrc);
  }

  // Fetch as blob first so Supabase Storage CDN URLs never taint the HTML5 Canvas during PNG/JPG/PDF export
  if (typeof fetch !== 'undefined') {
    try {
      const res = await fetch(cleanSrc, { mode: 'cors', credentials: 'omit' });
      if (res.ok) {
        const blob = await res.blob();
        const objectUrl = URL.createObjectURL(blob);
        const loaded = await tryDirect(objectUrl);
        setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
        if (loaded) return loaded;
      }
    } catch {
      // Fall back to direct image load below
    }
  }

  return tryDirect(cleanSrc);
}

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function wrapTextLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number
): string[] {
  const clean = (text || '').trim();
  if (!clean) return [];
  const words = clean.split(/\s+/);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      current = word;
      if (lines.length >= maxLines) break;
    }
  }
  if (current && lines.length < maxLines) {
    lines.push(current);
  } else if (current && lines.length === maxLines) {
    const lastIdx = lines.length - 1;
    let last = lines[lastIdx];
    while (last.length > 3 && ctx.measureText(`${last}…`).width > maxWidth) {
      last = last.slice(0, -1);
    }
    lines[lastIdx] = `${last}…`;
  }
  return lines;
}

function drawContainedImage(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  boxX: number,
  boxY: number,
  boxW: number,
  boxH: number
) {
  if (!img.naturalWidth || !img.naturalHeight) return;
  const scale = Math.min(boxW / img.naturalWidth, boxH / img.naturalHeight);
  const drawW = img.naturalWidth * scale;
  const drawH = img.naturalHeight * scale;
  const dx = boxX + (boxW - drawW) / 2;
  const dy = boxY + (boxH - drawH) / 2;
  ctx.drawImage(img, dx, dy, drawW, drawH);
}

function drawTemplateDecorations(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  tpl: PosterTemplateDefinition,
  config: ComboPosterConfig
) {
  if (tpl.motif === 'style_zone') {
    const grad = ctx.createLinearGradient(0, 0, 0, height);
    grad.addColorStop(0, config.backgroundColor || '#12131A');
    grad.addColorStop(0.55, '#1D1119');
    grad.addColorStop(1, config.secondaryColor || '#D91E2A');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);

    ctx.save();
    // Warm golden radial spotlight behind fashion model
    const spot = ctx.createRadialGradient(
      width * 0.5,
      height * 0.42,
      width * 0.05,
      width * 0.5,
      height * 0.42,
      width * 0.55
    );
    spot.addColorStop(0, 'rgba(255, 210, 31, 0.24)');
    spot.addColorStop(0.55, 'rgba(217, 30, 42, 0.14)');
    spot.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = spot;
    ctx.fillRect(0, 0, width, height);

    // Bold diagonal kinetic street-fashion bars
    ctx.fillStyle = config.accentColor || '#FFD21F';
    ctx.globalAlpha = 0.12;
    ctx.beginPath();
    ctx.moveTo(0, height * 0.19);
    ctx.lineTo(width, height * 0.09);
    ctx.lineTo(width, height * 0.13);
    ctx.lineTo(0, height * 0.23);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = config.secondaryColor || '#D91E2A';
    ctx.globalAlpha = 0.26;
    ctx.beginPath();
    ctx.moveTo(0, height * 0.62);
    ctx.lineTo(width, height * 0.56);
    ctx.lineTo(width, height);
    ctx.lineTo(0, height);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    return;
  }

  const grad = ctx.createLinearGradient(0, 0, width, height);
  grad.addColorStop(0, config.backgroundColor || tpl.backgroundColor);
  grad.addColorStop(1, config.secondaryColor || tpl.secondaryColor);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  const accent = config.accentColor || tpl.accentColor;

  if (tpl.motif === 'gold_frame' || tpl.motif === 'editorial') {
    const pad = Math.round(Math.min(width, height) * 0.022);
    ctx.strokeStyle = accent;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = Math.max(2, width * 0.003);
    roundRectPath(ctx, pad, pad, width - pad * 2, height - pad * 2, 18);
    ctx.stroke();
  } else if (tpl.motif === 'crescent') {
    ctx.fillStyle = accent;
    ctx.globalAlpha = 0.1;
    ctx.beginPath();
    ctx.arc(width * 0.88, height * 0.14, width * 0.14, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = config.backgroundColor || tpl.backgroundColor;
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.arc(width * 0.91, height * 0.125, width * 0.115, 0, Math.PI * 2);
    ctx.fill();
  } else if (tpl.motif === 'geometric' || tpl.motif === 'confetti' || tpl.motif === 'frost') {
    ctx.fillStyle = accent;
    ctx.globalAlpha = 0.09;
    ctx.beginPath();
    ctx.arc(width * 0.94, height * 0.06, width * 0.22, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(width * 0.05, height * 0.92, width * 0.16, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawStarburstPath(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  outerR: number,
  innerR: number,
  points = 16
) {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outerR : innerR;
    const a = (i * Math.PI) / points - Math.PI / 2;
    const px = cx + Math.cos(a) * r;
    const py = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

export interface RenderPosterParams {
  offer: ComboOffer;
  products: Product[];
  settings: ShopSettings;
  activeBranch?: Branch | null;
  config: ComboPosterConfig;
  modelImageUrl?: string | null;
}

export interface RenderedPosterResult {
  canvases: HTMLCanvasElement[];
  items: ResolvedPosterProductItem[];
  missingImageCount: number;
  pricing: PosterPricingSummary;
  qrUrl: string | null;
  widthPx: number;
  heightPx: number;
}

export async function renderComboPosterToCanvases({
  offer,
  products,
  settings,
  activeBranch,
  config,
  modelImageUrl,
}: RenderPosterParams): Promise<RenderedPosterResult> {
  const items = resolvePosterProductItems(offer, products, config.posterProductImages);
  const pricing = computePosterPricingSummary(offer, items);
  const { widthPx, heightPx } = resolvePosterDimensions(config);
  const pages = computePosterLayoutPlan(items, config.dimensionPreset, widthPx, heightPx);
  const tpl = POSTER_TEMPLATES.find(t => t.id === config.templateId) || POSTER_TEMPLATES[0];
  const biz = resolveBusinessProfile(settings, activeBranch);
  const displayPhone = (config.shopPhoneOverride || biz.mobile || '').trim();
  const displayAddress = (config.shopAddressOverride || biz.address || '').trim();
  const currency = settings.currency || '৳';
  const formatMoney = (val: number) => formatCurrency(round2(val), 'en').replace('৳', currency);

  const qrResolved = resolveComboMarketplaceQrUrl(offer, settings, config.customQrUrl);
  const shouldDrawQr =
    config.includeQrCode && config.qrPosition !== 'hidden' && Boolean(qrResolved.url);

  const effectiveModelSrc =
    config.modelCategory === 'none'
      ? null
      : (config.aiGeneratedModelUrl || config.customModelImageUrl || modelImageUrl || '').trim() || null;

  // Optionally strip white studio backdrop for Mode 1 model showcase
  const preparedModelSrc =
    effectiveModelSrc && config.removeModelBg !== false
      ? (await removeLightBackgroundToDataUrl(effectiveModelSrc, 36)) || effectiveModelSrc
      : effectiveModelSrc;

  // Preload shop logo, QR canvas, model image, and every unique product image cleanly in parallel
  const [logoImg, qrCanvas, modelImg, ...itemImgs] = await Promise.all([
    biz.logoUrl ? loadImageForCanvas(biz.logoUrl) : Promise.resolve(null),
    shouldDrawQr && qrResolved.url
      ? (() => {
          const qc = document.createElement('canvas');
          return QRCode.toCanvas(qc, qrResolved.url, {
            width: Math.round(Math.min(widthPx, heightPx) * 0.14),
            margin: 1,
            color: { dark: '#0F172A', light: '#FFFFFF' },
          })
            .then(() => qc)
            .catch(() => null);
        })()
      : Promise.resolve(null),
    preparedModelSrc ? loadImageForCanvas(preparedModelSrc) : Promise.resolve(null),
    ...items.map(it => loadImageForCanvas(it.imageUrl)),
  ]);

  const itemImageMap = new Map<string, HTMLImageElement | null>();
  items.forEach((it, idx) => itemImageMap.set(it.itemKey, itemImgs[idx] || null));

  const FONT_FAMILY = `'Plus Jakarta Sans', 'Hind Siliguri', 'Noto Sans Bengali', -apple-system, sans-serif`;
  const DISPLAY_FONT = `'Oswald', 'Plus Jakarta Sans', 'Hind Siliguri', 'Noto Sans Bengali', sans-serif`;
  const isLightTheme =
    config.textColor.toUpperCase() === '#0F172A' ||
    config.textColor.toUpperCase() === '#1F1A17' ||
    config.textColor.toUpperCase() === '#1E293B' ||
    config.textColor.toUpperCase() === '#3B0764' ||
    config.textColor.toUpperCase() === '#4C0519';

  const useStyleZoneShowcase =
    (config.mode === 'ai_creative' ||
      config.templateId === 'style_zone_reference' ||
      Boolean(modelImg)) &&
    heightPx / Math.max(1, widthPx) >= 0.72;

  const renderedCanvases: HTMLCanvasElement[] = [];

  for (const page of pages) {
    const canvas = document.createElement('canvas');
    canvas.width = widthPx;
    canvas.height = heightPx;
    const ctx = canvas.getContext('2d');
    if (!ctx) continue;

    drawTemplateDecorations(ctx, widthPx, heightPx, tpl, config);

    if (useStyleZoneShowcase) {
      // =========================================================================
      // MODE 1: STYLE ZONE MASTER REFERENCE VISUAL LAYOUT
      // Top Logo+Shop+Slogan -> Red/Yellow/Black COMBO OFFER -> Featured Model ->
      // Product Showcase Cards joined with Plus (+) -> Strikethrough + Combo Price
      // + Savings Badge -> Premium Quality Footer + Address/Phone + CTA + QR
      // =========================================================================
      const pad = Math.round(widthPx * 0.044);
      const contentW = widthPx - pad * 2;
      let cursorY = Math.round(heightPx * 0.025);

      const accent = config.accentColor || '#FFD21F';
      const brandRed = tpl.id === 'style_zone_reference' ? '#D91E2A' : (config.secondaryColor || '#D91E2A');
      const mainTextColor = config.textColor || '#FFFFFF';

      // 1. TOP BRAND STRIP (Logo + Shop Name + Fashion Slogan Pill)
      const topH = Math.round(heightPx * 0.075);
      const logoSize = Math.round(topH * 0.85);
      let brandTextX = pad;
      if (logoImg) {
        ctx.save();
        roundRectPath(ctx, pad, cursorY, logoSize, logoSize, 12);
        ctx.fillStyle = '#FFFFFF';
        ctx.fill();
        ctx.clip();
        drawContainedImage(ctx, logoImg, pad + 4, cursorY + 4, logoSize - 8, logoSize - 8);
        ctx.restore();
        brandTextX = pad + logoSize + 14;
      }

      if (config.showShopDetails) {
        ctx.save();
        ctx.fillStyle = mainTextColor;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        const shopFont = Math.round(Math.min(widthPx, heightPx) * 0.026);
        ctx.font = `800 ${shopFont}px ${FONT_FAMILY}`;
        ctx.fillText(biz.shopName.toUpperCase(), brandTextX, cursorY + 4);

        const sloganText = (
          config.fashionSlogan ||
          biz.tagline ||
          'PREMIUM STYLE · EVERYDAY CONFIDENCE'
        ).trim();
        ctx.fillStyle = accent;
        ctx.font = `700 ${Math.round(shopFont * 0.56)}px ${FONT_FAMILY}`;
        ctx.fillText(
          sloganText.toUpperCase(),
          brandTextX,
          cursorY + Math.round(shopFont * 1.24)
        );
        ctx.restore();
      }

      if (config.promoText?.trim()) {
        const tagFont = Math.round(Math.min(widthPx, heightPx) * 0.0135);
        ctx.save();
        ctx.font = `800 ${tagFont}px ${FONT_FAMILY}`;
        const pillStr = config.promoText.trim().toUpperCase().slice(0, 32);
        const pillW = Math.min(contentW * 0.44, ctx.measureText(pillStr).width + 28);
        const pillH = Math.round(tagFont * 2.1);
        const pillX = widthPx - pad - pillW;
        const pillY = cursorY + Math.round((topH - pillH) * 0.35);
        roundRectPath(ctx, pillX, pillY, pillW, pillH, 999);
        ctx.fillStyle = accent;
        ctx.fill();
        ctx.fillStyle = '#0D0E14';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(pillStr, pillX + pillW / 2, pillY + pillH / 2);
        ctx.restore();
      }

      cursorY += topH + Math.round(heightPx * 0.008);

      // 2. BOLD RED / YELLOW / BLACK COMBO OFFER HERO HEADLINE BANNER
      const bannerH = Math.round(heightPx * 0.115);
      ctx.save();
      // Offset black hard shadow
      roundRectPath(ctx, pad + 6, cursorY + 6, contentW, bannerH, 16);
      ctx.fillStyle = '#07080C';
      ctx.fill();

      const bannerGrad = ctx.createLinearGradient(pad, cursorY, widthPx - pad, cursorY + bannerH);
      bannerGrad.addColorStop(0, '#B91C1C');
      bannerGrad.addColorStop(0.55, '#DC2626');
      bannerGrad.addColorStop(1, '#991B1B');
      roundRectPath(ctx, pad, cursorY, contentW, bannerH, 16);
      ctx.fillStyle = bannerGrad;
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = accent;
      ctx.stroke();

      // COMBO OFFER display super-header
      const superSize = Math.round(bannerH * 0.44);
      ctx.font = `900 ${superSize}px ${DISPLAY_FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillStyle = '#0A0B10';
      ctx.fillText('COMBO OFFER', widthPx / 2 + 3, cursorY + Math.round(bannerH * 0.1) + 3);
      ctx.fillStyle = accent;
      ctx.fillText('COMBO OFFER', widthPx / 2, cursorY + Math.round(bannerH * 0.1));

      // Sub-headline (Combo Offer Name)
      const subHeadSize = Math.round(bannerH * 0.23);
      ctx.font = `800 ${subHeadSize}px ${FONT_FAMILY}`;
      ctx.fillStyle = '#FFFFFF';
      const titleLines = wrapTextLines(ctx, (config.headline || offer.name).toUpperCase(), contentW - 36, 1);
      ctx.fillText(titleLines[0] || offer.name.toUpperCase(), widthPx / 2, cursorY + Math.round(bannerH * 0.62));
      ctx.restore();

      cursorY += bannerH + Math.round(heightPx * 0.012);

      // 3. CENTRAL FASHION MODEL STAGE + SAVINGS STARBURST + CALLOUT ITEMS
      const showcaseRowH = Math.round(heightPx * (page.items.length > 4 ? 0.25 : 0.19));
      const pricingFooterH = Math.round(heightPx * 0.185);
      const modelZoneBottom = heightPx - pad * 0.45 - pricingFooterH - showcaseRowH - 14;
      const modelZoneH = Math.max(Math.round(heightPx * 0.22), modelZoneBottom - cursorY);

      if (modelImg) {
        ctx.save();
        // Subtle radial stage pedestal under model
        ctx.fillStyle = 'rgba(255, 210, 31, 0.22)';
        ctx.beginPath();
        ctx.ellipse(
          widthPx * 0.5,
          cursorY + modelZoneH - 12,
          widthPx * 0.28,
          Math.max(12, modelZoneH * 0.06),
          0,
          0,
          Math.PI * 2
        );
        ctx.fill();

        const modelBoxW = widthPx * 0.62;
        const modelBoxX = (widthPx - modelBoxW) / 2;
        drawContainedImage(ctx, modelImg, modelBoxX, cursorY, modelBoxW, modelZoneH - 4);
        ctx.restore();
      } else {
        // Feature centerpiece graphic if user chose "No Model"
        ctx.save();
        roundRectPath(ctx, pad, cursorY, contentW, modelZoneH, 18);
        ctx.fillStyle = 'rgba(255,255,255,0.06)';
        ctx.fill();
        ctx.strokeStyle = accent;
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = accent;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = `900 ${Math.round(modelZoneH * 0.18)}px ${DISPLAY_FONT}`;
        ctx.fillText(
          `${items.length}-PIECE COMPLETE BUNDLE`,
          widthPx / 2,
          cursorY + modelZoneH / 2
        );
        ctx.restore();
      }

      // Floating Outfit Component Pills on Left of Model
      if (modelImg && items.length > 0) {
        const callouts = page.items.slice(0, 4);
        const pillFont = Math.max(11, Math.round(widthPx * 0.0135));
        callouts.forEach((it, idx) => {
          const py = cursorY + 14 + idx * Math.round((modelZoneH - 28) / Math.max(3, callouts.length));
          const px = pad;
          const label = `${idx + 1}. ${it.productName}`.slice(0, 22);
          ctx.save();
          ctx.font = `800 ${pillFont}px ${FONT_FAMILY}`;
          const pw = Math.min(widthPx * 0.26, ctx.measureText(label).width + 20);
          const ph = Math.round(pillFont * 1.9);
          roundRectPath(ctx, px, py, pw, ph, 8);
          ctx.fillStyle = 'rgba(13, 14, 20, 0.86)';
          ctx.fill();
          ctx.strokeStyle = accent;
          ctx.lineWidth = 1.5;
          ctx.stroke();
          ctx.fillStyle = '#FFFFFF';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.fillText(label, px + 10, py + ph / 2, pw - 16);
          ctx.restore();
        });
      }

      // Starburst Savings Badge at top-right of Model Stage
      if (config.showDiscountBadge && pricing.discountPercent > 0) {
        const starR = Math.round(Math.min(widthPx * 0.105, modelZoneH * 0.34));
        const starCx = widthPx - pad - starR - 4;
        const starCy = cursorY + starR + 6;
        ctx.save();
        drawStarburstPath(ctx, starCx + 4, starCy + 4, starR, starR * 0.8, 16);
        ctx.fillStyle = '#07080C';
        ctx.fill();

        drawStarburstPath(ctx, starCx, starCy, starR, starR * 0.8, 16);
        ctx.fillStyle = accent;
        ctx.fill();
        ctx.lineWidth = 3;
        ctx.strokeStyle = brandRed;
        ctx.stroke();

        ctx.fillStyle = '#0D0E14';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = `900 ${Math.round(starR * 0.28)}px ${FONT_FAMILY}`;
        ctx.fillText('SAVE', starCx, starCy - starR * 0.28);
        ctx.font = `900 ${Math.round(starR * 0.44)}px ${DISPLAY_FONT}`;
        ctx.fillStyle = '#B91C1C';
        ctx.fillText(`${Math.round(pricing.discountPercent)}%`, starCx, starCy + starR * 0.04);
        ctx.fillStyle = '#0D0E14';
        ctx.font = `800 ${Math.round(starR * 0.22)}px ${FONT_FAMILY}`;
        ctx.fillText(formatMoney(pricing.savingsAmount), starCx, starCy + starR * 0.38);
        ctx.restore();
      }

      cursorY += modelZoneH + 10;

      // 4. PRODUCT SHOWCASE CARDS BELOW MODEL WITH PLUS (+) SYMBOLS BETWEEN CARDS
      const rowItems = page.items;
      const cardsPerRow = rowItems.length <= 4 ? rowItems.length : Math.min(4, Math.ceil(rowItems.length / 2));
      const numCardRows = Math.max(1, Math.ceil(rowItems.length / Math.max(1, cardsPerRow)));
      const rowGap = 10;
      const colGap = Math.round(widthPx * 0.022);
      const cardRowH = (showcaseRowH - rowGap * (numCardRows - 1)) / numCardRows;

      for (let r = 0; r < numCardRows; r++) {
        const slice = rowItems.slice(r * cardsPerRow, (r + 1) * cardsPerRow);
        const nCols = slice.length;
        const cardW = (contentW - colGap * (nCols - 1)) / Math.max(1, nCols);
        const ry = cursorY + r * (cardRowH + rowGap);

        slice.forEach((item, cIdx) => {
          const cx = pad + cIdx * (cardW + colGap);
          ctx.save();
          roundRectPath(ctx, cx, ry, cardW, cardRowH, 14);
          ctx.fillStyle = tpl.cardBgColor || '#FFFFFF';
          ctx.fill();
          ctx.lineWidth = 2.5;
          ctx.strokeStyle = accent;
          ctx.stroke();

          const cPad = Math.max(6, Math.round(Math.min(cardW, cardRowH) * 0.055));
          const picH = Math.round((cardRowH - cPad * 2) * 0.62);
          const picW = cardW - cPad * 2;
          const loaded = itemImageMap.get(item.itemKey);

          ctx.save();
          roundRectPath(ctx, cx + cPad, ry + cPad, picW, picH, 10);
          ctx.fillStyle = '#F8FAFC';
          ctx.fill();
          ctx.clip();
          if (loaded) {
            drawContainedImage(ctx, loaded, cx + cPad + 2, ry + cPad + 2, picW - 4, picH - 4);
          } else {
            ctx.fillStyle = '#E2E8F0';
            ctx.fillRect(cx + cPad, ry + cPad, picW, picH);
            ctx.fillStyle = '#64748B';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.font = `700 ${Math.max(10, Math.round(cardW * 0.07))}px ${FONT_FAMILY}`;
            ctx.fillText('NO IMAGE', cx + cardW / 2, ry + cPad + picH / 2);
          }
          ctx.restore();

          // Qty pill
          const qTxt = item.isFree ? `${item.quantity}× FREE` : `${item.quantity}×`;
          const qSize = Math.max(10, Math.round(Math.min(cardW, cardRowH) * 0.08));
          ctx.font = `800 ${qSize}px ${FONT_FAMILY}`;
          const qw = ctx.measureText(qTxt).width + 12;
          const qh = Math.round(qSize * 1.55);
          roundRectPath(ctx, cx + cPad + 4, ry + cPad + 4, qw, qh, 6);
          ctx.fillStyle = item.isFree ? '#059669' : '#0D0E14';
          ctx.fill();
          ctx.fillStyle = accent;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(qTxt, cx + cPad + 4 + qw / 2, ry + cPad + 4 + qh / 2);

          // Product title + variant + regular price
          const cardDark = tpl.cardBgColor.startsWith('#1') || tpl.cardBgColor.startsWith('#0');
          const cTitleColor = cardDark ? '#F8FAFC' : '#0F172A';
          const cSubColor = cardDark ? '#CBD5E1' : '#475569';
          const tSize = Math.max(10, Math.round(Math.min(cardW * 0.085, cardRowH * 0.092)));
          let ty = ry + cPad + picH + 6;
          ctx.fillStyle = cTitleColor;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';
          ctx.font = `800 ${tSize}px ${FONT_FAMILY}`;
          const pLines = wrapTextLines(ctx, item.productName, picW, 1);
          ctx.fillText(pLines[0] || item.productName, cx + cardW / 2, ty);
          ty += Math.round(tSize * 1.18);

          if (item.variantDetails) {
            ctx.fillStyle = cSubColor;
            ctx.font = `600 ${Math.max(9, Math.round(tSize * 0.82))}px ${FONT_FAMILY}`;
            const vLine = wrapTextLines(ctx, item.variantDetails, picW, 1)[0] || '';
            ctx.fillText(vLine, cx + cardW / 2, ty);
            ty += Math.round(tSize * 1.0);
          }

          if (config.showPrices) {
            ctx.fillStyle = item.isFree ? '#059669' : '#B91C1C';
            ctx.font = `800 ${Math.max(10, Math.round(tSize * 0.92))}px ${FONT_FAMILY}`;
            ctx.fillText(
              item.isFree ? 'FREE' : formatMoney(item.lineRegularTotal),
              cx + cardW / 2,
              Math.min(ty, ry + cardRowH - cPad - tSize)
            );
          }
          ctx.restore();

          // Draw Plus (+) Connector Badge between consecutive cards on the same row!
          if (cIdx < nCols - 1) {
            const plusX = cx + cardW + colGap / 2;
            const plusY = ry + cardRowH * 0.42;
            const plusR = Math.max(12, Math.min(22, Math.round(colGap * 0.82)));
            ctx.save();
            ctx.beginPath();
            ctx.arc(plusX, plusY, plusR, 0, Math.PI * 2);
            ctx.fillStyle = accent;
            ctx.fill();
            ctx.lineWidth = 3;
            ctx.strokeStyle = '#0D0E14';
            ctx.stroke();

            ctx.fillStyle = '#0D0E14';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.font = `900 ${Math.round(plusR * 1.35)}px ${FONT_FAMILY}`;
            ctx.fillText('+', plusX, plusY + 1);
            ctx.restore();
          }
        });
      }

      // 5. BOTTOM PRICING CONVERSION BANNER + SHOP NOW CTA + TRUST STRIP + QR CODE
      const footY = heightPx - pad * 0.45 - pricingFooterH;
      ctx.save();
      roundRectPath(ctx, pad, footY, contentW, pricingFooterH, 16);
      ctx.fillStyle = '#0A0B10';
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = accent;
      ctx.stroke();

      const qrBoxSize = qrCanvas ? Math.round(Math.min(pricingFooterH * 0.72, widthPx * 0.135)) : 0;
      const qrLeft =
        qrCanvas && config.qrPosition === 'bottom_left'
          ? pad + 14
          : qrCanvas
          ? widthPx - pad - 14 - qrBoxSize
          : 0;

      if (qrCanvas) {
        const qy = footY + Math.round((pricingFooterH - qrBoxSize) / 2);
        roundRectPath(ctx, qrLeft - 5, qy - 5, qrBoxSize + 10, qrBoxSize + 10, 10);
        ctx.fillStyle = '#FFFFFF';
        ctx.fill();
        ctx.drawImage(qrCanvas, qrLeft, qy, qrBoxSize, qrBoxSize);
      }

      const bodyLeft = qrCanvas && config.qrPosition === 'bottom_left' ? qrLeft + qrBoxSize + 20 : pad + 20;
      const bodyRight = qrCanvas && config.qrPosition === 'bottom_right' ? qrLeft - 18 : widthPx - pad - 20;
      const bodyW = Math.max(200, bodyRight - bodyLeft);

      const priceTop = footY + Math.round(pricingFooterH * 0.11);
      const comboPriceSize = Math.round(Math.min(widthPx, heightPx) * 0.044);
      const smallFont = Math.round(Math.min(widthPx, heightPx) * 0.0145);

      // Regular strikethrough price
      if (pricing.savingsAmount > 0) {
        ctx.font = `700 ${Math.round(smallFont * 1.15)}px ${FONT_FAMILY}`;
        ctx.fillStyle = '#CBD5E1';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        const regStr = `REGULAR ${formatMoney(pricing.regularTotalPrice)}`;
        ctx.fillText(regStr, bodyLeft, priceTop);
        const rw = ctx.measureText(regStr).width;
        ctx.strokeStyle = '#EF4444';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(bodyLeft, priceTop + Math.round(smallFont * 0.65));
        ctx.lineTo(bodyLeft + rw, priceTop + Math.round(smallFont * 0.65));
        ctx.stroke();
      } else {
        ctx.font = `800 ${smallFont}px ${FONT_FAMILY}`;
        ctx.fillStyle = accent;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText('COMBO OFFER PRICE', bodyLeft, priceTop);
      }

      // Highlighted Combo Price
      const comboPriceY = priceTop + Math.round(smallFont * 1.45);
      ctx.font = `900 ${comboPriceSize}px ${DISPLAY_FONT}`;
      ctx.fillStyle = accent;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      const cpStr = formatMoney(pricing.finalComboPrice);
      ctx.fillText(cpStr, bodyLeft, comboPriceY);
      const cpW = ctx.measureText(cpStr).width;

      // Instant Savings Pill beside price
      if (pricing.savingsAmount > 0 && cpW + 170 < bodyW) {
        const savTxt = `SAVE ${formatMoney(pricing.savingsAmount)}`;
        ctx.font = `800 ${smallFont}px ${FONT_FAMILY}`;
        const sw = Math.min(bodyW - cpW - 16, ctx.measureText(savTxt).width + 20);
        const sh = Math.round(smallFont * 1.9);
        const sx = bodyLeft + cpW + 14;
        const sy = comboPriceY + Math.round((comboPriceSize - sh) * 0.5);
        roundRectPath(ctx, sx, sy, sw, sh, 8);
        ctx.fillStyle = '#DC2626';
        ctx.fill();
        ctx.fillStyle = '#FFFFFF';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(savTxt, sx + sw / 2, sy + sh / 2);
      }

      // SHOP NOW CTA Button on right of pricing zone
      const ctaStr = (config.ctaText || 'SHOP NOW').trim().toUpperCase();
      ctx.font = `900 ${Math.round(smallFont * 1.1)}px ${FONT_FAMILY}`;
      const ctaW = Math.min(180, Math.max(115, ctx.measureText(ctaStr).width + 34));
      const ctaH = Math.round(smallFont * 2.5);
      const ctaX = bodyRight - ctaW;
      const ctaY = priceTop + 4;
      if (ctaX > bodyLeft + cpW + 10) {
        roundRectPath(ctx, ctaX, ctaY, ctaW, ctaH, 999);
        ctx.fillStyle = accent;
        ctx.fill();
        ctx.fillStyle = '#0D0E14';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(ctaStr, ctaX + ctaW / 2, ctaY + ctaH / 2);
      }

      // Trust & Guarantee strip + Contact Line
      const trustY = footY + Math.round(pricingFooterH * 0.62);
      ctx.fillStyle = '#F8FAFC';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.font = `700 ${Math.max(10, Math.round(smallFont * 0.85))}px ${FONT_FAMILY}`;
      ctx.fillText(
        (config.trustLine || 'PREMIUM QUALITY · BEST DISCOUNT · LIMITED STOCK').toUpperCase(),
        bodyLeft,
        trustY,
        bodyW
      );

      const contactStr = [
        displayPhone ? `Call / WhatsApp: ${displayPhone}` : '',
        displayAddress || '',
        biz.socialMedia || biz.websiteUrl || '',
      ]
        .filter(Boolean)
        .join('  ·  ');

      ctx.fillStyle = '#94A3B8';
      ctx.font = `600 ${Math.max(10, Math.round(smallFont * 0.8))}px ${FONT_FAMILY}`;
      const cLine = wrapTextLines(ctx, contactStr || config.footerText, bodyW, 1)[0] || '';
      ctx.fillText(cLine, bodyLeft, footY + pricingFooterH - Math.round(smallFont * 1.4));

      ctx.restore();
      renderedCanvases.push(canvas);
      continue;
    }

    const pad = Math.round(widthPx * 0.048);
    const contentW = widthPx - pad * 2;
    const isShortBanner = heightPx / widthPx < 0.72;

    // 1. HEADER BAR: Shop Logo + Shop Name + Branch
    const headerH = Math.round(heightPx * (isShortBanner ? 0.15 : 0.115));
    let cursorY = Math.round(pad * 0.8);

    const logoBoxSize = Math.round(headerH * 0.8);
    const drawShopIdentity = () => {
      if (!config.showShopDetails && !logoImg) return;
      const centerMode = config.logoPosition === 'top_center';
      const rightMode = config.logoPosition === 'top_right';

      let textStartX = pad;
      if (logoImg) {
        const logoX = centerMode
          ? widthPx / 2 - logoBoxSize / 2
          : rightMode
          ? widthPx - pad - logoBoxSize
          : pad;
        ctx.save();
        roundRectPath(ctx, logoX, cursorY, logoBoxSize, logoBoxSize, 12);
        ctx.fillStyle = '#FFFFFF';
        ctx.fill();
        ctx.clip();
        drawContainedImage(ctx, logoImg, logoX + 4, cursorY + 4, logoBoxSize - 8, logoBoxSize - 8);
        ctx.restore();
        if (!centerMode && !rightMode) textStartX = pad + logoBoxSize + 16;
      }

      if (config.showShopDetails) {
        ctx.save();
        ctx.fillStyle = config.textColor || tpl.textColor;
        ctx.textAlign = centerMode ? 'center' : rightMode && !logoImg ? 'right' : 'left';
        const anchorX = centerMode
          ? widthPx / 2
          : rightMode && logoImg
          ? pad
          : rightMode
          ? widthPx - pad
          : textStartX;
        const nameY = centerMode && logoImg ? cursorY + logoBoxSize + 24 : cursorY + Math.round(logoBoxSize * 0.45);
        ctx.font = `800 ${Math.round(Math.min(widthPx, heightPx) * 0.025)}px ${FONT_FAMILY}`;
        ctx.fillText(biz.shopName, anchorX, nameY);

        if (config.showBranchInfo && (biz.branchName || biz.tagline)) {
          ctx.globalAlpha = 0.78;
          ctx.font = `600 ${Math.round(Math.min(widthPx, heightPx) * 0.015)}px ${FONT_FAMILY}`;
          const subLine = [
            biz.branchName ? `${biz.branchName} Branch` : '',
            biz.tagline || '',
          ]
            .filter(Boolean)
            .join(' · ');
          ctx.fillText(subLine, anchorX, nameY + Math.round(Math.min(widthPx, heightPx) * 0.024));
        }
        ctx.restore();
      }
    };
    drawShopIdentity();

    // Top-right Promo / Discount Badge (if discount > 0 & showDiscountBadge)
    if (config.showDiscountBadge && pricing.discountPercent > 0 && config.logoPosition !== 'top_right') {
      const badgeW = Math.round(widthPx * 0.24);
      const badgeH = Math.round(Math.min(widthPx, heightPx) * 0.068);
      const badgeX = widthPx - pad - badgeW;
      const badgeY = cursorY + 4;
      ctx.save();
      roundRectPath(ctx, badgeX, badgeY, badgeW, badgeH, 14);
      ctx.fillStyle = config.accentColor || tpl.badgeBgColor;
      ctx.fill();
      ctx.fillStyle = isLightTheme ? '#FFFFFF' : tpl.badgeTextColor;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `800 ${Math.round(badgeH * 0.36)}px ${FONT_FAMILY}`;
      ctx.fillText(`SAVE ${pricing.discountPercent}%`, badgeX + badgeW / 2, badgeY + badgeH / 2);
      ctx.restore();
    }

    cursorY += headerH + Math.round(heightPx * (config.logoPosition === 'top_center' && logoImg ? 0.035 : 0.008));

    // 2. HERO HEADLINE & PROMO PILL
    const heroH = Math.round(heightPx * (isShortBanner ? 0.14 : 0.105));
    const centerHeroX = widthPx / 2;
    ctx.save();
    if (config.promoText?.trim()) {
      const promoFontSize = Math.round(Math.min(widthPx, heightPx) * 0.016);
      ctx.font = `800 ${promoFontSize}px ${FONT_FAMILY}`;
      const promoStr = config.promoText.trim().toUpperCase();
      const pillW = Math.min(contentW, ctx.measureText(promoStr).width + 36);
      const pillH = Math.round(promoFontSize * 1.9);
      roundRectPath(ctx, centerHeroX - pillW / 2, cursorY, pillW, pillH, 999);
      ctx.fillStyle = config.accentColor || tpl.accentColor;
      ctx.fill();
      ctx.fillStyle = isLightTheme ? '#FFFFFF' : tpl.badgeTextColor;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(promoStr, centerHeroX, cursorY + pillH / 2);
      cursorY += pillH + Math.round(heightPx * 0.014);
    }

    const headlineFontSize = Math.round(Math.min(widthPx, heightPx) * (isShortBanner ? 0.042 : 0.038));
    ctx.font = `900 ${headlineFontSize}px ${FONT_FAMILY}`;
    ctx.fillStyle = config.textColor || tpl.textColor;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const headlineLines = wrapTextLines(ctx, config.headline || offer.name, contentW, 2);
    headlineLines.forEach((line, i) => {
      ctx.fillText(line, centerHeroX, cursorY + i * Math.round(headlineFontSize * 1.15));
    });
    cursorY += headlineLines.length * Math.round(headlineFontSize * 1.15) + Math.round(heightPx * 0.012);

    if (pages.length > 1) {
      ctx.globalAlpha = 0.8;
      ctx.font = `700 ${Math.round(Math.min(widthPx, heightPx) * 0.015)}px ${FONT_FAMILY}`;
      ctx.fillText(
        `Included Products — Page ${page.pageIndex + 1} of ${page.totalPages} (${items.length} items total)`,
        centerHeroX,
        cursorY
      );
      cursorY += Math.round(heightPx * 0.025);
    }
    ctx.restore();

    // 3. PRODUCT SHOWCASE GRID (NEVER OMITS ANY ITEM)
    const footerBlockH = Math.round(heightPx * (isShortBanner ? 0.23 : 0.19));
    const gridTop = cursorY + 6;
    const gridBottom = heightPx - pad * 0.7 - footerBlockH;
    const gridAvailH = Math.max(180, gridBottom - gridTop);

    const gap = Math.round(Math.min(widthPx, heightPx) * 0.018);
    const cellW = (contentW - gap * (page.cols - 1)) / page.cols;
    const cellH = (gridAvailH - gap * (page.rows - 1)) / page.rows;

    const fontScale =
      config.productFontSize === 'lg' ? 1.14 : config.productFontSize === 'sm' ? 0.88 : 1.0;
    const imgSizeRatio =
      config.productImageSize === 'large' ? 0.68 : config.productImageSize === 'compact' ? 0.52 : 0.60;

    page.items.forEach((item, localIdx) => {
      const col = localIdx % page.cols;
      const row = Math.floor(localIdx / page.cols);
      const cardX = pad + col * (cellW + gap);
      const cardY = gridTop + row * (cellH + gap);

      ctx.save();
      roundRectPath(ctx, cardX, cardY, cellW, cellH, 16);
      ctx.fillStyle = tpl.cardBgColor;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = tpl.cardBorderColor;
      ctx.stroke();

      const cardPad = Math.round(Math.min(cellW, cellH) * 0.055);
      const imgAreaH = Math.round((cellH - cardPad * 2) * imgSizeRatio);
      const imgBoxW = cellW - cardPad * 2;
      const imgBoxX = cardX + cardPad;
      const imgBoxY = cardY + cardPad;

      // White crisp backing behind photo
      ctx.save();
      roundRectPath(ctx, imgBoxX, imgBoxY, imgBoxW, imgAreaH, 12);
      ctx.fillStyle = '#FFFFFF';
      ctx.fill();
      ctx.clip();

      const loadedImg = itemImageMap.get(item.itemKey);
      if (loadedImg) {
        drawContainedImage(ctx, loadedImg, imgBoxX + 4, imgBoxY + 4, imgBoxW - 8, imgAreaH - 8);
      } else {
        // Explicit visual placeholder indicating missing image
        ctx.fillStyle = '#F1F5F9';
        ctx.fillRect(imgBoxX, imgBoxY, imgBoxW, imgAreaH);
        ctx.fillStyle = '#94A3B8';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = `700 ${Math.max(11, Math.round(cellW * 0.055))}px ${FONT_FAMILY}`;
        ctx.fillText('IMAGE MISSING', imgBoxX + imgBoxW / 2, imgBoxY + imgAreaH / 2);
      }
      ctx.restore();

      // Quantity Badge on top-left of card
      const qtyPillText = item.isFree ? `${item.quantity}× FREE` : `${item.quantity}×`;
      const qFontSize = Math.max(11, Math.round(Math.min(cellW, cellH) * 0.062));
      ctx.font = `800 ${qFontSize}px ${FONT_FAMILY}`;
      const qPillW = ctx.measureText(qtyPillText).width + 18;
      const qPillH = Math.round(qFontSize * 1.65);
      roundRectPath(ctx, imgBoxX + 6, imgBoxY + 6, qPillW, qPillH, 8);
      ctx.fillStyle = item.isFree ? '#059669' : config.accentColor || tpl.accentColor;
      ctx.fill();
      ctx.fillStyle = item.isFree ? '#FFFFFF' : isLightTheme ? '#FFFFFF' : tpl.badgeTextColor;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(qtyPillText, imgBoxX + 6 + qPillW / 2, imgBoxY + 6 + qPillH / 2);

      // Card text zone
      const cardIsDark =
        tpl.cardBgColor.startsWith('#0') ||
        tpl.cardBgColor.startsWith('#1') ||
        tpl.cardBgColor.startsWith('#2');
      const cardTextColor = cardIsDark ? '#F8FAFC' : '#0F172A';
      const cardSubColor = cardIsDark ? '#CBD5E1' : '#475569';

      let textY = imgBoxY + imgAreaH + Math.max(8, Math.round(cardPad * 0.7));
      const titleFont = Math.max(
        11,
        Math.round(Math.min(cellW * 0.072, cellH * 0.078) * fontScale)
      );
      ctx.font = `700 ${titleFont}px ${FONT_FAMILY}`;
      ctx.fillStyle = cardTextColor;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      const nameLines = wrapTextLines(ctx, item.productName, imgBoxW, 2);
      nameLines.forEach((line, lIdx) => {
        ctx.fillText(line, imgBoxX, textY + lIdx * Math.round(titleFont * 1.15));
      });
      textY += nameLines.length * Math.round(titleFont * 1.15) + 4;

      if (item.variantDetails) {
        const subFont = Math.max(10, Math.round(titleFont * 0.78));
        ctx.font = `600 ${subFont}px ${FONT_FAMILY}`;
        ctx.fillStyle = cardSubColor;
        const vLines = wrapTextLines(ctx, item.variantDetails, imgBoxW, 1);
        if (vLines[0]) {
          ctx.fillText(vLines[0], imgBoxX, textY);
          textY += Math.round(subFont * 1.25);
        }
      }

      if (config.showPrices) {
        const priceFont = Math.max(11, Math.round(titleFont * 0.88));
        ctx.font = `700 ${priceFont}px ${FONT_FAMILY}`;
        ctx.fillStyle = item.isFree ? '#059669' : config.accentColor || tpl.accentColor;
        const priceText = item.isFree ? 'FREE GIFT' : formatMoney(item.lineRegularTotal);
        ctx.fillText(priceText, imgBoxX, Math.min(textY + 2, cardY + cellH - cardPad - priceFont));
      }

      ctx.restore();
    });

    // 4. BOTTOM PRICING CALLOUT + BUSINESS FOOTER + QR CODE
    const footerY = heightPx - pad * 0.7 - footerBlockH + Math.round(heightPx * 0.012);
    const footerBoxH = footerBlockH - Math.round(heightPx * 0.015);
    ctx.save();
    roundRectPath(ctx, pad, footerY, contentW, footerBoxH, 18);
    ctx.fillStyle = config.secondaryColor || tpl.secondaryColor;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = config.accentColor || tpl.accentColor;
    ctx.stroke();

    const qrBoxSize = qrCanvas ? Math.round(Math.min(footerBoxH * 0.82, widthPx * 0.14)) : 0;
    const qrLeft =
      qrCanvas && config.qrPosition === 'bottom_left'
        ? pad + 18
        : qrCanvas
        ? widthPx - pad - 18 - qrBoxSize
        : 0;

    if (qrCanvas) {
      const qrY = footerY + Math.round((footerBoxH - qrBoxSize) / 2);
      ctx.save();
      roundRectPath(ctx, qrLeft - 6, qrY - 6, qrBoxSize + 12, qrBoxSize + 12, 10);
      ctx.fillStyle = '#FFFFFF';
      ctx.fill();
      ctx.drawImage(qrCanvas, qrLeft, qrY, qrBoxSize, qrBoxSize);
      ctx.restore();
    }

    const leftTextX =
      qrCanvas && config.qrPosition === 'bottom_left' ? qrLeft + qrBoxSize + 24 : pad + 22;
    const rightLimitX =
      qrCanvas && config.qrPosition === 'bottom_right' ? qrLeft - 22 : widthPx - pad - 22;
    const infoAvailW = Math.max(180, rightLimitX - leftTextX);

    // Pricing Row inside Footer
    const bigPriceFont = Math.round(Math.min(widthPx, heightPx) * (isShortBanner ? 0.044 : 0.040));
    const smallLabelFont = Math.round(Math.min(widthPx, heightPx) * 0.016);
    const innerTop = footerY + Math.round(footerBoxH * 0.14);

    ctx.fillStyle = config.accentColor || tpl.accentColor;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.font = `800 ${smallLabelFont}px ${FONT_FAMILY}`;
    ctx.fillText('COMBO OFFER PRICE', leftTextX, innerTop);

    ctx.fillStyle = config.textColor || tpl.textColor;
    ctx.font = `900 ${bigPriceFont}px ${FONT_FAMILY}`;
    const comboPriceStr = formatMoney(pricing.finalComboPrice);
    ctx.fillText(comboPriceStr, leftTextX, innerTop + Math.round(smallLabelFont * 1.2));
    const priceWidth = ctx.measureText(comboPriceStr).width;

    if (pricing.savingsAmount > 0) {
      const regX = leftTextX + priceWidth + 18;
      if (regX + 120 < rightLimitX) {
        ctx.font = `600 ${Math.round(smallLabelFont * 1.05)}px ${FONT_FAMILY}`;
        ctx.fillStyle = config.textColor || tpl.textColor;
        ctx.globalAlpha = 0.72;
        const regText = `Regular ${formatMoney(pricing.regularTotalPrice)}`;
        ctx.fillText(regText, regX, innerTop + Math.round(smallLabelFont * 1.25));
        const regW = ctx.measureText(regText).width;
        ctx.strokeStyle = config.textColor || tpl.textColor;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(regX, innerTop + Math.round(smallLabelFont * 1.85));
        ctx.lineTo(regX + regW, innerTop + Math.round(smallLabelFont * 1.85));
        ctx.stroke();

        ctx.globalAlpha = 1;
        ctx.fillStyle = config.accentColor || tpl.accentColor;
        ctx.font = `800 ${Math.round(smallLabelFont * 1.08)}px ${FONT_FAMILY}`;
        ctx.fillText(
          `You Save ${formatMoney(pricing.savingsAmount)} (${pricing.discountPercent}% OFF)`,
          regX,
          innerTop + Math.round(smallLabelFont * 2.5)
        );
      }
    }

    // Contact & Footer Info bottom lines
    const contactLineY = footerY + Math.round(footerBoxH * 0.64);
    ctx.fillStyle = config.textColor || tpl.textColor;
    ctx.globalAlpha = 0.88;
    ctx.font = `600 ${Math.max(11, Math.round(smallLabelFont * 0.88))}px ${FONT_FAMILY}`;
    const contactParts = [
      biz.mobile ? `Call: ${biz.mobile}` : '',
      biz.address || '',
      biz.socialMedia || biz.websiteUrl || '',
    ]
      .filter(Boolean)
      .join('  ·  ');
    const cLines = wrapTextLines(ctx, contactParts || config.footerText, infoAvailW, 2);
    cLines.forEach((l, i) => {
      ctx.fillText(l, leftTextX, contactLineY + i * Math.round(smallLabelFont * 1.1));
    });

    if (config.footerText && contactParts) {
      ctx.globalAlpha = 0.68;
      ctx.font = `500 ${Math.max(10, Math.round(smallLabelFont * 0.78))}px ${FONT_FAMILY}`;
      const fLines = wrapTextLines(ctx, config.footerText, infoAvailW, 1);
      if (fLines[0]) {
        ctx.fillText(fLines[0], leftTextX, footerY + footerBoxH - Math.round(smallLabelFont * 1.35));
      }
    }

    ctx.restore();
    renderedCanvases.push(canvas);
  }

  return {
    canvases: renderedCanvases,
    items,
    missingImageCount: items.filter(i => i.hasMissingImage).length,
    pricing,
    qrUrl: shouldDrawQr ? qrResolved.url : null,
    widthPx,
    heightPx,
  };
}

/**
 * Generates a clean Product-Only Composition (Combo Master Image) containing ONLY
 * the combo's included product photos arranged neatly together on a clean backdrop—
 * NO promotional badges, NO headline text, NO discount tags, NO price clutter.
 */
export async function renderComboMasterCompositionDataUrl(
  offer: ComboOffer,
  products: Product[],
  posterProductImages?: Record<string, string>,
  sizePx = 720
): Promise<string> {
  const items = resolvePosterProductItems(offer, products, posterProductImages);
  const loadedImgs = await Promise.all(items.map(it => loadImageForCanvas(it.imageUrl)));

  const canvas = document.createElement('canvas');
  canvas.width = sizePx;
  canvas.height = sizePx;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  // Clean soft studio backdrop
  const bg = ctx.createLinearGradient(0, 0, sizePx, sizePx);
  bg.addColorStop(0, '#F8FAFC');
  bg.addColorStop(1, '#EEF2F7');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, sizePx, sizePx);

  const visible = items.slice(0, 12);
  const n = Math.max(1, visible.length);
  const cols = n === 1 ? 1 : n <= 4 ? 2 : 3;
  const rows = Math.ceil(n / cols);
  const pad = Math.round(sizePx * 0.045);
  const gap = Math.round(sizePx * 0.03);
  const cellW = (sizePx - pad * 2 - gap * (cols - 1)) / cols;
  const cellH = (sizePx - pad * 2 - gap * (rows - 1)) / rows;

  visible.forEach((_, idx) => {
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    const x = pad + col * (cellW + gap);
    const y = pad + row * (cellH + gap);

    ctx.save();
    roundRectPath(ctx, x, y, cellW, cellH, 16);
    ctx.fillStyle = '#FFFFFF';
    ctx.fill();
    ctx.strokeStyle = '#E2E8F0';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.clip();

    const img = loadedImgs[idx];
    if (img) {
      drawContainedImage(ctx, img, x + 8, y + 8, cellW - 16, cellH - 16);
    } else {
      ctx.fillStyle = '#F1F5F9';
      ctx.fillRect(x, y, cellW, cellH);
      ctx.fillStyle = '#94A3B8';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '700 16px sans-serif';
      ctx.fillText(`#${idx + 1}`, x + cellW / 2, y + cellH / 2);
    }
    ctx.restore();
  });

  if (items.length > 12) {
    ctx.fillStyle = 'rgba(15, 23, 42, 0.82)';
    roundRectPath(ctx, sizePx - 140, sizePx - 48, 122, 32, 999);
    ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '700 13px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`+${items.length - 12} more`, sizePx - 79, sizePx - 32);
  }

  return canvas.toDataURL('image/jpeg', 0.86);
}

/**
 * Exports a compact JPEG Data URL (max 720px edge) suitable for storing as the Combo Offer's poster/master preview image cleanly.
 */
export function buildCompactPosterDataUrl(firstCanvas: HTMLCanvasElement, maxEdge = 720): string {
  const ratio = Math.min(1, maxEdge / Math.max(firstCanvas.width, firstCanvas.height));
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(firstCanvas.width * ratio));
  out.height = Math.max(1, Math.round(firstCanvas.height * ratio));
  const ctx = out.getContext('2d');
  if (!ctx) return firstCanvas.toDataURL('image/jpeg', 0.84);
  ctx.drawImage(firstCanvas, 0, 0, out.width, out.height);
  return out.toDataURL('image/jpeg', 0.84);
}

export function buildPosterFilename(offerName: string, preset: PosterDimensionPreset): string {
  const slug = (offerName || 'combo-poster')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
  return `${slug || 'combo-poster'}-${preset}`;
}

export function downloadPosterCanvasesAsImages(
  canvases: HTMLCanvasElement[],
  format: 'png' | 'jpeg',
  baseFilename: string
): void {
  const mime = format === 'png' ? 'image/png' : 'image/jpeg';
  const ext = format === 'png' ? 'png' : 'jpg';
  canvases.forEach((canvas, idx) => {
    const dataUrl = canvas.toDataURL(mime, 0.94);
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = canvases.length > 1 ? `${baseFilename}-page-${idx + 1}.${ext}` : `${baseFilename}.${ext}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  });
}

export function downloadPosterCanvasesAsPdf(
  canvases: HTMLCanvasElement[],
  dimensionPreset: PosterDimensionPreset,
  widthPx: number,
  heightPx: number,
  baseFilename: string
): void {
  if (canvases.length === 0) return;

  const isA3 = dimensionPreset === 'a3_portrait' || dimensionPreset === 'a3_landscape';
  const isA4 = dimensionPreset === 'a4_portrait' || dimensionPreset === 'a4_landscape';
  const isA5 = dimensionPreset === 'a5_portrait' || dimensionPreset === 'a5_landscape';
  const orientation = widthPx >= heightPx ? 'landscape' : 'portrait';

  const doc = isA4
    ? new jsPDF({ orientation, unit: 'mm', format: 'a4' })
    : isA5
    ? new jsPDF({ orientation, unit: 'mm', format: 'a5' })
    : isA3
    ? new jsPDF({ orientation, unit: 'mm', format: 'a3' })
    : new jsPDF({
        orientation,
        unit: 'px',
        format: [widthPx, heightPx],
      });

  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();

  canvases.forEach((canvas, idx) => {
    if (idx > 0) doc.addPage();
    const imgData = canvas.toDataURL('image/jpeg', 0.94);
    doc.addImage(imgData, 'JPEG', 0, 0, pageW, pageH, undefined, 'FAST');
  });

  doc.save(`${baseFilename}.pdf`);
}

export function printPosterCanvases(
  canvases: HTMLCanvasElement[],
  dimensionPreset: PosterDimensionPreset,
  widthPx: number,
  heightPx: number,
  title: string
): PrintResult {
  if (canvases.length === 0) {
    return { opened: false, error: 'Poster is still rendering.' };
  }
  const orientation = widthPx >= heightPx ? 'landscape' : 'portrait';
  const pageCssSize =
    dimensionPreset === 'a3_portrait'
      ? 'A3 portrait'
      : dimensionPreset === 'a3_landscape'
      ? 'A3 landscape'
      : dimensionPreset === 'a5_portrait'
      ? 'A5 portrait'
      : dimensionPreset === 'a5_landscape'
      ? 'A5 landscape'
      : dimensionPreset === 'a4_landscape'
      ? 'A4 landscape'
      : `A4 ${orientation}`;

  const imgsHtml = canvases
    .map(
      (c, i) => `
      <div class="poster-page" style="${i < canvases.length - 1 ? 'page-break-after: always;' : ''}">
        <img src="${c.toDataURL('image/png')}" alt="${title} Page ${i + 1}" />
      </div>`
    )
    .join('');

  const html = `<!DOCTYPE html>
  <html class="adp-poster-doc">
    <head>
      <meta charset="utf-8" />
      <title>${title}</title>
      <style>
        @page { size: ${pageCssSize}; margin: 0; }
        html.adp-poster-doc, html.adp-poster-doc body { margin: 0; padding: 0; background: #fff; }
        .poster-page {
          width: 100vw;
          height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          overflow: hidden;
        }
        .poster-page img {
          max-width: 100%;
          max-height: 100%;
          object-fit: contain;
          display: block;
        }
      </style>
    </head>
    <body>${imgsHtml}</body>
  </html>`;

  return printDocument(html, title);
}
