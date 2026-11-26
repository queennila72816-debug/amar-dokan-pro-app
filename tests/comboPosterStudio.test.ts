import assert from 'node:assert/strict';
import {
  ComboOffer,
  MarketplaceComboOrder,
  Product,
  ShopSettings,
} from '../src/types';
import {
  POSTER_DIMENSION_PRESETS,
  POSTER_TEMPLATES,
  analyzeComboForPosterDesign,
  buildDefaultPosterConfig,
  buildPosterItemKey,
  computePosterLayoutPlan,
  computePosterPricingSummary,
  getBusinessCompletenessIssues,
  resolveComboMarketplaceQrUrl,
  resolvePosterDimensions,
  resolvePosterProductItems,
} from '../src/utils/comboPosterEngine';
import {
  alignSelectedLayers,
  createBlankCustomProject,
  distributeSelectedLayers,
  duplicateSelectedLayers,
  generateEditableLayersFromStyleZoneConfig,
  groupSelectedLayers,
  reorderLayerZIndex,
  ungroupLayers,
} from '../src/utils/customPosterProjectEngine';
import {
  marketplaceOrderService,
  shouldDeductStockForTransition,
} from '../src/services/marketplaceOrderService';

const makeProduct = (
  id: string,
  name: string,
  overrides: Partial<Product> = {}
): Product => ({
  id,
  name,
  code: `CODE-${id}`,
  barcode: `880100${id}`,
  category: 'Fashion',
  purchasePrice: 400,
  salePrice: 1000,
  currentStock: 10,
  minStockAlert: 2,
  unit: 'pcs',
  businessType: 'clothing',
  hasVariants: false,
  createdAt: '2026-11-26T00:00:00Z',
  updatedAt: '2026-11-26T00:00:00Z',
  ...overrides,
});

const makeCombo = (itemsCount: number, overrides: Partial<ComboOffer> = {}): ComboOffer => {
  const items = Array.from({ length: itemsCount }, (_, idx) => ({
    id: `item-${idx + 1}`,
    productId: `p-${idx + 1}`,
    productName: `Product ${idx + 1}`,
    quantity: 1,
    salePrice: 500,
    purchasePrice: 250,
  }));
  const regularTotalPrice = itemsCount * 500;
  const finalComboPrice = Math.round(regularTotalPrice * 0.8);
  return {
    id: `offer-${itemsCount}`,
    name: `Combo ${itemsCount} Pack`,
    offerType: 'fixed_price',
    items,
    regularTotalPrice,
    discountType: 'fixed_bundle_price',
    discountValue: finalComboPrice,
    finalComboPrice,
    totalCostOfGoods: itemsCount * 250,
    allocatedOpEx: 0,
    grossProfit: finalComboPrice - itemsCount * 250,
    estimatedNetProfit: finalComboPrice - itemsCount * 250,
    profitMarginPercent: 25,
    isLossMaking: false,
    minSafeSellingPrice: itemsCount * 260,
    startDate: '2026-11-01',
    status: 'active',
    usageCount: 0,
    priorityRank: 10,
    businessId: 'biz-1',
    createdAt: '2026-11-26T00:00:00Z',
    updatedAt: '2026-11-26T00:00:00Z',
    ...overrides,
  };
};

const baseSettings: ShopSettings = {
  shopName: 'Urban Loom Dhaka',
  tagline: 'Curated Fashion',
  address: 'Banani Road 11, Dhaka',
  mobile: '01711000000',
  email: 'hello@urbanloom.example',
  currency: '৳',
  vatTaxRate: 0,
  invoiceFormat: 'a4',
  businessType: 'clothing',
  language: 'en',
  uiMode: 'advanced',
};

// 1. All 16 templates and 14 dimension presets exist
assert.equal(POSTER_TEMPLATES.length, 16, 'Must expose 16 distinct poster templates');
assert.equal(
  Object.keys(POSTER_DIMENSION_PRESETS).length,
  14,
  'Must support 14 poster dimension presets'
);

