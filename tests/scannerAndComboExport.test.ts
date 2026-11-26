import assert from 'node:assert/strict';
import {
  collectUsedBarcodes,
  getScannerHidPreferences,
  isBarcodeDuplicate,
  lookupProductByScannedCode,
  parseScannedPayload,
  saveScannerHidPreferences,
} from '../src/utils/scannerLookup';
import {
  buildProductQrPayload,
  generateQrSvgMarkup,
  generateUniqueCode128Barcode,
  generateUniqueEan13Barcode,
  validateBarcodeValue,
} from '../src/utils/barcodeGenerator';
import {
  buildComboOfferPrintHtml,
  buildComboPdfFilename,
  resolveComboExportModel,
} from '../src/utils/comboExport';
import { comboOfferService } from '../src/services/comboOfferService';
import { Branch, ComboOffer, Product, SaleItem, ShopSettings } from '../src/types';

// Minimal localStorage + window shim for Node execution
const memoryStorage = new Map<string, string>();
if (typeof (globalThis as any).localStorage === 'undefined') {
  (globalThis as any).localStorage = {
    getItem: (k: string) => memoryStorage.get(k) ?? null,
    setItem: (k: string, v: string) => {
      memoryStorage.set(k, String(v));
    },
    removeItem: (k: string) => {
      memoryStorage.delete(k);
    },
    clear: () => {
      memoryStorage.clear();
    },
  };
}
if (typeof (globalThis as any).window === 'undefined') {
  (globalThis as any).window = {
    localStorage: (globalThis as any).localStorage,
  };
}

const sampleProducts: Product[] = [
  {
    id: 'prod-ean13',
    name: 'Classic Cotton Panjabi',
    code: 'PNJ-001',
    barcode: '8941234567890',
    category: 'Panjabi',
    unit: 'pcs',
    purchasePrice: 900,
    totalUnitCost: 950,
    allocatedOpExPerUnit: 50,
    salePrice: 1850,
    minSalePrice: 1100,
    currentStock: 3,
    minStockAlert: 2,
    size: 'L',
    color: 'Ivory',
    hasVariants: false,
    branchId: 'branch-main',
    isActive: true,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  },
  {
    id: 'prod-variant',
    name: 'Heritage Denim Jacket',
    code: 'DJ-202',
    barcode: '012345678905', // UPC-A
    category: 'Jackets',
    unit: 'pcs',
    purchasePrice: 1400,
    totalUnitCost: 1460,
    allocatedOpExPerUnit: 60,
    salePrice: 2600,
    minSalePrice: 1650,
    currentStock: 5,
    minStockAlert: 1,
    hasVariants: true,
    variants: [
      {
        id: 'var-dj-blue-m',
        sku: 'DJ-202-BM',
        barcode: 'PTV-DJ202-BM', // Code 128 / Code 39
        color: 'Indigo',
        size: 'M',
        stock: 2,
        salePrice: 2600,
        purchasePrice: 1400,
      },
      {
        id: 'var-dj-blk-xl',
        sku: 'DJ-202-BXL',
        barcode: '96385074', // EAN-8
        color: 'Charcoal',
        size: 'XL',
        stock: 0, // Out of stock variant
        salePrice: 2750,
        purchasePrice: 1450,
      },
    ],
    branchId: 'branch-main',
    isActive: true,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  },
  {
    id: 'prod-oos',
    name: 'Silk Festive Shawl',
    code: 'SHW-999',
    barcode: '042100005264',
    category: 'Accessories',
    unit: 'pcs',
    purchasePrice: 400,
    salePrice: 850,
    currentStock: 0,
    minStockAlert: 2,
    hasVariants: false,
    branchId: 'branch-main',
    isActive: true,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  },
  {
    id: 'prod-other-branch',
    name: 'Chittagong Exclusive Polo',
    code: 'CTG-101',
    barcode: '8949999999994',
    category: 'Polo',
    unit: 'pcs',
    purchasePrice: 500,
    salePrice: 1100,
    currentStock: 10,
    minStockAlert: 2,
    hasVariants: false,
    branchId: 'branch-ctg',
    isActive: true,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  },
];

