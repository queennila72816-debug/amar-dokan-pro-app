import QRCode from 'qrcode';
import {
  Branch,
  ComboOffer,
  ComboPosterConfig,
  PosterBadgeLayer,
  PosterCanvasLayer,
  PosterCustomProject,
  PosterImageLayer,
  PosterQrLayer,
  PosterShapeLayer,
  PosterStickerLayer,
  PosterTextLayer,
  PosterUserTemplate,
  Product,
  ShopSettings,
} from '../types';
import { resolveBusinessProfile } from '../config/appIdentity';
import { formatCurrency } from './formatters';
import {
  POSTER_TEMPLATES,
  computePosterPricingSummary,
  resolveComboMarketplaceQrUrl,
  resolvePosterDimensions,
  resolvePosterProductItems,
} from './comboPosterEngine';
import { loadProcessedLayerImage, loadRawImageElement } from './posterCanvasEffects';

const round2 = (n: number): number => Math.round((Number(n) || 0) * 100) / 100;

export function makeLayerId(prefix = 'layer'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function createBlankCustomProject(
  canvasWidth = 1080,
  canvasHeight = 1350,
  backgroundColor = '#12131A'
): PosterCustomProject {
  return {
    version: 2,
    canvasWidth,
    canvasHeight,
    backgroundColor,
    backgroundGradientEnabled: true,
    backgroundGradientEnd: '#2B0D16',
    layers: [],
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Materializes a Mode 1 Style Zone / Template design into individual, fully editable layers
 * so the user can enter Mode 2 (Custom Design Studio) and move, resize, rotate, crop,
 * style, group, align, or delete every object freely.
 */
export function generateEditableLayersFromStyleZoneConfig(params: {
  offer: ComboOffer;
  products: Product[];
  settings: ShopSettings;
  activeBranch?: Branch | null;
  config: ComboPosterConfig;
  modelImageUrl?: string | null;
}): PosterCustomProject {
  const { offer, products, settings, activeBranch, config, modelImageUrl } = params;
  const items = resolvePosterProductItems(offer, products, config.posterProductImages);
  const pricing = computePosterPricingSummary(offer, items);
  const { widthPx: W, heightPx: H } = resolvePosterDimensions(config);
  const tpl = POSTER_TEMPLATES.find(t => t.id === config.templateId) || POSTER_TEMPLATES[0];
  const biz = resolveBusinessProfile(settings, activeBranch);
  const displayPhone = (config.shopPhoneOverride || biz.mobile || '').trim();
  const displayAddress = (config.shopAddressOverride || biz.address || '').trim();
  const currency = settings.currency || '৳';
  const formatMoney = (val: number) => formatCurrency(round2(val), 'en').replace('৳', currency);

  const isStyleZone =
    config.mode === 'ai_creative' || config.templateId === 'style_zone_reference';
  const accent = config.accentColor || tpl.accentColor || '#FFD21F';
  const secondary = config.secondaryColor || tpl.secondaryColor || '#D91E2A';
  const bgStart = config.backgroundColor || tpl.backgroundColor || '#12131A';
  const textPrimary = config.textColor || tpl.textColor || '#FFFFFF';

  const pad = Math.round(W * 0.044);
  const contentW = W - pad * 2;
  let z = 1;
  const nextZ = () => z++;

  const layers: PosterCanvasLayer[] = [];

  // 1. Header Logo
  const topH = Math.round(H * 0.072);
  let headerTextX = pad;
  if (biz.logoUrl) {
    const logoSize = Math.round(topH * 0.85);
    layers.push({
      id: makeLayerId('logo'),
      name: 'Shop Logo',
      type: 'image',
      src: biz.logoUrl,
      fit: 'contain',
      x: pad,
      y: Math.round(H * 0.025),
      width: logoSize,
      height: logoSize,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      zIndex: nextZ(),
      borderRadius: 12,
      backgroundColor: '#FFFFFF',
      tagRole: 'logo',
    });
    headerTextX = pad + logoSize + 14;
  }

  // 2. Shop Name + Slogan
  if (config.showShopDetails) {
    layers.push({
      id: makeLayerId('shopname'),
      name: 'Shop Name',
      type: 'text',
      text: biz.shopName.toUpperCase(),
      fontFamily: 'Plus Jakarta Sans',
      fontSize: Math.round(Math.min(W, H) * 0.026),
      fontWeight: '800',
      fontStyle: 'normal',
      textAlign: 'left',
      color: textPrimary,
      x: headerTextX,
      y: Math.round(H * 0.026),
      width: Math.round(contentW * 0.56),
      height: Math.round(Math.min(W, H) * 0.036),
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      zIndex: nextZ(),
    });

    layers.push({
      id: makeLayerId('slogan'),
      name: 'Fashion Slogan',
      type: 'text',
      text: (
        config.fashionSlogan ||
        biz.tagline ||
        'WEAR CONFIDENCE · OWN THE LOOK'
      ).toUpperCase(),
      fontFamily: 'Plus Jakarta Sans',
      fontSize: Math.round(Math.min(W, H) * 0.0145),
      fontWeight: '700',
      fontStyle: 'normal',
      textAlign: 'left',
      color: accent,
      x: headerTextX,
      y: Math.round(H * 0.056),
      width: Math.round(contentW * 0.58),
      height: Math.round(Math.min(W, H) * 0.024),
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      zIndex: nextZ(),
    });
  }

  // 3. Top-Right Promo Badge
  if (config.promoText?.trim()) {
    const bw = Math.round(contentW * 0.34);
    const bh = Math.round(H * 0.038);
    layers.push({
      id: makeLayerId('promo_pill'),
      name: 'Promo Badge',
      type: 'badge',
      badgeStyle: 'pill',
      primaryText: config.promoText.trim().slice(0, 28).toUpperCase(),
      fillColor: accent,
      textColor: '#0D0E14',
      fontFamily: 'Plus Jakarta Sans',
      x: W - pad - bw,
      y: Math.round(H * 0.032),
      width: bw,
      height: bh,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      zIndex: nextZ(),
      borderRadius: 999,
    });
  }

  // 4. Bold COMBO OFFER Headline Banner
  const bannerY = Math.round(H * 0.105);
  const bannerH = Math.round(H * 0.115);
  layers.push({
    id: makeLayerId('hero_banner'),
    name: 'Headline Banner Box',
    type: 'shape',
    shapeKind: 'rounded_rect',
    fillColor: isStyleZone ? '#DC2626' : secondary,
    gradientEndColor: isStyleZone ? '#991B1B' : bgStart,
    x: pad,
    y: bannerY,
    width: contentW,
    height: bannerH,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    zIndex: nextZ(),
    borderRadius: 16,
    borderWidth: 3,
    borderColor: accent,
    shadowColor: '#000000',
    shadowBlur: 12,
    shadowOffsetX: 5,
    shadowOffsetY: 5,
  });

  layers.push({
    id: makeLayerId('combo_super'),
    name: 'COMBO OFFER Super Title',
    type: 'text',
    text: 'COMBO OFFER',
    fontFamily: 'Oswald',
    fontSize: Math.round(bannerH * 0.44),
    fontWeight: '900',
    fontStyle: 'normal',
    textAlign: 'center',
    color: accent,
    strokeColor: '#0A0B10',
    strokeWidth: 4,
    x: pad + 12,
    y: bannerY + Math.round(bannerH * 0.07),
    width: contentW - 24,
    height: Math.round(bannerH * 0.5),
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    zIndex: nextZ(),
  });

  layers.push({
    id: makeLayerId('combo_title'),
    name: 'Offer Name Headline',
    type: 'text',
    text: (config.headline || offer.name).toUpperCase(),
    fontFamily: 'Plus Jakarta Sans',
    fontSize: Math.round(bannerH * 0.22),
    fontWeight: '800',
    fontStyle: 'normal',
    textAlign: 'center',
    color: '#FFFFFF',
    x: pad + 16,
    y: bannerY + Math.round(bannerH * 0.62),
    width: contentW - 32,
    height: Math.round(bannerH * 0.3),
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    zIndex: nextZ(),
  });

  // 5. Fashion Model Layer (if active)
  const effectiveModelUrl =
    config.modelCategory === 'none'
      ? null
      : (config.aiGeneratedModelUrl || config.customModelImageUrl || modelImageUrl || '').trim() ||
        null;

  const modelTop = bannerY + bannerH + Math.round(H * 0.012);
  const showcaseRowH = Math.round(H * (items.length > 4 ? 0.24 : 0.19));
  const footerH = Math.round(H * 0.185);
  const modelH = Math.max(Math.round(H * 0.22), H - pad * 0.45 - footerH - showcaseRowH - 16 - modelTop);

  if (effectiveModelUrl) {
    const modelW = Math.round(W * 0.6);
    layers.push({
      id: makeLayerId('model'),
      name: 'Fashion Model',
      type: 'image',
      src: effectiveModelUrl,
      fit: 'contain',
      removeLightBg: config.removeModelBg !== false,
      bgRemovalTolerance: 36,
      brightness: 100,
      contrast: 100,
      x: Math.round((W - modelW) / 2),
      y: modelTop,
      width: modelW,
      height: modelH,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      zIndex: nextZ(),
      tagRole: 'model',
    });
  }

  // 6. Starburst Savings Badge
  if (config.showDiscountBadge && pricing.discountPercent > 0) {
    const badgeSize = Math.round(Math.min(W * 0.22, modelH * 0.65));
    layers.push({
      id: makeLayerId('savings_star'),
      name: 'Discount Starburst Badge',
      type: 'badge',
      badgeStyle: 'starburst',
      primaryText: `${Math.round(pricing.discountPercent)}% OFF`,
      secondaryText: `SAVE ${formatMoney(pricing.savingsAmount)}`,
      fillColor: accent,
      textColor: '#0D0E14',
      fontFamily: 'Oswald',
      x: W - pad - badgeSize,
      y: modelTop + 8,
      width: badgeSize,
      height: badgeSize,
      rotation: -6,
      opacity: 1,
      visible: true,
      locked: false,
      zIndex: nextZ(),
      borderColor: secondary,
      borderWidth: 3,
      shadowColor: '#000000',
      shadowBlur: 10,
      shadowOffsetX: 3,
      shadowOffsetY: 3,
    });
  }

  // 7. Product Showcase Cards + Plus (+) Connectors (all items up to 8 cleanly gridded)
  const displayItems = items.slice(0, 8);
  const cardsPerRow =
    displayItems.length <= 4 ? displayItems.length : Math.ceil(displayItems.length / 2);
  const numRows = Math.max(1, Math.ceil(displayItems.length / Math.max(1, cardsPerRow)));
  const rowGap = 10;
  const colGap = Math.round(W * 0.022);
  const showcaseY = modelTop + modelH + 10;
  const cardRowH = (showcaseRowH - rowGap * (numRows - 1)) / numRows;

  for (let r = 0; r < numRows; r++) {
    const slice = displayItems.slice(r * cardsPerRow, (r + 1) * cardsPerRow);
    const nCols = slice.length;
    const cardW = (contentW - colGap * (nCols - 1)) / Math.max(1, nCols);
    const ry = showcaseY + r * (cardRowH + rowGap);

    slice.forEach((item, cIdx) => {
      const cx = pad + cIdx * (cardW + colGap);
      const groupId = makeLayerId('cardgrp');

      layers.push({
        id: makeLayerId('card_bg'),
        name: `Card Box — ${item.productName}`,
        type: 'shape',
        shapeKind: 'rounded_rect',
        fillColor: '#FFFFFF',
        x: Math.round(cx),
        y: Math.round(ry),
        width: Math.round(cardW),
        height: Math.round(cardRowH),
        rotation: 0,
        opacity: 1,
        visible: true,
        locked: false,
        groupId,
        zIndex: nextZ(),
        borderRadius: 14,
        borderWidth: 2,
        borderColor: accent,
      });

      const cPad = Math.max(6, Math.round(Math.min(cardW, cardRowH) * 0.06));
      const picH = Math.round((cardRowH - cPad * 2) * 0.6);
      const picW = Math.round(cardW - cPad * 2);

      if (item.imageUrl) {
        layers.push({
          id: makeLayerId('card_img'),
          name: `Photo — ${item.productName}`,
          type: 'image',
          src: item.imageUrl,
          fit: 'contain',
          x: Math.round(cx + cPad),
          y: Math.round(ry + cPad),
          width: picW,
          height: picH,
          rotation: 0,
          opacity: 1,
          visible: true,
          locked: false,
          groupId,
          zIndex: nextZ(),
          borderRadius: 10,
          tagRole: 'product',
          linkedProductId: item.productId,
        });
      }

      const titleSize = Math.max(11, Math.round(Math.min(cardW * 0.082, cardRowH * 0.088)));
      layers.push({
        id: makeLayerId('card_title'),
        name: `Name — ${item.productName}`,
        type: 'text',
        text: `${item.quantity}× ${item.productName}`,
        fontFamily: 'Plus Jakarta Sans',
        fontSize: titleSize,
        fontWeight: '800',
        fontStyle: 'normal',
        textAlign: 'center',
        color: '#0F172A',
        x: Math.round(cx + cPad),
        y: Math.round(ry + cPad + picH + 6),
        width: picW,
        height: Math.round(titleSize * 2.1),
        rotation: 0,
        opacity: 1,
        visible: true,
        locked: false,
        groupId,
        zIndex: nextZ(),
      });

      if (config.showPrices) {
        layers.push({
          id: makeLayerId('card_price'),
          name: `Price — ${item.productName}`,
          type: 'text',
          text: item.isFree ? 'FREE GIFT' : formatMoney(item.lineRegularTotal),
          fontFamily: 'JetBrains Mono',
          fontSize: Math.max(11, Math.round(titleSize * 0.9)),
          fontWeight: '700',
          fontStyle: 'normal',
          textAlign: 'center',
          color: item.isFree ? '#059669' : '#B91C1C',
          x: Math.round(cx + cPad),
          y: Math.round(ry + cardRowH - cPad - titleSize * 1.25),
          width: picW,
          height: Math.round(titleSize * 1.3),
          rotation: 0,
          opacity: 1,
          visible: true,
          locked: false,
          groupId,
          zIndex: nextZ(),
        });
      }

      if (cIdx < nCols - 1) {
        const plusSize = Math.max(26, Math.min(44, Math.round(colGap * 1.6)));
        layers.push({
          id: makeLayerId('plus'),
          name: 'Plus (+) Connector',
          type: 'sticker',
          stickerKind: 'plus_sign',
          fillColor: accent,
          accentColor: '#0D0E14',
          textColor: '#0D0E14',
          x: Math.round(cx + cardW + (colGap - plusSize) / 2),
          y: Math.round(ry + cardRowH * 0.42 - plusSize / 2),
          width: plusSize,
          height: plusSize,
          rotation: 0,
          opacity: 1,
          visible: true,
          locked: false,
          zIndex: nextZ() + 20,
        });
      }
    });
  }

  // 8. Bottom Pricing Conversion Footer + CTA + QR
  const footY = Math.round(H - pad * 0.45 - footerH);
  layers.push({
    id: makeLayerId('footer_box'),
    name: 'Bottom Offer Footer Box',
    type: 'shape',
    shapeKind: 'rounded_rect',
    fillColor: '#0A0B10',
    x: pad,
    y: footY,
    width: contentW,
    height: footerH,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    zIndex: nextZ(),
    borderRadius: 16,
    borderWidth: 2,
    borderColor: accent,
  });

  const qrResolved = resolveComboMarketplaceQrUrl(offer, settings, config.customQrUrl);
  const qrSize = Math.round(Math.min(footerH * 0.72, W * 0.13));
  const hasQr = config.includeQrCode && config.qrPosition !== 'hidden' && Boolean(qrResolved.url);
  const textLeft = hasQr && config.qrPosition === 'bottom_left' ? pad + qrSize + 28 : pad + 20;
  const textRight = hasQr && config.qrPosition === 'bottom_right' ? W - pad - qrSize - 24 : W - pad - 20;
  const textW = Math.max(220, textRight - textLeft);

  if (pricing.savingsAmount > 0) {
    layers.push({
      id: makeLayerId('reg_price'),
      name: 'Regular Strikethrough Price',
      type: 'text',
      text: `REGULAR ${formatMoney(pricing.regularTotalPrice)}`,
      fontFamily: 'Plus Jakarta Sans',
      fontSize: Math.round(Math.min(W, H) * 0.017),
      fontWeight: '700',
      fontStyle: 'normal',
      textAlign: 'left',
      color: '#CBD5E1',
      strikethrough: true,
      x: textLeft,
      y: footY + Math.round(footerH * 0.1),
      width: Math.round(textW * 0.55),
      height: Math.round(Math.min(W, H) * 0.025),
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      zIndex: nextZ(),
    });
  }

  layers.push({
    id: makeLayerId('combo_price'),
    name: 'Highlighted Combo Price',
    type: 'text',
    text: formatMoney(pricing.finalComboPrice),
    fontFamily: 'Oswald',
    fontSize: Math.round(Math.min(W, H) * 0.046),
    fontWeight: '900',
    fontStyle: 'normal',
    textAlign: 'left',
    color: accent,
    x: textLeft,
    y: footY + Math.round(footerH * 0.24),
    width: Math.round(textW * 0.62),
    height: Math.round(Math.min(W, H) * 0.056),
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    zIndex: nextZ(),
  });

  const ctaW = Math.min(180, Math.round(textW * 0.34));
  const ctaH = Math.round(footerH * 0.24);
  layers.push({
    id: makeLayerId('cta_btn'),
    name: 'Shop Now CTA Button',
    type: 'badge',
    badgeStyle: 'pill',
    primaryText: (config.ctaText || 'SHOP NOW').toUpperCase(),
    fillColor: accent,
    textColor: '#0D0E14',
    fontFamily: 'Plus Jakarta Sans',
    x: textRight - ctaW,
    y: footY + Math.round(footerH * 0.14),
    width: ctaW,
    height: ctaH,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    zIndex: nextZ(),
    borderRadius: 999,
  });

  layers.push({
    id: makeLayerId('trust_bar'),
    name: 'Quality & Guarantee Strip',
    type: 'text',
    text: (
      config.trustLine || 'PREMIUM QUALITY · BEST DISCOUNT · LIMITED STOCK'
    ).toUpperCase(),
    fontFamily: 'Plus Jakarta Sans',
    fontSize: Math.max(11, Math.round(Math.min(W, H) * 0.0125)),
    fontWeight: '700',
    fontStyle: 'normal',
    textAlign: 'left',
    color: '#F8FAFC',
    x: textLeft,
    y: footY + Math.round(footerH * 0.62),
    width: textW,
    height: Math.round(footerH * 0.16),
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    zIndex: nextZ(),
  });

  const contactLine = [
    displayPhone ? `Call / WhatsApp: ${displayPhone}` : '',
    displayAddress || '',
  ]
    .filter(Boolean)
    .join('  ·  ');

  layers.push({
    id: makeLayerId('contact_footer'),
    name: 'Shop Phone & Address',
    type: 'text',
    text: contactLine || config.footerText || 'Visit Our Showroom Today',
    fontFamily: 'Plus Jakarta Sans',
    fontSize: Math.max(10, Math.round(Math.min(W, H) * 0.0115)),
    fontWeight: '600',
    fontStyle: 'normal',
    textAlign: 'left',
    color: '#94A3B8',
    x: textLeft,
    y: footY + Math.round(footerH * 0.78),
    width: textW,
    height: Math.round(footerH * 0.16),
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    zIndex: nextZ(),
  });

  if (hasQr && qrResolved.url) {
    layers.push({
      id: makeLayerId('qr'),
      name: 'Scannable Combo QR Code',
      type: 'qr',
      qrValue: qrResolved.url,
      foregroundColor: '#0F172A',
      backgroundColor: '#FFFFFF',
      x: config.qrPosition === 'bottom_left' ? pad + 14 : W - pad - qrSize - 14,
      y: footY + Math.round((footerH - qrSize) / 2),
      width: qrSize,
      height: qrSize,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      zIndex: nextZ(),
      borderRadius: 10,
    });
  }

  return {
    version: 2,
    canvasWidth: W,
    canvasHeight: H,
    backgroundColor: bgStart,
    backgroundGradientEnabled: true,
    backgroundGradientEnd: isStyleZone ? '#991B1B' : secondary,
    layers: normalizeLayerZIndexes(layers),
    updatedAt: new Date().toISOString(),
  };
}

// ==============================================================================
// LAYER GEOMETRY, ALIGNMENT, DISTRIBUTION, GROUPING & Z-ORDER UTILITIES
// ==============================================================================

export function normalizeLayerZIndexes(layers: PosterCanvasLayer[]): PosterCanvasLayer[] {
  return [...layers]
    .sort((a, b) => a.zIndex - b.zIndex)
    .map((layer, idx) => ({ ...layer, zIndex: idx + 1 }));
}

export function reorderLayerZIndex(
  layers: PosterCanvasLayer[],
  layerId: string,
  direction: 'front' | 'back' | 'forward' | 'backward'
): PosterCanvasLayer[] {
  const sorted = normalizeLayerZIndexes(layers);
  const idx = sorted.findIndex(l => l.id === layerId);
  if (idx === -1) return sorted;

  const target = sorted[idx];
  const rest = sorted.filter(l => l.id !== layerId);

  if (direction === 'front') {
    rest.push(target);
  } else if (direction === 'back') {
    rest.unshift(target);
  } else if (direction === 'forward') {
    const nextIdx = Math.min(rest.length, idx + 1);
    rest.splice(nextIdx, 0, target);
  } else {
    const prevIdx = Math.max(0, idx - 1);
    rest.splice(prevIdx, 0, target);
  }

  return rest.map((l, i) => ({ ...l, zIndex: i + 1 }));
}

export type LayerAlignmentKind = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';

export function alignSelectedLayers(
  layers: PosterCanvasLayer[],
  selectedIds: string[],
  alignment: LayerAlignmentKind,
  canvasWidth: number,
  canvasHeight: number
): PosterCanvasLayer[] {
  const selected = layers.filter(l => selectedIds.includes(l.id) && !l.locked);
  if (selected.length === 0) return layers;

  // Single item aligns against Canvas bounds; multiple items align against selection bounding box!
  const refMinX = selected.length === 1 ? 0 : Math.min(...selected.map(l => l.x));
  const refMaxX = selected.length === 1 ? canvasWidth : Math.max(...selected.map(l => l.x + l.width));
  const refMinY = selected.length === 1 ? 0 : Math.min(...selected.map(l => l.y));
  const refMaxY = selected.length === 1 ? canvasHeight : Math.max(...selected.map(l => l.y + l.height));
  const refCx = (refMinX + refMaxX) / 2;
  const refCy = (refMinY + refMaxY) / 2;

  return layers.map(layer => {
    if (!selectedIds.includes(layer.id) || layer.locked) return layer;
    switch (alignment) {
      case 'left':
        return { ...layer, x: Math.round(refMinX) };
      case 'center':
        return { ...layer, x: Math.round(refCx - layer.width / 2) };
      case 'right':
        return { ...layer, x: Math.round(refMaxX - layer.width) };
      case 'top':
        return { ...layer, y: Math.round(refMinY) };
      case 'middle':
        return { ...layer, y: Math.round(refCy - layer.height / 2) };
      case 'bottom':
        return { ...layer, y: Math.round(refMaxY - layer.height) };
    }
  });
}

export function distributeSelectedLayers(
  layers: PosterCanvasLayer[],
  selectedIds: string[],
  axis: 'horizontal' | 'vertical'
): PosterCanvasLayer[] {
  const selected = layers.filter(l => selectedIds.includes(l.id) && !l.locked);
  if (selected.length < 3) return layers;

  if (axis === 'horizontal') {
    const ordered = [...selected].sort((a, b) => a.x - b.x);
    const minX = ordered[0].x;
    const maxRight = ordered[ordered.length - 1].x + ordered[ordered.length - 1].width;
    const totalWidths = ordered.reduce((s, l) => s + l.width, 0);
    const gap = (maxRight - minX - totalWidths) / (ordered.length - 1);
    let cursor = minX;
    const nextPos = new Map<string, number>();
    for (const l of ordered) {
      nextPos.set(l.id, Math.round(cursor));
      cursor += l.width + gap;
    }
    return layers.map(l => (nextPos.has(l.id) ? { ...l, x: nextPos.get(l.id)! } : l));
  }

  const ordered = [...selected].sort((a, b) => a.y - b.y);
  const minY = ordered[0].y;
  const maxBottom = ordered[ordered.length - 1].y + ordered[ordered.length - 1].height;
  const totalHeights = ordered.reduce((s, l) => s + l.height, 0);
  const gap = (maxBottom - minY - totalHeights) / (ordered.length - 1);
  let cursor = minY;
  const nextPos = new Map<string, number>();
  for (const l of ordered) {
    nextPos.set(l.id, Math.round(cursor));
    cursor += l.height + gap;
  }
  return layers.map(l => (nextPos.has(l.id) ? { ...l, y: nextPos.get(l.id)! } : l));
}

export function groupSelectedLayers(
  layers: PosterCanvasLayer[],
  selectedIds: string[]
): PosterCanvasLayer[] {
  if (selectedIds.length < 2) return layers;
  const gid = makeLayerId('grp');
  return layers.map(l => (selectedIds.includes(l.id) ? { ...l, groupId: gid } : l));
}

export function ungroupLayers(
  layers: PosterCanvasLayer[],
  selectedIds: string[]
): PosterCanvasLayer[] {
  const groupIds = new Set(
    layers.filter(l => selectedIds.includes(l.id) && l.groupId).map(l => l.groupId!)
  );
  if (groupIds.size === 0) return layers;
  return layers.map(l =>
    l.groupId && groupIds.has(l.groupId) ? { ...l, groupId: undefined } : l
  );
}

export function duplicateSelectedLayers(
  layers: PosterCanvasLayer[],
  selectedIds: string[]
): { layers: PosterCanvasLayer[]; newIds: string[] } {
  const chosen = layers.filter(l => selectedIds.includes(l.id));
  if (chosen.length === 0) return { layers, newIds: [] };
  let maxZ = layers.reduce((m, l) => Math.max(m, l.zIndex), 0);
  const groupRemap = new Map<string, string>();
  const newIds: string[] = [];

  const clones = chosen.map(layer => {
    const newId = makeLayerId(layer.type);
    newIds.push(newId);
    let nextGroup: string | undefined;
    if (layer.groupId) {
      if (!groupRemap.has(layer.groupId)) {
        groupRemap.set(layer.groupId, makeLayerId('grp'));
      }
      nextGroup = groupRemap.get(layer.groupId);
    }
    return {
      ...layer,
      id: newId,
      name: `${layer.name} (Copy)`,
      x: layer.x + 24,
      y: layer.y + 24,
      groupId: nextGroup,
      locked: false,
      zIndex: ++maxZ,
    };
  });

  return {
    layers: normalizeLayerZIndexes([...layers, ...clones]),
    newIds,
  };
}

// ==============================================================================
// WYSIWYG HIGH-DPI CANVAS2D RENDERER FOR CUSTOM DESIGN STUDIO (MODE 2)
// ==============================================================================

function drawRoundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const rad = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

function drawStarburst(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  outerR: number,
  innerR: number,
  points = 16
) {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const rad = i % 2 === 0 ? outerR : innerR;
    const angle = (i * Math.PI) / points - Math.PI / 2;
    const px = cx + Math.cos(angle) * rad;
    const py = cy + Math.sin(angle) * rad;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

function wrapTextToLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const paragraphs = (text || '').split('\n');
  const lines: string[] = [];
  for (const para of paragraphs) {
    const words = para.split(/\s+/);
    let current = '';
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (ctx.measureText(candidate).width <= maxWidth || !current) {
        current = candidate;
      } else {
        lines.push(current);
        current = word;
      }
    }
    if (current) lines.push(current);
  }
  return lines.length > 0 ? lines : [''];
}

export async function renderCustomPosterProjectToCanvas(
  project: PosterCustomProject
): Promise<HTMLCanvasElement> {
  const W = Math.max(240, Math.round(project.canvasWidth || 1080));
  const H = Math.max(240, Math.round(project.canvasHeight || 1350));

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  // 1. Background Fill / Gradient
  if (project.backgroundGradientEnabled && project.backgroundGradientEnd) {
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, project.backgroundColor || '#12131A');
    grad.addColorStop(1, project.backgroundGradientEnd);
    ctx.fillStyle = grad;
  } else {
    ctx.fillStyle = project.backgroundColor || '#12131A';
  }
  ctx.fillRect(0, 0, W, H);

  // 2. Custom Background Image
  if (project.backgroundImageUrl) {
    const bgImg = await loadRawImageElement(project.backgroundImageUrl);
    if (bgImg && bgImg.naturalWidth && bgImg.naturalHeight) {
      const scale = Math.max(W / bgImg.naturalWidth, H / bgImg.naturalHeight);
      const dw = bgImg.naturalWidth * scale;
      const dh = bgImg.naturalHeight * scale;
      ctx.drawImage(bgImg, (W - dw) / 2, (H - dh) / 2, dw, dh);
    }
  }

  // Preload visible images & QR layers in parallel
  const visibleLayers = [...project.layers]
    .filter(l => l.visible !== false)
    .sort((a, b) => a.zIndex - b.zIndex);

  const imageMap = new Map<string, HTMLImageElement | null>();
  const qrMap = new Map<string, HTMLCanvasElement | null>();

  await Promise.all(
    visibleLayers.map(async layer => {
      if (layer.type === 'image') {
        const loaded = await loadProcessedLayerImage({
          src: layer.src,
          removeLightBg: layer.removeLightBg,
          bgRemovalTolerance: layer.bgRemovalTolerance,
          brightness: layer.brightness,
          contrast: layer.contrast,
          cropX: layer.cropX,
          cropY: layer.cropY,
          cropW: layer.cropW,
          cropH: layer.cropH,
        });
        imageMap.set(layer.id, loaded);
      } else if (layer.type === 'qr' && layer.qrValue) {
        const qc = document.createElement('canvas');
        try {
          await QRCode.toCanvas(qc, layer.qrValue, {
            width: Math.max(80, Math.round(Math.min(layer.width, layer.height))),
            margin: 1,
            color: {
              dark: layer.foregroundColor || '#0F172A',
              light: layer.backgroundColor || '#FFFFFF',
            },
          });
          qrMap.set(layer.id, qc);
        } catch {
          qrMap.set(layer.id, null);
        }
      }
    })
  );

  // 3. Draw every layer in exact z-order
  for (const layer of visibleLayers) {
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, layer.opacity ?? 1));

    const cx = layer.x + layer.width / 2;
    const cy = layer.y + layer.height / 2;
    if (layer.rotation) {
      ctx.translate(cx, cy);
      ctx.rotate((layer.rotation * Math.PI) / 180);
      ctx.translate(-cx, -cy);
    }

    if (layer.shadowBlur && layer.shadowBlur > 0) {
      ctx.shadowColor = layer.shadowColor || 'rgba(0,0,0,0.45)';
      ctx.shadowBlur = layer.shadowBlur;
      ctx.shadowOffsetX = layer.shadowOffsetX || 0;
      ctx.shadowOffsetY = layer.shadowOffsetY || 0;
    }

    if (layer.type === 'shape') {
      drawShapeLayer(ctx, layer);
    } else if (layer.type === 'image') {
      drawImageLayer(ctx, layer, imageMap.get(layer.id) || null);
    } else if (layer.type === 'text') {
      drawTextLayer(ctx, layer);
    } else if (layer.type === 'badge') {
      drawBadgeLayer(ctx, layer);
    } else if (layer.type === 'sticker') {
      drawStickerLayer(ctx, layer);
    } else if (layer.type === 'qr') {
      drawQrLayer(ctx, layer, qrMap.get(layer.id) || null);
    }

    ctx.restore();
  }

  return canvas;
}

