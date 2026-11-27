import assert from 'node:assert/strict';
import {
  buildInvoiceHtml,
  buildLabelsHtml,
  clampWatermarkOpacity,
  clampWatermarkSize,
  DEFAULT_PRINTER_SETTINGS,
  getPrinterSettings,
} from '../src/utils/printEngine';
import { APP_IDENTITY } from '../src/config/appIdentity';
import { Branch, LabelConfig, Sale, ShopSettings } from '../src/types';

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

const baseSettings: ShopSettings = {
  shopName: 'PROTIVA Fashion House',
  tagline: 'Everyday Smart Retail',
  address: 'House 12, Road 4, Dhanmondi, Dhaka',
  mobile: '+880 1711-223344',
  email: 'hello@protivafashion.com',
  logoUrl: 'data:image/png;base64,CUSTOM_LOGO_V1',
  vatTaxRate: 5,
  invoiceFormat: 'thermal',
  businessType: 'clothing',
  currency: 'BDT (৳)',
  financialYear: '2026-2027',
  language: 'en',
  uiMode: 'advanced',
};

const sampleBranch: Branch = {
  id: 'br-1',
  name: 'Dhanmondi Flagship',
  location: 'House 12, Road 4, Dhanmondi',
  mobile: '+880 1711-223344',
  isMain: true,
};

const sampleSale: Sale = {
  id: 'sale-1001',
  invoiceNumber: 'INV-2026-1001',
  date: '2026-11-27T10:30:00.000Z',
  customerName: 'Ayesha Rahman',
  customerMobile: '+880 1811-998877',
  items: [
    {
      productId: 'p-1',
      productName: 'Premium Linen Panjabi',
      sku: 'PNJ-LIN-L',
      variantDetails: 'Ivory / L',
      quantity: 2,
      purchasePrice: 900,
      unitPrice: 1450,
      discount: 100,
      total: 2800,
    },
  ],
  subtotal: 2900,
  discount: 100,
  vatTaxRate: 5,
  vatTaxAmount: 140,
  total: 2940,
  paid: 2500,
  due: 440,
  paymentMethod: 'cash',
  payments: [{ method: 'cash', amount: 2500 }],
  servedBy: 'Karim',
  branchId: 'br-1',
  status: 'partial',
};

// 1. Default values & clamping
assert.equal(DEFAULT_PRINTER_SETTINGS.invoiceShowHeaderLogo, true);
assert.equal(DEFAULT_PRINTER_SETTINGS.invoiceShowWatermark, true);
assert.equal(DEFAULT_PRINTER_SETTINGS.invoiceWatermarkSize, 70);
assert.equal(DEFAULT_PRINTER_SETTINGS.invoiceWatermarkOpacity, 8);

assert.equal(clampWatermarkSize(undefined), 70);
assert.equal(clampWatermarkSize(5), 20);
assert.equal(clampWatermarkSize(150), 100);
assert.equal(clampWatermarkSize(64.6), 65);

assert.equal(clampWatermarkOpacity(undefined), 8);
assert.equal(clampWatermarkOpacity(0), 2);
assert.equal(clampWatermarkOpacity(80), 30);
assert.equal(clampWatermarkOpacity(12.4), 12);

// 2. Backward compatibility when stored settings lack watermark fields
localStorage.setItem(
  'AMAR_DOKAN_PRO_PRINTER_SETTINGS',
  JSON.stringify({ invoicePaperSize: 'a4', invoiceMarginMm: 10 })
);
const resolvedLegacy = getPrinterSettings({ invoiceFormat: 'a4' });
assert.equal(resolvedLegacy.invoiceShowHeaderLogo, true);
assert.equal(resolvedLegacy.invoiceShowWatermark, true);
assert.equal(resolvedLegacy.invoiceWatermarkSize, 70);
assert.equal(resolvedLegacy.invoiceWatermarkOpacity, 8);
localStorage.clear();