// 2. Adaptive multi-product layout & >12 item multi-page splitting without omitting items
for (const count of [3, 5, 7, 14]) {
  const prods = Array.from({ length: count }, (_, idx) =>
    makeProduct(`p-${idx + 1}`, `Item ${idx + 1}`, {
      image: `https://cdn.example.com/p-${idx + 1}.jpg`,
    })
  );
  const combo = makeCombo(count);
  const resolved = resolvePosterProductItems(combo, prods);
  assert.equal(resolved.length, count, `All ${count} products must resolve`);

  const dims = resolvePosterDimensions({ dimensionPreset: 'a4_portrait' });
  const pages = computePosterLayoutPlan(resolved, 'a4_portrait', dims.widthPx, dims.heightPx);
  const totalDisplayed = pages.reduce((sum, page) => sum + page.items.length, 0);
  assert.equal(totalDisplayed, count, `Zero items omitted for ${count}-product combo`);
  if (count > 12) {
    assert.ok(pages.length >= 2, '>12 product combo must paginate into multi-page output');
  } else {
    assert.equal(pages.length, 1, '<=12 product combo fits on single poster page');
  }
}

// 3. Auto image resolution, missing detection, & isolated poster override (never mutates DB Product)
{
  const p1 = makeProduct('p-1', 'Black Leather Jacket', {
    image: 'https://cdn.example.com/jacket.jpg',
    color: 'Black',
  });
  const p2 = makeProduct('p-2', 'Onyx Chino Pant', {
    color: 'Onyx',
    image: undefined,
    images: [],
  });
  const combo = makeCombo(2, { name: 'Dark Luxury Combo' });

  const initialResolved = resolvePosterProductItems(combo, [p1, p2]);
  assert.equal(initialResolved[0].hasMissingImage, false);
  assert.equal(initialResolved[0].imageSource, 'product_db');
  assert.equal(initialResolved[1].hasMissingImage, true);
  assert.equal(initialResolved[1].imageSource, 'missing');

  const overrideMap = {
    [buildPosterItemKey('p-2')]: 'data:image/jpeg;base64,abc123',
  };
  const updatedResolved = resolvePosterProductItems(combo, [p1, p2], overrideMap);
  assert.equal(updatedResolved[1].hasMissingImage, false);
  assert.equal(updatedResolved[1].imageSource, 'poster_override');
  assert.equal(p2.image, undefined, 'Poster override must NEVER mutate original product record');
}

// 4. Intelligent Auto Design Engine theme selection
{
  const blackItems = [
    makeProduct('p-1', 'Black Kurta', { color: 'Black', image: 'a.jpg' }),
    makeProduct('p-2', 'Noir Watch', { color: 'Noir', image: 'b.jpg' }),
  ];
  const blackCombo = makeCombo(2, { name: 'Executive Style Pack' });
  const blackDesign = analyzeComboForPosterDesign(
    blackCombo,
    resolvePosterProductItems(blackCombo, blackItems)
  );
  assert.equal(blackDesign.templateId, 'premium_black_gold');

  const eidCombo = makeCombo(2, {
    name: 'Eid Mubarak Family Bundle',
    comboCategory: 'Eid Special Combo',
  });
  const eidDesign = analyzeComboForPosterDesign(
    eidCombo,
    resolvePosterProductItems(eidCombo, blackItems.map(p => ({ ...p, color: 'Cream' })))
  );
  assert.equal(eidDesign.templateId, 'eid_special');

  const kidsCombo = makeCombo(2, { name: 'Junior Playtime Set' });
  const kidsProds = [
    makeProduct('p-1', 'Kids Cotton Tee', { category: 'Kids Wear', color: 'Sky' }),
    makeProduct('p-2', 'Kids Denim Shorts', { category: 'Kids Wear', color: 'Blue' }),
  ];
  const kidsDesign = analyzeComboForPosterDesign(
    kidsCombo,
    resolvePosterProductItems(kidsCombo, kidsProds)
  );
  assert.equal(kidsDesign.templateId, 'kids_collection');
}