function drawShapeLayer(ctx: CanvasRenderingContext2D, layer: PosterShapeLayer) {
  const { x, y, width: w, height: h } = layer;
  if (layer.shapeKind === 'circle') {
    ctx.beginPath();
    ctx.ellipse(x + w / 2, y + h / 2, Math.max(1, w / 2), Math.max(1, h / 2), 0, 0, Math.PI * 2);
  } else if (layer.shapeKind === 'line' || layer.shapeKind === 'divider') {
    ctx.strokeStyle = layer.fillColor || '#FFD21F';
    ctx.lineWidth = Math.max(2, h);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x, y + h / 2);
    ctx.lineTo(x + w, y + h / 2);
    ctx.stroke();
    return;
  } else {
    drawRoundedRectPath(ctx, x, y, w, h, layer.shapeKind === 'rounded_rect' ? (layer.borderRadius ?? 16) : 0);
  }

  if (layer.gradientEndColor) {
    const grad = ctx.createLinearGradient(x, y, x + w, y + h);
    grad.addColorStop(0, layer.fillColor);
    grad.addColorStop(1, layer.gradientEndColor);
    ctx.fillStyle = grad;
  } else {
    ctx.fillStyle = layer.fillColor;
  }
  ctx.fill();

  if (layer.borderWidth && layer.borderWidth > 0) {
    ctx.shadowBlur = 0;
    ctx.lineWidth = layer.borderWidth;
    ctx.strokeStyle = layer.borderColor || '#FFFFFF';
    ctx.stroke();
  }
}