const sampleSettings: ShopSettings = {
  shopName: 'PROTIVA Flagship Store',
  tagline: 'Modern Apparel & Lifestyle',
  address: 'House 24, Road 11, Banani, Dhaka',
  mobile: '01711-000111',
  email: 'hello@protiva.shop',
  logoUrl: 'https://cdn.protiva.shop/logo.png',
  currency: '৳',
  vatTaxRate: 0,
  invoiceFormat: 'thermal',
  businessType: 'clothing',
  language: 'en',
  uiMode: 'advanced',
};

const sampleBranch: Branch = {
  id: 'branch-main',
  name: 'Banani Main Branch',
  location: 'Banani, Dhaka',
  mobile: '01711-000111',
  isMain: true,
};

const sampleCombo: ComboOffer = {
  id: 'combo-eid-1',
  businessId: 'biz-1',
  name: 'Eid Festive Royal Combo <VIP>',
  comboCategory: 'Festival Bundle',
  description: 'Complete Panjabi & Jacket festive pair',
  offerType: 'fixed_price',
  items: [
    {
      id: 'item-1',
      productId: 'prod-ean13',
      productName: 'Classic Cotton Panjabi',
      quantity: 2,
      salePrice: 1850,
    },
    {
      id: 'item-2',
      productId: 'prod-variant',
      variantId: 'var-dj-blue-m',
      productName: 'Heritage Denim Jacket',
      variantDetails: 'Indigo / M',
      quantity: 1,
      salePrice: 2600,
    },
  ],
  regularTotalPrice: 6300,
  finalComboPrice: 5400,
  discountType: 'fixed_bundle_price',
  discountValue: 5400,
  totalCostOfGoods: 3360,
  allocatedOpEx: 160,
  grossProfit: 2040,
  estimatedNetProfit: 1880,
  profitMarginPercent: 34.81,
  isLossMaking: false,
  minSafeSellingPrice: 3600,
  startDate: '2026-01-01',
  status: 'active',
  usageCount: 0,
  priorityRank: 10,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`PASS: ${name}`);
}

// 1. Scan formats & payload resolution
test('lookupProductByScannedCode matches EAN-13, EAN-8, UPC-A, Code 128, SKU, and QR payloads', () => {
  const ean13Match = lookupProductByScannedCode('8941234567890', sampleProducts, 'branch-main');
  assert.equal(ean13Match.found, true);
  assert.equal(ean13Match.matchType, 'product_barcode');
  assert.equal(ean13Match.product?.id, 'prod-ean13');

  const upcaMatch = lookupProductByScannedCode('012345678905', sampleProducts, 'branch-main');
  assert.equal(upcaMatch.found, true);
  assert.equal(upcaMatch.product?.id, 'prod-variant');
  assert.equal(upcaMatch.requiresVariantSelection, true);

  const code128Var = lookupProductByScannedCode('PTV-DJ202-BM', sampleProducts, 'branch-main');
  assert.equal(code128Var.found, true);
  assert.equal(code128Var.matchType, 'variant_barcode');
  assert.equal(code128Var.variant?.id, 'var-dj-blue-m');

  const ean8Var = lookupProductByScannedCode('96385074', sampleProducts, 'branch-main');
  assert.equal(ean8Var.found, true);
  assert.equal(ean8Var.variant?.id, 'var-dj-blk-xl');

  const qrPayload = buildProductQrPayload('prod-variant', 'var-dj-blue-m');
  assert.equal(qrPayload, 'PROTIVA:V:prod-variant:var-dj-blue-m');
  const qrMatch = lookupProductByScannedCode(qrPayload, sampleProducts, 'branch-main');
  assert.equal(qrMatch.found, true);
  assert.equal(qrMatch.matchType, 'qr_variant');
  assert.equal(qrMatch.variant?.id, 'var-dj-blue-m');

  const jsonParsed = parseScannedPayload('{"productId":"prod-ean13"}');
  assert.equal(jsonParsed.payloadKind, 'json_qr');
  assert.equal(lookupProductByScannedCode('{"productId":"prod-ean13"}', sampleProducts, 'branch-main').product?.id, 'prod-ean13');
});