// 5. Exact pricing & discount math
{
  const combo = makeCombo(3, {
    regularTotalPrice: 2000,
    finalComboPrice: 1500,
  });
  const pricing = computePosterPricingSummary(combo, []);
  assert.equal(pricing.regularTotalPrice, 2000);
  assert.equal(pricing.finalComboPrice, 1500);
  assert.equal(pricing.savingsAmount, 500);
  assert.equal(pricing.discountPercent, 25);
}

// 6. Real scannable QR URL validation & Business completeness checks
{
  const combo = makeCombo(2, { name: 'Summer Duo', marketplaceSlug: 'summer-duo' });
  const noQr = resolveComboMarketplaceQrUrl(combo, baseSettings);
  assert.equal(noQr.isConfigured, false);
  assert.equal(noQr.url, null, 'Never generate fake QR URLs when marketplaceUrl is missing');

  const withSettingsQr = resolveComboMarketplaceQrUrl(combo, {
    ...baseSettings,
    marketplaceUrl: 'https://shop.urbanloom.com/',
  });
  assert.equal(withSettingsQr.isConfigured, true);
  assert.equal(withSettingsQr.url, 'https://shop.urbanloom.com/combo/summer-duo');

  const issues = getBusinessCompletenessIssues({ ...baseSettings, logoUrl: '' }, null);
  assert.ok(issues.missingFields.includes('Business Logo'));
  assert.equal(issues.hasMarketplaceUrl, false);
}

// 7. Marketplace order stock capacity & duplicate-safe stock deduction state machine
{
  const p1 = makeProduct('p-1', 'Polo', { currentStock: 6 });
  const p2 = makeProduct('p-2', 'Chino', { currentStock: 2 });
  const combo = makeCombo(2, { branchId: 'br-1' });

  const overCap = marketplaceOrderService.validateOrderCapacity(combo, [p1, p2], 3, 'br-1');
  assert.equal(overCap.valid, false);
  assert.equal(overCap.maxAvailable, 2);

  const okCap = marketplaceOrderService.validateOrderCapacity(combo, [p1, p2], 2, 'br-1');
  assert.equal(okCap.valid, true);

  const order: Pick<MarketplaceComboOrder, 'stockDeducted' | 'status'> = {
    status: 'pending',
    stockDeducted: false,
  };
  assert.equal(shouldDeductStockForTransition(order, 'confirmed'), true);
  assert.equal(shouldDeductStockForTransition(order, 'cancelled'), false);

  const alreadyDeducted: Pick<MarketplaceComboOrder, 'stockDeducted' | 'status'> = {
    status: 'confirmed',
    stockDeducted: true,
  };
  assert.equal(shouldDeductStockForTransition(alreadyDeducted, 'processing'), false);
  assert.equal(shouldDeductStockForTransition(alreadyDeducted, 'shipped'), false);
  assert.equal(shouldDeductStockForTransition(alreadyDeducted, 'delivered'), false);
}