function drawImageLayer(
  ctx: CanvasRenderingContext2D,
  layer: PosterImageLayer,
  img: HTMLImageElement | null
) {
  const { x, y, width: w, height: h } = layer;
  const radius = layer.borderRadius || 0;

  if (layer.backgroundColor) {
    ctx.save();
    drawRoundedRectPath(ctx, x, y, w, h, radius);
    ctx.fillStyle = layer.backgroundColor;
    ctx.fill();
    ctx.restore();
  }

  if (img && img.naturalWidth && img.naturalHeight) {
    ctx.save();
    drawRoundedRectPath(ctx, x, y, w, h, radius);
    ctx.clip();
    const scale =
      layer.fit === 'cover'
        ? Math.max(w / img.naturalWidth, h / img.naturalHeight)
        : Math.min(w / img.naturalWidth, h / img.naturalHeight);
    const dw = img.naturalWidth * scale;
    const dh = img.naturalHeight * scale;
    ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
    ctx.restore();
  }

  if (layer.borderWidth && layer.borderWidth > 0) {
    ctx.shadowBlur = 0;
    drawRoundedRectPath(ctx, x, y, w, h, radius);
    ctx.lineWidth = layer.borderWidth;
    ctx.strokeStyle = layer.borderColor || '#FFD21F';
    ctx.stroke();
  }
}