// 2. Branch isolation + Unknown barcode
test('lookupProductByScannedCode enforces branch scoping and returns clean not-found for unknown barcodes', () => {
  const wrongBranch = lookupProductByScannedCode('8949999999994', sampleProducts, 'branch-main');
  assert.equal(wrongBranch.found, false);
  assert.equal(wrongBranch.matchType, 'none');

  const unknown = lookupProductByScannedCode('NO-SUCH-BARCODE-9999', sampleProducts, 'branch-main');
  assert.equal(unknown.found, false);
  assert.equal(unknown.matchType, 'none');
});

// 3. Barcode generation & uniqueness validation
test('unique barcode generation avoids duplicates and generates scannable QR SVG', () => {
  const used = collectUsedBarcodes(sampleProducts);
  assert.equal(used.has('8941234567890'), true);
  assert.equal(used.has('ptv-dj202-bm'), true);

  const dup = isBarcodeDuplicate('8941234567890', sampleProducts);
  assert.equal(dup.duplicate, true);

  const newEan = generateUniqueEan13Barcode(used, '894');
  assert.equal(validateBarcodeValue(newEan, 'EAN13').valid, true);
  assert.equal(used.has(newEan), false);

  const newC128 = generateUniqueCode128Barcode('PTV', used);
  assert.equal(validateBarcodeValue(newC128, 'CODE128').valid, true);
  assert.equal(used.has(newC128.toLowerCase()), false);

  const qrSvg = generateQrSvgMarkup('PROTIVA:P:prod-ean13', { size: 96, showText: true });
  assert.ok(qrSvg.includes('<svg') && qrSvg.includes('<path'));
});

// 4. Simulated POS auto-add repeated scan, multi-product scan, out-of-stock, & invoice validation
test('POS scan flow increments quantity up to stock limit, blocks out-of-stock/over-stock, and validates invoice items', () => {
  const cart: SaleItem[] = [];

  const simulatePosScan = (rawCode: string): { ok: boolean; reason: string } => {
    const match = lookupProductByScannedCode(rawCode, sampleProducts, 'branch-main');
    if (!match.found || !match.product) {
      return { ok: false, reason: 'Product Not Found' };
    }
    const prod = match.product;
    const variant = match.variant;
    const availableStock = variant ? variant.stock : prod.currentStock;
    if (availableStock <= 0) {
      return { ok: false, reason: 'Out of Stock' };
    }

    const idx = cart.findIndex(
      c => c.productId === prod.id && (variant ? c.variantId === variant.id : !c.variantId)
    );
    const candidateCart =
      idx > -1
        ? cart.map((c, i) => (i === idx ? { ...c, quantity: c.quantity + 1 } : c))
        : [
            ...cart,
            {
              productId: prod.id,
              productName: prod.name,
              sku: variant ? variant.sku : prod.code,
              unitPrice: variant?.salePrice ?? prod.salePrice,
              purchasePrice: variant?.purchasePrice ?? prod.purchasePrice,
              quantity: 1,
              discount: 0,
              total: variant?.salePrice ?? prod.salePrice,
              variantId: variant?.id,
            } as SaleItem,
          ];

    const check = comboOfferService.validateAggregateCartStock(
      candidateCart,
      sampleProducts,
      'branch-main'
    );
    if (!check.valid) {
      return { ok: false, reason: check.errors[0] || 'Insufficient Stock' };
    }

    cart.splice(0, cart.length, ...candidateCart);
    return { ok: true, reason: 'Added' };
  };

  // Scan Panjabi (stock 3) three times consecutively
  assert.equal(simulatePosScan('8941234567890').ok, true);
  assert.equal(simulatePosScan('8941234567890').ok, true);
  assert.equal(simulatePosScan('8941234567890').ok, true);
  assert.equal(cart[0].quantity, 3);

  // 4th scan must be blocked by stock validation
  const overScan = simulatePosScan('8941234567890');
  assert.equal(overScan.ok, false);
  assert.equal(cart[0].quantity, 3);

  // Scan different product (variant barcode PTV-DJ202-BM, stock 2)
  assert.equal(simulatePosScan('PTV-DJ202-BM').ok, true);
  assert.equal(cart.length, 2);
  assert.equal(cart[1].quantity, 1);

  // Out-of-stock product and out-of-stock variant blocked cleanly
  assert.equal(simulatePosScan('042100005264').reason, 'Out of Stock');
  assert.equal(simulatePosScan('96385074').reason, 'Out of Stock');

  // Unknown barcode returns Product Not Found
  assert.equal(simulatePosScan('UNKNOWN-404').reason, 'Product Not Found');
});