// 3. Thermal, A5, and A4 invoice HTML include matching header logo & watermark + all required fields
for (const format of ['thermal', 'a5', 'a4'] as const) {
  const { html } = buildInvoiceHtml(
    sampleSale,
    baseSettings,
    format,
    undefined,
    sampleBranch
  );

  assert.ok(html.includes('class="invoice-watermark"'), `${format}: missing watermark container`);
  assert.ok(
    html.includes('src="data:image/png;base64,CUSTOM_LOGO_V1"'),
    `${format}: custom logo must appear in header & watermark`
  );
  assert.ok(html.includes('class="logo"'), `${format}: missing header logo`);
  assert.ok(html.includes('width: 70%'), `${format}: default watermark size 70% missing`);
  assert.ok(html.includes('opacity: 0.08'), `${format}: default watermark opacity 0.08 missing`);
  assert.ok(html.includes('grayscale(100%)'), `${format}: grayscale filter missing`);
  assert.ok(html.includes('z-index: 0'), `${format}: watermark z-index: 0 missing`);
  assert.ok(html.includes('z-index: 1'), `${format}: foreground z-index: 1 missing`);

  // Preserve all existing invoice content & footer
  assert.ok(html.includes('PROTIVA Fashion House'), `${format}: shop name missing`);
  assert.ok(html.includes('Dhanmondi Flagship'), `${format}: branch missing`);
  assert.ok(html.includes('INV-2026-1001'), `${format}: invoice number missing`);
  assert.ok(html.includes('Ayesha Rahman'), `${format}: customer missing`);
  assert.ok(html.includes('Premium Linen Panjabi'), `${format}: product name missing`);
  assert.ok(html.includes('PNJ-LIN-L'), `${format}: SKU missing`);
  assert.ok(html.includes('Authorized Signature'), `${format}: signature missing`);
  assert.ok(html.includes(APP_IDENTITY.name), `${format}: Powered by PROTIVA footer missing`);
  assert.ok(html.includes('<svg'), `${format}: invoice barcode SVG missing`);
}

// 4. Independent toggles + automatic fallback logo sync
const headerHiddenSettings: ShopSettings = {
  ...baseSettings,
  logoUrl: '',
  printerSettings: {
    ...DEFAULT_PRINTER_SETTINGS,
    invoiceShowHeaderLogo: false,
    invoiceShowWatermark: true,
    invoiceWatermarkSize: 85,
    invoiceWatermarkOpacity: 14,
  },
};
const headerHiddenOut = buildInvoiceHtml(sampleSale, headerHiddenSettings, 'a4', undefined, sampleBranch);
assert.ok(!headerHiddenOut.html.includes('class="logo"'), 'Header logo should be hidden when disabled');
assert.ok(headerHiddenOut.html.includes('class="invoice-watermark"'), 'Body watermark should still render');
assert.ok(
  headerHiddenOut.html.includes(`src="${APP_IDENTITY.symbolPath}"`),
  'Watermark should fall back to default app symbol when shop logo is empty'
);
assert.ok(headerHiddenOut.html.includes('width: 85%'), 'Updated watermark size should apply');
assert.ok(headerHiddenOut.html.includes('opacity: 0.14'), 'Updated watermark opacity should apply');

const watermarkHiddenSettings: ShopSettings = {
  ...baseSettings,
  printerSettings: {
    ...DEFAULT_PRINTER_SETTINGS,
    invoiceShowHeaderLogo: true,
    invoiceShowWatermark: false,
  },
};
const watermarkHiddenOut = buildInvoiceHtml(sampleSale, watermarkHiddenSettings, 'thermal');
assert.ok(watermarkHiddenOut.html.includes('class="logo"'), 'Header logo should render when enabled');
assert.ok(
  !watermarkHiddenOut.html.includes('<div class="invoice-watermark"'),
  'Body watermark element should not render when disabled'
);

// 5. Updating shop logo updates both header & watermark automatically
const updatedLogoSettings: ShopSettings = {
  ...baseSettings,
  logoUrl: 'data:image/png;base64,UPDATED_SHOP_LOGO_V2',
};
const updatedLogoOut = buildInvoiceHtml(sampleSale, updatedLogoSettings, 'a4');
const logoOccurrences = updatedLogoOut.html.split('data:image/png;base64,UPDATED_SHOP_LOGO_V2').length - 1;
assert.equal(logoOccurrences, 2, 'Both header logo and body watermark should reference the updated shop logo');

// 6. Other print modules (Barcode Labels) do NOT receive invoice watermark
const labelConfig: LabelConfig = {
  template: '40x30',
  barcodeFormat: 'CODE128',
  showShopName: true,
  showShopLogo: true,
  showProductName: true,
  showVariantDetails: true,
  showPrice: true,
  showSku: true,
  showBarcodeNumber: true,
  copiesPerItem: 1,
};
const labelPayload = buildLabelsHtml(
  [
    {
      productId: 'p-1',
      productName: 'Premium Linen Panjabi',
      sku: 'PNJ-LIN-L',
      barcode: 'PNJLINL01',
      price: 1450,
      copies: 1,
    },
  ],
  labelConfig,
  baseSettings
);
assert.ok(!labelPayload.html.includes('invoice-watermark'), 'Barcode labels must never show invoice watermark');

console.log('All invoice watermark tests passed.');