function drawTextLayer(ctx: CanvasRenderingContext2D, layer: PosterTextLayer) {
  const { x, y, width: w, height: h } = layer;
  if (layer.backgroundColor) {
    ctx.save();
    drawRoundedRectPath(ctx, x, y, w, h, layer.borderRadius ?? 8);
    ctx.fillStyle = layer.backgroundColor;
    ctx.fill();
    if (layer.borderWidth && layer.borderWidth > 0) {
      ctx.lineWidth = layer.borderWidth;
      ctx.strokeStyle = layer.borderColor || '#FFFFFF';
      ctx.stroke();
    }
    ctx.restore();
  }

  const content = layer.uppercase ? (layer.text || '').toUpperCase() : layer.text || '';
  const pad = layer.backgroundPadding ?? (layer.backgroundColor ? 10 : 2);
  const availW = Math.max(20, w - pad * 2);
  const fontSize = Math.max(8, layer.fontSize || 24);
  const lineH = Math.round(fontSize * (layer.lineHeight || 1.18));

  ctx.font = `${layer.fontStyle || 'normal'} ${layer.fontWeight || '700'} ${fontSize}px '${layer.fontFamily || 'Plus Jakarta Sans'}', 'Hind Siliguri', 'Noto Sans Bengali', sans-serif`;
  ctx.textBaseline = 'top';
  ctx.textAlign = layer.textAlign || 'left';

  const lines = wrapTextToLines(ctx, content, availW);
  const drawX =
    layer.textAlign === 'center'
      ? x + w / 2
      : layer.textAlign === 'right'
      ? x + w - pad
      : x + pad;

  lines.forEach((line, idx) => {
    const ly = y + pad + idx * lineH;
    if (layer.strokeWidth && layer.strokeWidth > 0) {
      ctx.lineWidth = layer.strokeWidth;
      ctx.lineJoin = 'round';
      ctx.strokeStyle = layer.strokeColor || '#000000';
      ctx.strokeText(line, drawX, ly);
    }
    ctx.fillStyle = layer.color || '#FFFFFF';
    ctx.fillText(line, drawX, ly);

    if (layer.strikethrough) {
      const lw = ctx.measureText(line).width;
      const sx =
        layer.textAlign === 'center'
          ? drawX - lw / 2
          : layer.textAlign === 'right'
          ? drawX - lw
          : drawX;
      ctx.shadowBlur = 0;
      ctx.strokeStyle = '#EF4444';
      ctx.lineWidth = Math.max(2, Math.round(fontSize * 0.1));
      ctx.beginPath();
      ctx.moveTo(sx, ly + fontSize * 0.56);
      ctx.lineTo(sx + lw, ly + fontSize * 0.56);
      ctx.stroke();
    }
  });
}