// 8. Style Zone Mode 1 defaults & Mode 2 Custom Design Studio conversion + manipulation
{
  const prods = [
    makeProduct('p-1', 'Premium Polo Shirt', { image: 'https://cdn.example.com/polo.jpg' }),
    makeProduct('p-2', 'Stretch Chino Pant', { image: 'https://cdn.example.com/chino.jpg' }),
    makeProduct('p-3', 'Leather Belt', { image: 'https://cdn.example.com/belt.jpg' }),
  ];
  const combo = makeCombo(3, {
    name: 'Eid Gentleman Combo',
    marketplaceSlug: 'eid-gentleman-combo',
  });
  const settingsWithQr: ShopSettings = {
    ...baseSettings,
    marketplaceUrl: 'https://shop.urbanloom.com',
  };

  const defaults = buildDefaultPosterConfig(combo, prods);
  const dims = resolvePosterDimensions(defaults);
  assert.equal(defaults.mode, 'ai_creative');
  assert.equal(defaults.templateId, 'style_zone_reference');
  assert.equal(defaults.dimensionPreset, 'facebook_portrait');
  assert.equal(dims.widthPx, 1080);
  assert.equal(dims.heightPx, 1350);
  assert.equal(defaults.modelCategory, 'auto');
  assert.equal(defaults.removeModelBg, true);
  assert.equal(defaults.showDiscountBadge, true);

  const customProject = generateEditableLayersFromStyleZoneConfig({
    offer: combo,
    products: prods,
    settings: settingsWithQr,
    config: defaults,
    modelImageUrl: 'https://cdn.example.com/model-male.jpg',
  });

  assert.equal(customProject.canvasWidth, 1080);
  assert.equal(customProject.canvasHeight, 1350);
  assert.ok(customProject.layers.length >= 10, 'Must materialize full Style Zone sections as editable layers');

  const textLayers = customProject.layers.filter(l => l.type === 'text');
  assert.ok(
    textLayers.some(l => l.text.toUpperCase().includes('COMBO OFFER')),
    'Custom project must preserve COMBO OFFER hero headline'
  );
  assert.ok(
    textLayers.some(l => l.text.toUpperCase().includes('URBAN LOOM DHAKA')),
    'Custom project must include shop name layer'
  );
  assert.ok(
    textLayers.some(l => l.strikethrough === true),
    'Custom project must preserve strikethrough regular total layer'
  );

  const plusStickers = customProject.layers.filter(
    l => l.type === 'sticker' && l.stickerKind === 'plus_sign'
  );
  assert.equal(plusStickers.length, 2, '3 product cards must connect with 2 Plus (+) stickers');

  const qrLayers = customProject.layers.filter(l => l.type === 'qr');
  assert.equal(qrLayers.length, 1, 'Configured marketplaceUrl must emit 1 scannable QR layer');
  assert.equal(qrLayers[0].qrValue, 'https://shop.urbanloom.com/combo/eid-gentleman-combo');

  // Ensure blank project also starts cleanly without QR when unconfigured
  const blank = createBlankCustomProject(1080, 1920);
  assert.equal(blank.canvasWidth, 1080);
  assert.equal(blank.canvasHeight, 1920);
  assert.equal(blank.layers.length, 0);

  // Layer manipulation invariants: group, ungroup, align, distribute, z-order, duplicate
  const ids = customProject.layers.slice(0, 3).map(l => l.id);
  const grouped = groupSelectedLayers(customProject.layers, ids.slice(0, 2));
  assert.ok(grouped[0].groupId && grouped[0].groupId === grouped[1].groupId);
  const ungrouped = ungroupLayers(grouped, [grouped[0].id]);
  assert.equal(ungrouped[0].groupId, undefined);
  assert.equal(ungrouped[1].groupId, undefined);

  const alignedCenter = alignSelectedLayers(
    customProject.layers,
    [ids[0]],
    'center',
    customProject.canvasWidth,
    customProject.canvasHeight
  );
  assert.equal(
    alignedCenter.find(l => l.id === ids[0])?.x,
    Math.round(customProject.canvasWidth / 2 - alignedCenter.find(l => l.id === ids[0])!.width / 2)
  );

  const distributed = distributeSelectedLayers(customProject.layers, ids, 'horizontal');
  assert.equal(distributed.length, customProject.layers.length);

  const movedFront = reorderLayerZIndex(customProject.layers, ids[0], 'front');
  const maxZ = Math.max(...movedFront.map(l => l.zIndex));
  assert.equal(movedFront.find(l => l.id === ids[0])?.zIndex, maxZ);

  const dup = duplicateSelectedLayers(customProject.layers, [ids[0]]);
  assert.equal(dup.layers.length, customProject.layers.length + 1);
  assert.equal(dup.newIds.length, 1);
  assert.equal(prods[0].currentStock, 10, 'Designing custom poster must NEVER mutate product stock');
}

console.log('✅ Combo Poster Studio & Marketplace integration tests passed (all assertions green).');