// 5. HID preferences storage round-trip
test('HID preferences persist cleanly', () => {
  saveScannerHidPreferences({
    terminator: 'enter',
    duplicateCooldownMs: 600,
    autoFocusInPos: false,
    beepOnScan: false,
  });
  const loaded = getScannerHidPreferences();
  assert.equal(loaded.terminator, 'enter');
  assert.equal(loaded.duplicateCooldownMs, 600);
  assert.equal(loaded.beepOnScan, false);
});

// 6. Combo Preview Export (Print & PDF models across A4, A5, 80mm, 58mm)
test('comboExport builds accurate customer pricing, filenames, and print HTML without modifying stock', () => {
  const stockSnapshot = sampleProducts.map(p => ({
    id: p.id,
    stock: p.currentStock,
    variants: p.variants?.map(v => v.stock),
  }));

  const model = resolveComboExportModel(sampleCombo, sampleProducts, sampleSettings, sampleBranch);
  assert.equal(model.shopName, 'PROTIVA Flagship Store');
  assert.equal(model.logoUrl, 'https://cdn.protiva.shop/logo.png');
  assert.equal(model.mobile, '01711-000111');
  assert.equal(model.email, 'hello@protiva.shop');
  assert.equal(model.comboCategory, 'Festival Bundle');
  assert.equal(model.items.length, 2);
  assert.equal(model.items[0].size, 'L');
  assert.equal(model.items[0].color, 'Ivory');
  assert.equal(model.items[0].quantity, 2);
  assert.equal(model.items[1].size, 'M');
  assert.equal(model.items[1].color, 'Indigo');
  assert.equal(model.regularTotalPrice, 6300);
  assert.equal(model.finalComboPrice, 5400);
  assert.equal(model.discountAmount, 900);
  assert.equal(model.customerSavings, 900);
  assert.ok(model.discountPercent > 14 && model.discountPercent < 15);

  assert.equal(buildComboPdfFilename(sampleCombo.name, 'a4'), 'eid-festive-royal-combo-vip-a4.pdf');
  assert.equal(buildComboPdfFilename(sampleCombo.name, 'a5'), 'eid-festive-royal-combo-vip-a5.pdf');

  for (const format of ['a4', 'a5', '80mm', '58mm'] as const) {
    const html = buildComboOfferPrintHtml(sampleCombo, sampleProducts, sampleSettings, format, sampleBranch);
    assert.ok(html.includes('PROTIVA Flagship Store'), `Missing shop name in ${format}`);
    assert.ok(html.includes('https://cdn.protiva.shop/logo.png'), `Missing logo in ${format}`);
    assert.ok(html.includes('Eid Festive Royal Combo &lt;VIP&gt;'), `Missing escaped combo name in ${format}`);
    assert.ok(html.includes('Festival Bundle'), `Missing category in ${format}`);
    assert.ok(html.includes('Classic Cotton Panjabi'), `Missing product 1 in ${format}`);
    assert.ok(html.includes('Heritage Denim Jacket'), `Missing product 2 in ${format}`);
    assert.ok(html.includes('5,400'), `Missing combo offer price in ${format}`);
    assert.ok(html.includes('900'), `Missing discount/savings in ${format}`);
    assert.ok(html.includes('01711-000111'), `Missing contact phone in ${format}`);
  }

  // Zero inventory mutation guarantee
  assert.deepEqual(
    sampleProducts.map(p => ({
      id: p.id,
      stock: p.currentStock,
      variants: p.variants?.map(v => v.stock),
    })),
    stockSnapshot
  );
});

console.log(`\nAll ${passed} scanner & combo export tests passed!`);