function drawBadgeLayer(ctx: CanvasRenderingContext2D, layer: PosterBadgeLayer) {
  const { x, y, width: w, height: h } = layer;
  const cx = x + w / 2;
  const cy = y + h / 2;

  if (layer.badgeStyle === 'starburst') {
    const outerR = Math.min(w, h) / 2;
    drawStarburst(ctx, cx, cy, outerR, outerR * 0.78, 16);
    ctx.fillStyle = layer.fillColor || '#FFD21F';
    ctx.fill();
    if (layer.borderWidth && layer.borderWidth > 0) {
      ctx.shadowBlur = 0;
      ctx.lineWidth = layer.borderWidth;
      ctx.strokeStyle = layer.borderColor || '#D91E2A';
      ctx.stroke();
    }
    ctx.shadowBlur = 0;
    ctx.fillStyle = layer.textColor || '#0D0E14';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const bigSize = Math.max(12, Math.round(outerR * 0.36));
    ctx.font = `900 ${bigSize}px '${layer.fontFamily || 'Oswald'}', 'Plus Jakarta Sans', sans-serif`;
    if (layer.secondaryText) {
      ctx.fillText(layer.primaryText, cx, cy - bigSize * 0.4);
      ctx.font = `800 ${Math.max(10, Math.round(bigSize * 0.52))}px 'Plus Jakarta Sans', sans-serif`;
      ctx.fillText(layer.secondaryText, cx, cy + bigSize * 0.52);
    } else {
      ctx.fillText(layer.primaryText, cx, cy);
    }
    return;
  }

  drawRoundedRectPath(
    ctx,
    x,
    y,
    w,
    h,
    layer.badgeStyle === 'pill' ? 999 : (layer.borderRadius ?? 12)
  );
  ctx.fillStyle = layer.fillColor || '#FFD21F';
  ctx.fill();
  if (layer.borderWidth && layer.borderWidth > 0) {
    ctx.shadowBlur = 0;
    ctx.lineWidth = layer.borderWidth;
    ctx.strokeStyle = layer.borderColor || '#0D0E14';
    ctx.stroke();
  }
  ctx.shadowBlur = 0;
  ctx.fillStyle = layer.textColor || '#0D0E14';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const fSize = Math.max(11, Math.round(h * 0.38));
  ctx.font = `800 ${fSize}px '${layer.fontFamily || 'Plus Jakarta Sans'}', sans-serif`;
  if (layer.secondaryText) {
    ctx.fillText(layer.primaryText, cx, cy - fSize * 0.45, w - 16);
    ctx.font = `700 ${Math.max(9, Math.round(fSize * 0.65))}px 'Plus Jakarta Sans', sans-serif`;
    ctx.fillText(layer.secondaryText, cx, cy + fSize * 0.55, w - 16);
  } else {
    ctx.fillText(layer.primaryText, cx, cy, w - 16);
  }
}

function drawStickerLayer(ctx: CanvasRenderingContext2D, layer: PosterStickerLayer) {
  const { x, y, width: w, height: h } = layer;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const r = Math.min(w, h) / 2;

  if (layer.stickerKind === 'plus_sign') {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = layer.fillColor || '#FFD21F';
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.lineWidth = Math.max(2, Math.round(r * 0.14));
    ctx.strokeStyle = layer.accentColor || '#0D0E14';
    ctx.stroke();

    ctx.fillStyle = layer.textColor || '#0D0E14';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `900 ${Math.round(r * 1.35)}px 'Plus Jakarta Sans', sans-serif`;
    ctx.fillText('+', cx, cy + 1);
    return;
  }

  if (layer.stickerKind === 'arrow_right' || layer.stickerKind === 'arrow_down') {
    ctx.fillStyle = layer.fillColor || '#FFD21F';
    ctx.beginPath();
    if (layer.stickerKind === 'arrow_right') {
      ctx.moveTo(x, y + h * 0.3);
      ctx.lineTo(x + w * 0.62, y + h * 0.3);
      ctx.lineTo(x + w * 0.62, y);
      ctx.lineTo(x + w, y + h / 2);
      ctx.lineTo(x + w * 0.62, y + h);
      ctx.lineTo(x + w * 0.62, y + h * 0.7);
      ctx.lineTo(x, y + h * 0.7);
    } else {
      ctx.moveTo(x + w * 0.3, y);
      ctx.lineTo(x + w * 0.7, y);
      ctx.lineTo(x + w * 0.7, y + h * 0.62);
      ctx.lineTo(x + w, y + h * 0.62);
      ctx.lineTo(x + w / 2, y + h);
      ctx.lineTo(x, y + h * 0.62);
      ctx.lineTo(x + w * 0.3, y + h * 0.62);
    }
    ctx.closePath();
    ctx.fill();
    return;
  }

  if (layer.stickerKind === 'star_icon') {
    drawStarburst(ctx, cx, cy, r, r * 0.44, 5);
    ctx.fillStyle = layer.fillColor || '#FFD21F';
    ctx.fill();
    return;
  }

  // Quality seal / flash tag
  drawStarburst(ctx, cx, cy, r, r * 0.85, 14);
  ctx.fillStyle = layer.fillColor || '#D91E2A';
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.lineWidth = 2;
  ctx.strokeStyle = layer.accentColor || '#FFD21F';
  ctx.stroke();
  ctx.fillStyle = layer.textColor || '#FFFFFF';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `900 ${Math.max(10, Math.round(r * 0.34))}px 'Plus Jakarta Sans', sans-serif`;
  ctx.fillText((layer.label || '100% PREMIUM').toUpperCase(), cx, cy, r * 1.45);
}

function drawQrLayer(
  ctx: CanvasRenderingContext2D,
  layer: PosterQrLayer,
  qrCanvas: HTMLCanvasElement | null
) {
  const { x, y, width: w, height: h } = layer;
  drawRoundedRectPath(ctx, x, y, w, h, layer.borderRadius ?? 10);
  ctx.fillStyle = layer.backgroundColor || '#FFFFFF';
  ctx.fill();

  if (qrCanvas) {
    const pad = Math.max(4, Math.round(Math.min(w, h) * 0.06));
    ctx.drawImage(qrCanvas, x + pad, y + pad, w - pad * 2, h - pad * 2);
  }
}

// ==============================================================================
// USER REUSABLE TEMPLATE LIBRARY & AUTO-SAVE DRAFT STORAGE (LOCALSTORAGE SAFE)
// ==============================================================================

const USER_TEMPLATES_PREFIX = 'PROTIVA_POSTER_USER_TEMPLATES_V1_';
const DRAFT_PREFIX = 'PROTIVA_POSTER_DRAFT_V1_';

export function loadCustomPosterTemplates(businessId = 'default'): PosterUserTemplate[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(`${USER_TEMPLATES_PREFIX}${businessId}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveCustomPosterTemplate(
  businessId = 'default',
  template: PosterUserTemplate
): PosterUserTemplate[] {
  const current = loadCustomPosterTemplates(businessId).filter(t => t.id !== template.id);
  const next = [template, ...current].slice(0, 24);
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(`${USER_TEMPLATES_PREFIX}${businessId}`, JSON.stringify(next));
    } catch {
      // ignore storage quota overflow cleanly
    }
  }
  return next;
}

export function deleteCustomPosterTemplate(
  businessId = 'default',
  templateId: string
): PosterUserTemplate[] {
  const next = loadCustomPosterTemplates(businessId).filter(t => t.id !== templateId);
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(`${USER_TEMPLATES_PREFIX}${businessId}`, JSON.stringify(next));
    } catch {
      // ignore
    }
  }
  return next;
}

export function savePosterStudioDraft(offerId: string, config: ComboPosterConfig): void {
  if (typeof localStorage === 'undefined' || !offerId) return;
  try {
    localStorage.setItem(
      `${DRAFT_PREFIX}${offerId}`,
      JSON.stringify({ savedAt: new Date().toISOString(), config })
    );
  } catch {
    // ignore storage quota errors cleanly
  }
}

export function loadPosterStudioDraft(
  offerId: string
): { savedAt: string; config: ComboPosterConfig } | null {
  if (typeof localStorage === 'undefined' || !offerId) return null;
  try {
    const raw = localStorage.getItem(`${DRAFT_PREFIX}${offerId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.config) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearPosterStudioDraft(offerId: string): void {
  if (typeof localStorage === 'undefined' || !offerId) return;
  try {
    localStorage.removeItem(`${DRAFT_PREFIX}${offerId}`);
  } catch {
    // ignore
  }
}
