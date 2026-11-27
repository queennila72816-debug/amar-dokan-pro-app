import {
  Branch,
  Customer,
  CustomerTransaction,
  InvoicePaperSize,
  LabelConfig,
  LabelTemplateId,
  PrinterSettings,
  Purchase,
  Sale,
  ShopSettings,
  Supplier,
  SupplierTransaction,
} from '../types';
import { APP_IDENTITY, getBusinessDisplayName, resolveBusinessProfile } from '../config/appIdentity';
import {
  buildProductQrPayload,
  generateBarcodeSvgMarkup,
  generateQrSvgMarkup,
} from './barcodeGenerator';
import { formatCurrency, formatDate, formatTime } from './formatters';

const PRINTER_SETTINGS_KEY = 'AMAR_DOKAN_PRO_PRINTER_SETTINGS';
const SHOP_LOGO_KEY = 'AMAR_DOKAN_PRO_SHOP_LOGO';
const PRINT_STYLE_ID = 'amar-dokan-print-style';
const PRINT_ROOT_ID = 'amar-dokan-print-root';
const PRINT_IFRAME_ID = 'amar-dokan-print-iframe';

export const DEFAULT_PRINTER_SETTINGS: PrinterSettings = {
  invoicePaperSize: 'thermal',
  invoiceOrientation: 'portrait',
  invoiceMarginMm: 4,
  invoiceFontSize: 'medium',
  invoiceShowHeaderLogo: true,
  invoiceShowWatermark: true,
  invoiceWatermarkSize: 70,
  invoiceWatermarkOpacity: 8,
  labelTemplate: '40x30',
  labelWidthMm: 40,
  labelHeightMm: 30,
  labelOrientation: 'portrait',
  labelMarginMm: 2,
  labelsPerRow: 3,
  labelGapXMm: 3,
  labelGapYMm: 3,
  barcodeHeightPx: 28,
  labelFontSize: 'medium',
  showScaleGuidance: true,
};

export function clampWatermarkSize(value: unknown): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return 70;
  return Math.max(20, Math.min(100, Math.round(num)));
}

export function clampWatermarkOpacity(value: unknown): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return 8;
  return Math.max(2, Math.min(30, Math.round(num)));
}

export interface PrintLabelItem {
  productId: string;
  variantId?: string;
  productName: string;
  variantDetails?: string;
  sku: string;
  barcode: string;
  price: number;
  copies: number;
}

export interface PrintPreviewPayload {
  title: string;
  html: string;
  paperInfo: string;
  showScaleGuidance: boolean;
  totalLabels?: number;
}

export interface PrintResult {
  opened: boolean;
  cancelled?: boolean;
  error?: string;
}

let isPrintingInProgress = false;
let cleanupTimerId: number | null = null;
let activePrintToken = 0;
let activeCleanupDisposers: Array<() => void> = [];
let savedHostDocumentTitle: string | null = null;

const MAX_LABEL_CARD_CACHE = 800;
const labelCardHtmlCache = new Map<string, string>();

function setBoundedCardCache(key: string, html: string): void {
  if (labelCardHtmlCache.size >= MAX_LABEL_CARD_CACHE) {
    const oldestKey = labelCardHtmlCache.keys().next().value;
    if (oldestKey !== undefined) {
      labelCardHtmlCache.delete(oldestKey);
    }
  }
  labelCardHtmlCache.set(key, html);
}

export function isPrintJobPreparing(): boolean {
  return isPrintingInProgress;
}

function restoreHostDocumentTitle(): void {
  if (typeof document === 'undefined') return;
  if (savedHostDocumentTitle !== null) {
    document.title = savedHostDocumentTitle;
    savedHostDocumentTitle = null;
  }
}

function detachActivePrintListeners(): void {
  if (cleanupTimerId !== null && typeof window !== 'undefined') {
    window.clearTimeout(cleanupTimerId);
    cleanupTimerId = null;
  }
  if (activeCleanupDisposers.length > 0) {
    const disposers = activeCleanupDisposers;
    activeCleanupDisposers = [];
    for (const dispose of disposers) {
      try {
        dispose();
      } catch {
        // ignore listener disposal edge cases
      }
    }
  }
}

export function cleanupPrintPortal(): void {
  detachActivePrintListeners();
  restoreHostDocumentTitle();
  if (typeof document === 'undefined') return;

  const existingIframe = document.getElementById(PRINT_IFRAME_ID);
  if (existingIframe && existingIframe.parentNode) {
    existingIframe.parentNode.removeChild(existingIframe);
  }
  const existingRoot = document.getElementById(PRINT_ROOT_ID);
  if (existingRoot && existingRoot.parentNode) {
    existingRoot.parentNode.removeChild(existingRoot);
  }
  const existingStyle = document.getElementById(PRINT_STYLE_ID);
  if (existingStyle && existingStyle.parentNode) {
    existingStyle.parentNode.removeChild(existingStyle);
  }
}

export function cancelActivePrintJob(): void {
  activePrintToken += 1;
  isPrintingInProgress = false;
  cleanupPrintPortal();
}

export function getPrinterSettings(shopSettings?: Partial<ShopSettings>): PrinterSettings {
  let stored: Partial<PrinterSettings> = {};
  try {
    const raw = localStorage.getItem(PRINTER_SETTINGS_KEY);
    if (raw) {
      stored = JSON.parse(raw);
    }
  } catch {
    stored = {};
  }

  const merged: PrinterSettings = {
    ...DEFAULT_PRINTER_SETTINGS,
    ...(shopSettings?.invoiceFormat ? { invoicePaperSize: shopSettings.invoiceFormat } : {}),
    ...stored,
    ...(shopSettings?.printerSettings || {}),
  };

  return {
    ...merged,
    invoiceShowHeaderLogo:
      typeof merged.invoiceShowHeaderLogo === 'boolean'
        ? merged.invoiceShowHeaderLogo
        : DEFAULT_PRINTER_SETTINGS.invoiceShowHeaderLogo,
    invoiceShowWatermark:
      typeof merged.invoiceShowWatermark === 'boolean'
        ? merged.invoiceShowWatermark
        : DEFAULT_PRINTER_SETTINGS.invoiceShowWatermark,
    invoiceWatermarkSize: clampWatermarkSize(merged.invoiceWatermarkSize),
    invoiceWatermarkOpacity: clampWatermarkOpacity(merged.invoiceWatermarkOpacity),
  };
}

export function savePrinterSettings(printerSettings: PrinterSettings): void {
  try {
    localStorage.setItem(PRINTER_SETTINGS_KEY, JSON.stringify(printerSettings));
  } catch {
    // ignore storage quota errors
  }
}

export function getShopLogo(shopSettings?: Partial<ShopSettings>, businessId?: string): string {
  if (typeof shopSettings?.logoUrl === 'string') {
    if (shopSettings.logoUrl.trim()) return shopSettings.logoUrl.trim();
    return '';
  }
  try {
    if (businessId) {
      const bizLogo = localStorage.getItem(`${SHOP_LOGO_KEY}_${businessId}`);
      if (bizLogo) return bizLogo;
    }
    return localStorage.getItem(SHOP_LOGO_KEY) || '';
  } catch {
    return '';
  }
}

export function saveShopLogo(logoUrl: string, businessId?: string): void {
  try {
    const trimmed = logoUrl.trim();
    if (trimmed) {
      localStorage.setItem(SHOP_LOGO_KEY, trimmed);
      if (businessId) {
        localStorage.setItem(`${SHOP_LOGO_KEY}_${businessId}`, trimmed);
      }
    } else {
      localStorage.removeItem(SHOP_LOGO_KEY);
      if (businessId) {
        localStorage.removeItem(`${SHOP_LOGO_KEY}_${businessId}`);
      }
    }
  } catch {
    // ignore storage quota errors
  }
}

export function escapeHtml(val: string | number | undefined | null): string {
  if (val === undefined || val === null) return '';
  return String(val)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const STYLE_START_MARKER = '/*ADP_STYLE_START*/';
const STYLE_END_MARKER = '/*ADP_STYLE_END*/';
const BODY_START_MARKER = '<!--ADP_BODY_START-->';
const BODY_END_MARKER = '<!--ADP_BODY_END-->';

export function buildStandaloneDocument(
  title: string,
  bodyHtml: string,
  pageCss: string,
  extraStyles: string = ''
): string {
  const combinedCss = `${pageCss}\n${extraStyles}`;
  return `<!DOCTYPE html>
<html lang="en" class="adp-preview-frame">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(title)}</title>
  <style>
    ${STYLE_START_MARKER}
    .adp-doc, .adp-doc * {
      box-sizing: border-box;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .adp-doc {
      color: #0f172a;
      font-family: 'Hind Siliguri', 'Noto Sans Bengali', 'Plus Jakarta Sans', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }
    .adp-doc .mono {
      font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-variant-numeric: tabular-nums;
    }
    html.adp-preview-frame, html.adp-preview-frame body {
      margin: 0;
      padding: 0;
      background: #ffffff;
    }
    ${combinedCss}
    ${STYLE_END_MARKER}
  </style>
</head>
<body>
  ${BODY_START_MARKER}<div class="adp-doc">${bodyHtml}</div>${BODY_END_MARKER}
</body>
</html>`;
}

function extractPrintParts(html: string): { css: string; bodyHtml: string } {
  const sStart = html.indexOf(STYLE_START_MARKER);
  const sEnd = html.indexOf(STYLE_END_MARKER);
  const bStart = html.indexOf(BODY_START_MARKER);
  const bEnd = html.indexOf(BODY_END_MARKER);

  if (sStart !== -1 && sEnd !== -1 && bStart !== -1 && bEnd !== -1) {
    return {
      css: html.slice(sStart + STYLE_START_MARKER.length, sEnd),
      bodyHtml: html.slice(bStart + BODY_START_MARKER.length, bEnd),
    };
  }

  // Fallback for generic HTML documents
  if (typeof DOMParser !== 'undefined') {
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    const css = Array.from(parsed.querySelectorAll('style'))
      .map(el => el.textContent || '')
      .join('\n');
    const bodyHtml = parsed.body ? parsed.body.innerHTML : html;
    return { css, bodyHtml };
  }

  return { css: '', bodyHtml: html };
}

export function buildInvoiceHtml(
  sale: Sale,
  settings: ShopSettings,
  formatOverride?: InvoicePaperSize,
  printerOverride?: Partial<PrinterSettings>,
  activeBranch?: Branch | null
): { html: string; paperSize: InvoicePaperSize; paperInfo: string; showScaleGuidance: boolean } {
  const printer = { ...getPrinterSettings(settings), ...(printerOverride || {}) };
  const paperSize: InvoicePaperSize = formatOverride || printer.invoicePaperSize || settings.invoiceFormat || 'thermal';
  const lang = settings.language || 'en';
  const currency = settings.currency || '৳';
  const logoUrl = getShopLogo(settings);
  const effectiveLogoUrl = logoUrl || APP_IDENTITY.symbolPath;
  const showHeaderLogo = printer.invoiceShowHeaderLogo !== false;
  const showWatermark = printer.invoiceShowWatermark !== false;
  const watermarkSize = clampWatermarkSize(printer.invoiceWatermarkSize);
  const watermarkOpacityPct = clampWatermarkOpacity(printer.invoiceWatermarkOpacity);
  const watermarkOpacityDecimal = (watermarkOpacityPct / 100).toFixed(2);
  const biz = resolveBusinessProfile(settings, activeBranch);

  const fontScaleMap = {
    small: paperSize === 'thermal' ? 10 : 10.5,
    medium: paperSize === 'thermal' ? 11.5 : 12,
    large: paperSize === 'thermal' ? 13 : 13.5,
  };
  const baseFontPx = fontScaleMap[printer.invoiceFontSize || 'medium'];
  const marginMm = Math.max(0, Math.min(25, Number(printer.invoiceMarginMm ?? (paperSize === 'thermal' ? 3 : 10))));

  const invoiceBarcodeSvg = generateBarcodeSvgMarkup(sale.invoiceNumber || sale.id, {
    width: paperSize === 'thermal' ? 200 : 180,
    height: paperSize === 'thermal' ? 36 : 30,
    showText: true,
    format: 'CODE128',
    fontSize: 10,
  });

  const formatMoney = (amount: number) => {
    const formatted = formatCurrency(amount, 'en');
    return currency === '৳' ? formatted : formatted.replace('৳', currency);
  };

  const statusLabel =
    sale.status === 'paid'
      ? 'PAID'
      : sale.status === 'due'
      ? 'DUE'
      : sale.status === 'partial'
      ? 'PARTIAL'
      : sale.status === 'returned'
      ? 'RETURNED'
      : 'VOIDED';

  const paymentsSummary =
    sale.payments && sale.payments.length > 0
      ? sale.payments.map(p => `${p.method.toUpperCase()} (${formatMoney(p.amount)})`).join(', ')
      : sale.paymentMethod.toUpperCase();

  const comboPackages = sale.comboPackages || [];
  const comboInstanceSet = new Set(comboPackages.map(p => p.instanceId));
  const regularItems = sale.items.filter(
    it => !it.comboInstanceId || !comboInstanceSet.has(it.comboInstanceId)
  );
  const packageSavings = comboPackages.reduce((s, p) => s + (Number(p.discountTotal ?? p.discountAmount) || 0), 0);
  const comboDiscount = Math.max(0, Number(sale.comboDiscount || 0) - packageSavings);
  const additionalDiscount = Math.max(0, Number(sale.discount || 0) - comboDiscount);

  if (paperSize === 'thermal') {
    const printableWidthMm = Math.max(58, 80 - marginMm * 2);
    const pageCss = `
      @page {
        size: 80mm auto;
        margin: ${marginMm}mm;
      }
      @media screen {
        html.adp-preview-frame body {
          padding: 12px;
          background: #f1f5f9;
          display: flex;
          justify-content: center;
        }
      }
    `;
    const extraStyles = `
      .adp-doc .receipt {
        position: relative;
        overflow: hidden;
        width: ${printableWidthMm}mm;
        max-width: 100%;
        background: #ffffff;
        color: #000000;
        font-size: ${baseFontPx}px;
        line-height: 1.38;
        padding: 2mm;
      }
      .adp-doc .receipt > *:not(.invoice-watermark) {
        position: relative;
        z-index: 1;
      }
      .adp-doc .invoice-watermark {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        pointer-events: none;
        user-select: none;
        z-index: 0;
        overflow: hidden;
      }
      .adp-doc .invoice-watermark img {
        width: ${watermarkSize}%;
        max-width: ${watermarkSize}%;
        max-height: ${watermarkSize}%;
        height: auto;
        object-fit: contain;
        opacity: ${watermarkOpacityDecimal};
        -webkit-filter: grayscale(100%) contrast(105%);
        filter: grayscale(100%) contrast(105%);
      }
      @media screen {
        .adp-doc .receipt {
          box-shadow: 0 2px 10px rgba(15, 23, 42, 0.08);
          border: 1px solid #cbd5e1;
          padding: 4mm;
        }
      }
      .adp-doc .center { text-align: center; }
      .adp-doc .dashed-b { border-bottom: 1px dashed #64748b; padding-bottom: 6px; margin-bottom: 6px; }
      .adp-doc .logo { max-height: 38px; max-width: 120px; object-fit: contain; margin: 0 auto 4px; display: block; }
      .adp-doc .shop-name { font-size: ${baseFontPx + 3.5}px; font-weight: 800; margin: 0; color: #000; }
      .adp-doc .muted { font-size: ${Math.max(9, baseFontPx - 1.5)}px; color: #334155; margin: 1px 0; }
      .adp-doc .row { display: flex; justify-content: space-between; align-items: baseline; gap: 6px; margin: 2px 0; }
      .adp-doc .item { padding: 4px 0; border-bottom: 1px dotted #cbd5e1; break-inside: avoid; }
      .adp-doc .item:last-child { border-bottom: none; }
      .adp-doc .item-name { font-weight: 700; color: #000; }
      .adp-doc .item-meta { font-size: ${Math.max(8.5, baseFontPx - 2)}px; color: #334155; }
      .adp-doc .grand { font-size: ${baseFontPx + 2}px; font-weight: 800; border-top: 1px solid #0f172a; padding-top: 4px; margin-top: 4px; }
      .adp-doc .offer-box { background: rgba(248, 250, 252, 0.8); border: 1px solid #cbd5e1; padding: 3px 5px; font-size: ${Math.max(8.5, baseFontPx - 2)}px; margin: 3px 0; }
      .adp-doc .barcode-wrap { width: 52mm; max-width: 100%; margin: 6px auto 4px; }
      .adp-doc .sig-line { margin-top: 16px; border-top: 1px dashed #475569; padding-top: 3px; width: 42mm; margin-left: auto; margin-right: auto; text-align: center; font-size: ${Math.max(8.5, baseFontPx - 2)}px; }
    `;

    const comboThermalRows = comboPackages
      .map(
        (pkg, idx) => `
      <div class="item">
        <div class="item-name">${idx + 1}. [COMBO] ${escapeHtml(pkg.offerName)}</div>
        <div class="item-meta">Includes: ${escapeHtml(
          pkg.components
            .map(c => `${c.totalQty}× ${c.productName}${c.variantDetails ? ` (${c.variantDetails})` : ''}`)
            .join(', ')
        )}</div>
        <div class="row">
          <span class="mono">${pkg.quantity} × ${formatMoney(pkg.offerUnitPrice)}${Number(pkg.discountTotal ?? pkg.discountAmount ?? 0) > 0 ? ` (Saved ${formatMoney(Number(pkg.discountTotal ?? pkg.discountAmount ?? 0))})` : ''}</span>
          <span class="mono" style="font-weight:700;">${formatMoney(pkg.lineTotal)}</span>
        </div>
      </div>`
      )
      .join('');

    const itemsRows = comboThermalRows + regularItems
      .map(
        (item, idx) => `
      <div class="item">
        <div class="item-name">${comboPackages.length + idx + 1}. ${escapeHtml(item.productName)}${item.isFreeItem ? ' [FREE]' : ''}</div>
        <div class="item-meta">
          ${item.sku ? `SKU: ${escapeHtml(item.sku)}` : ''}
          ${item.variantDetails ? `${item.sku ? ' · ' : ''}${escapeHtml(item.variantDetails)}` : ''}
        </div>
        <div class="row">
          <span class="mono">${item.quantity} × ${formatMoney(item.unitPrice)}${item.discount > 0 ? ` (-${formatMoney(item.discount)})` : ''}</span>
          <span class="mono" style="font-weight:700;">${formatMoney(item.total)}</span>
        </div>
      </div>`
      )
      .join('');

    const bodyHtml = `
      <div class="receipt">
        ${showWatermark ? `<div class="invoice-watermark" aria-hidden="true"><img src="${escapeHtml(effectiveLogoUrl)}" alt="" /></div>` : ''}
        <div class="center dashed-b">
          ${showHeaderLogo ? `<img src="${escapeHtml(effectiveLogoUrl)}" alt="${escapeHtml(logoUrl ? biz.shopName : APP_IDENTITY.name)}" class="logo" />` : ''}
          <h1 class="shop-name">${escapeHtml(biz.shopName)}</h1>
          ${biz.tagline ? `<p class="muted">${escapeHtml(biz.tagline)}</p>` : ''}
          ${biz.branchName ? `<p class="muted" style="font-weight:600;">Branch: ${escapeHtml(biz.branchName)}</p>` : ''}
          ${biz.address ? `<p class="muted">${escapeHtml(biz.address)}</p>` : ''}
          <p class="muted">Tel: ${escapeHtml(biz.mobile || '-')}${biz.email ? ` | ${escapeHtml(biz.email)}` : ''}</p>
          ${biz.vatRegistrationNo ? `<p class="muted">VAT/BIN: ${escapeHtml(biz.vatRegistrationNo)}</p>` : ''}
        </div>

        <div class="dashed-b">
          <div class="row"><span>Invoice #:</span><span class="mono" style="font-weight:700;">${escapeHtml(sale.invoiceNumber)}</span></div>
          <div class="row"><span>Date:</span><span>${escapeHtml(formatDate(sale.date, lang))} ${escapeHtml(formatTime(sale.date))}</span></div>
          <div class="row"><span>Customer:</span><span style="font-weight:700;">${escapeHtml(sale.customerName)}</span></div>
          ${sale.customerMobile ? `<div class="row"><span>Mobile:</span><span class="mono">${escapeHtml(sale.customerMobile)}</span></div>` : ''}
          <div class="row"><span>Served By:</span><span>${escapeHtml(sale.sellerName || sale.servedBy || 'Staff')}</span></div>
          <div class="row"><span>Payment:</span><span style="font-weight:600;">${escapeHtml(paymentsSummary)}</span></div>
        </div>

        <div class="dashed-b">
          <div class="row" style="font-weight:700; border-bottom:1px solid #94a3b8; padding-bottom:3px; margin-bottom:2px;">
            <span>Item Details</span>
            <span>Total</span>
          </div>
          ${itemsRows}
        </div>

        <div class="dashed-b">
          <div class="row"><span>Subtotal:</span><span class="mono">${formatMoney(sale.subtotal)}</span></div>
          ${packageSavings > 0 ? `<div class="row" style="font-weight:600;"><span>Combo Savings Included:</span><span class="mono">${formatMoney(packageSavings)}</span></div>` : ''}
          ${comboDiscount > 0 ? `<div class="row" style="font-weight:600;"><span>Bundle/Combo Savings:</span><span class="mono">-${formatMoney(comboDiscount)}</span></div>` : ''}
          ${
            sale.appliedOffers && sale.appliedOffers.length > 0
              ? `<div class="offer-box">Offers: ${escapeHtml(sale.appliedOffers.map(o => o.offerName).join(', '))}</div>`
              : ''
          }
          ${additionalDiscount > 0 ? `<div class="row"><span>Discount:</span><span class="mono">-${formatMoney(additionalDiscount)}</span></div>` : ''}
          ${sale.vatTaxAmount > 0 ? `<div class="row"><span>VAT/Tax (${sale.vatTaxRate}%):</span><span class="mono">+${formatMoney(sale.vatTaxAmount)}</span></div>` : ''}
          <div class="row grand"><span>GRAND TOTAL:</span><span class="mono">${formatMoney(sale.total)}</span></div>
          <div class="row" style="font-weight:600;"><span>Paid (${escapeHtml(sale.paymentMethod.toUpperCase())}):</span><span class="mono">${formatMoney(sale.paid)}</span></div>
          ${sale.due > 0 ? `<div class="row" style="font-weight:800;"><span>DUE AMOUNT:</span><span class="mono">${formatMoney(sale.due)}</span></div>` : ''}
        </div>

        <div class="center">
          <div class="barcode-wrap">${invoiceBarcodeSvg}</div>
          <p class="muted" style="font-weight:600;">Thank you for shopping with us!</p>
          <p class="muted">Exchange/Return within 3 days with invoice &amp; tag.</p>
          <div class="sig-line">Authorized Signature</div>
          <p class="muted" style="margin-top:8px; font-size:8.5px; color:#475569;">Powered by <strong>${escapeHtml(APP_IDENTITY.name)}</strong> · ${escapeHtml(APP_IDENTITY.subtitle)}</p>
        </div>
      </div>
    `;

    return {
      html: buildStandaloneDocument(`Invoice ${sale.invoiceNumber}`, bodyHtml, pageCss, extraStyles),
      paperSize,
      paperInfo: `80mm Thermal Roll (Margin: ${marginMm}mm)`,
      showScaleGuidance: printer.showScaleGuidance,
    };
  }

  // A4 or A5 Invoice Layout
  const isA5 = paperSize === 'a5';
  const orientation = printer.invoiceOrientation || 'portrait';
  const pageSizeKeyword = isA5 ? `A5 ${orientation}` : `A4 ${orientation}`;
  const sheetMargin = Math.max(4, marginMm || (isA5 ? 8 : 12));

  const pageCss = `
    @page {
      size: ${pageSizeKeyword};
      margin: ${sheetMargin}mm;
    }
    @media screen {
      html.adp-preview-frame body {
        padding: 16px;
        background: #f1f5f9;
        display: flex;
        justify-content: center;
      }
    }
  `;

  const containerWidth = isA5
    ? orientation === 'landscape'
      ? '190mm'
      : '132mm'
    : orientation === 'landscape'
    ? '270mm'
    : '186mm';

  const extraStyles = `
    .adp-doc .invoice-sheet {
      position: relative;
      overflow: hidden;
      width: 100%;
      max-width: ${containerWidth};
      background: #ffffff;
      color: #0f172a;
      font-size: ${isA5 ? Math.max(9.5, baseFontPx - 1) : baseFontPx}px;
      line-height: 1.45;
      padding: ${isA5 ? '5mm' : '8mm'};
    }
    .adp-doc .invoice-sheet > *:not(.invoice-watermark) {
      position: relative;
      z-index: 1;
    }
    .adp-doc .invoice-watermark {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      pointer-events: none;
      user-select: none;
      z-index: 0;
      overflow: hidden;
    }
    .adp-doc .invoice-watermark img {
      width: ${watermarkSize}%;
      max-width: ${watermarkSize}%;
      max-height: ${watermarkSize}%;
      height: auto;
      object-fit: contain;
      opacity: ${watermarkOpacityDecimal};
      -webkit-filter: grayscale(100%) contrast(105%);
      filter: grayscale(100%) contrast(105%);
    }
    @media screen {
      .adp-doc .invoice-sheet {
        border: 1px solid #cbd5e1;
        box-shadow: 0 4px 18px rgba(15, 23, 42, 0.08);
        border-radius: 6px;
      }
    }
    .adp-doc .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 16px;
      padding-bottom: 12px;
      border-bottom: 2px solid #101B3F;
    }
    .adp-doc .brand { display: flex; gap: 12px; align-items: flex-start; }
    .adp-doc .logo { max-height: ${isA5 ? 42 : 56}px; max-width: ${isA5 ? 110 : 150}px; object-fit: contain; }
    .adp-doc .shop-title { font-size: ${isA5 ? baseFontPx + 5 : baseFontPx + 8}px; font-weight: 800; margin: 0; color: #101B3F; }
    .adp-doc .sub { color: #475569; margin: 2px 0; font-size: ${isA5 ? 10 : 11}px; }
    .adp-doc .inv-badge {
      display: inline-block;
      padding: 3px 10px;
      background: #101B3F;
      color: #ffffff;
      border-bottom: 2px solid #FF9D32;
      font-weight: 800;
      letter-spacing: 0.08em;
      border-radius: 4px;
      font-size: ${isA5 ? 10 : 11}px;
    }
    .adp-doc .meta-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 14px;
      padding: 10px 0;
      border-bottom: 1px solid #cbd5e1;
    }
    .adp-doc .meta-label {
      font-size: 9.5px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: #64748b;
      margin-bottom: 2px;
    }
    .adp-doc table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 12px;
    }
    .adp-doc th {
      background: rgba(248, 250, 252, 0.85);
      color: #334155;
      font-weight: 700;
      font-size: ${isA5 ? 10 : 11}px;
      text-align: left;
      padding: 7px 8px;
      border-top: 1px solid #cbd5e1;
      border-bottom: 1px solid #94a3b8;
    }
    .adp-doc td {
      padding: 7px 8px;
      border-bottom: 1px solid #e2e8f0;
      vertical-align: top;
    }
    .adp-doc tr { break-inside: avoid; page-break-inside: avoid; }
    .adp-doc .num { text-align: right; }
    .adp-doc .ctr { text-align: center; }
    .adp-doc .summary-row {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 20px;
      margin-top: 14px;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .adp-doc .totals-box {
      width: ${isA5 ? '210px' : '260px'};
      margin-left: auto;
      border: 1px solid #cbd5e1;
      border-radius: 6px;
      padding: 10px 12px;
      background: rgba(248, 250, 252, 0.82);
    }
    .adp-doc .t-line { display: flex; justify-content: space-between; margin: 4px 0; }
    .adp-doc .t-grand {
      display: flex;
      justify-content: space-between;
      border-top: 2px solid #0f172a;
      margin-top: 6px;
      padding-top: 6px;
      font-size: ${isA5 ? baseFontPx + 2 : baseFontPx + 3}px;
      font-weight: 800;
    }
    .adp-doc .footer-sign {
      margin-top: ${isA5 ? '26px' : '40px'};
      padding-top: 10px;
      border-top: 1px solid #e2e8f0;
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      gap: 16px;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .adp-doc .sig-box {
      width: 150px;
      text-align: center;
      border-top: 1px solid #475569;
      padding-top: 4px;
      font-size: 10.5px;
      color: #334155;
      font-weight: 600;
    }
  `;

  const comboTableRows = comboPackages
    .map(
      (pkg, idx) => `
    <tr style="background:rgba(240, 253, 244, 0.78);">
      <td class="ctr mono">${idx + 1}</td>
      <td>
        <div style="font-weight:700; color:#0f172a;"><span style="font-size:9px;background:#059669;color:#ffffff;padding:1px 5px;border-radius:3px;margin-right:4px;">COMBO</span>${escapeHtml(pkg.offerName)}</div>
        <div style="font-size:10px;color:#475569;margin-top:2px;">
          Includes: ${escapeHtml(
            pkg.components
              .map(c => `${c.totalQty}× ${c.productName}${c.variantDetails ? ` (${c.variantDetails})` : ''}`)
              .join(', ')
          )}
        </div>
      </td>
      <td class="ctr mono">${pkg.quantity}</td>
      <td class="num mono">${formatMoney(pkg.offerUnitPrice)}</td>
      <td class="num mono" style="color:#047857;">${Number(pkg.discountTotal ?? pkg.discountAmount ?? 0) > 0 ? `Saved ${formatMoney(Number(pkg.discountTotal ?? pkg.discountAmount ?? 0))}` : '—'}</td>
      <td class="num mono" style="font-weight:700;">${formatMoney(pkg.lineTotal)}</td>
    </tr>`
    )
    .join('');

  const tableRows = comboTableRows + regularItems
    .map(
      (item, idx) => `
    <tr>
      <td class="ctr mono">${comboPackages.length + idx + 1}</td>
      <td>
        <div style="font-weight:700; color:#0f172a;">${escapeHtml(item.productName)}${item.isFreeItem ? ' <span style="font-size:9px;background:#dcfce7;color:#166534;padding:1px 4px;border-radius:3px;">FREE</span>' : ''}</div>
        <div style="font-size:10px;color:#475569;">
          ${item.sku ? `<span class="mono">SKU: ${escapeHtml(item.sku)}</span>` : ''}
          ${item.variantDetails ? `${item.sku ? ' · ' : ''}<span>${escapeHtml(item.variantDetails)}</span>` : ''}
        </div>
      </td>
      <td class="ctr mono">${item.quantity}</td>
      <td class="num mono">${formatMoney(item.unitPrice)}</td>
      <td class="num mono">${item.discount > 0 ? `-${formatMoney(item.discount)}` : '—'}</td>
      <td class="num mono" style="font-weight:700;">${formatMoney(item.total)}</td>
    </tr>`
    )
    .join('');

  const bodyHtml = `
    <div class="invoice-sheet">
      ${showWatermark ? `<div class="invoice-watermark" aria-hidden="true"><img src="${escapeHtml(effectiveLogoUrl)}" alt="" /></div>` : ''}
      <div class="header">
        <div class="brand">
          ${showHeaderLogo ? `<img src="${escapeHtml(effectiveLogoUrl)}" alt="${escapeHtml(logoUrl ? biz.shopName : APP_IDENTITY.name)}" class="logo" />` : ''}
          <div>
            <h1 class="shop-title">${escapeHtml(biz.shopName)}</h1>
            ${biz.tagline ? `<p class="sub">${escapeHtml(biz.tagline)}</p>` : ''}
            ${biz.branchName ? `<p class="sub" style="font-weight:600;">Branch: ${escapeHtml(biz.branchName)}</p>` : ''}
            ${biz.address ? `<p class="sub">${escapeHtml(biz.address)}</p>` : ''}
            <p class="sub">Phone: ${escapeHtml(biz.mobile || '-')}${biz.email ? ` | Email: ${escapeHtml(biz.email)}` : ''}</p>
            ${biz.vatRegistrationNo ? `<p class="sub">VAT / BIN: ${escapeHtml(biz.vatRegistrationNo)}</p>` : ''}
          </div>
        </div>
        <div style="text-align:right;">
          <span class="inv-badge">INVOICE · ${statusLabel}</span>
          <div class="mono" style="font-weight:800; font-size:${isA5 ? 12 : 14}px; margin-top:6px;">${escapeHtml(sale.invoiceNumber)}</div>
          <div class="sub">${escapeHtml(formatDate(sale.date, lang))} · ${escapeHtml(formatTime(sale.date))}</div>
          <div class="sub">Served By: ${escapeHtml(sale.sellerName || sale.servedBy || 'Staff')}</div>
        </div>
      </div>

      <div class="meta-grid">
        <div>
          <div class="meta-label">Bill To (Customer)</div>
          <div style="font-weight:700; font-size:${isA5 ? 12 : 13}px;">${escapeHtml(sale.customerName)}</div>
          ${sale.customerMobile ? `<div class="sub mono">Mobile: ${escapeHtml(sale.customerMobile)}</div>` : ''}
        </div>
        <div style="text-align:right;">
          <div class="meta-label">Payment Details</div>
          <div style="font-weight:700;">${escapeHtml(paymentsSummary)}</div>
          ${sale.notes ? `<div class="sub">Note: ${escapeHtml(sale.notes)}</div>` : ''}
        </div>
      </div>

      <table>
        <thead>
          <tr>
            <th class="ctr" style="width:32px;">SL</th>
            <th>Product &amp; SKU / Variant</th>
            <th class="ctr" style="width:46px;">Qty</th>
            <th class="num" style="width:76px;">Unit Price</th>
            <th class="num" style="width:68px;">Discount</th>
            <th class="num" style="width:86px;">Total</th>
          </tr>
        </thead>
        <tbody>
          ${tableRows}
        </tbody>
      </table>

      <div class="summary-row">
        <div style="flex:1; max-width:220px;">
          <div style="width:165px; margin-bottom:6px;">${invoiceBarcodeSvg}</div>
          ${
            sale.appliedOffers && sale.appliedOffers.length > 0
              ? `<div style="font-size:10px;background:#f5f3ff;border:1px solid #ddd6fe;color:#5b21b6;padding:4px 8px;border-radius:4px;margin-top:4px;">Applied Offers: ${escapeHtml(sale.appliedOffers.map(o => o.offerName).join(', '))}</div>`
              : ''
          }
        </div>

        <div class="totals-box">
          <div class="t-line"><span>Subtotal:</span><span class="mono">${formatMoney(sale.subtotal)}</span></div>
          ${packageSavings > 0 ? `<div class="t-line" style="color:#047857;font-weight:600;"><span>Combo Savings Included:</span><span class="mono">${formatMoney(packageSavings)}</span></div>` : ''}
          ${comboDiscount > 0 ? `<div class="t-line" style="color:#6d28d9;font-weight:600;"><span>Bundle/Combo Savings:</span><span class="mono">-${formatMoney(comboDiscount)}</span></div>` : ''}
          ${additionalDiscount > 0 ? `<div class="t-line" style="color:#047857;"><span>Discount:</span><span class="mono">-${formatMoney(additionalDiscount)}</span></div>` : ''}
          ${sale.vatTaxAmount > 0 ? `<div class="t-line"><span>VAT/Tax (${sale.vatTaxRate}%):</span><span class="mono">+${formatMoney(sale.vatTaxAmount)}</span></div>` : ''}
          <div class="t-grand"><span>Grand Total:</span><span class="mono">${formatMoney(sale.total)}</span></div>
          <div class="t-line" style="font-weight:600;color:#065f46;"><span>Paid Amount:</span><span class="mono">${formatMoney(sale.paid)}</span></div>
          ${sale.due > 0 ? `<div class="t-line" style="font-weight:800;color:#be123c;"><span>Due Balance:</span><span class="mono">${formatMoney(sale.due)}</span></div>` : ''}
        </div>
      </div>

      <div class="footer-sign">
        <div class="sub" style="max-width:60%;">
          <div style="font-weight:700; color:#101B3F;">Terms &amp; Return Policy</div>
          <div>For exchange or return, please present this original invoice with intact barcode tag within 3 days.</div>
        </div>
        <div style="display:flex; gap:24px;">
          <div class="sig-box">Customer Signature</div>
          <div class="sig-box">Authorized Signature</div>
        </div>
      </div>
      <div style="margin-top:14px; padding-top:8px; border-top:1px solid #e2e8f0; display:flex; justify-content:space-between; font-size:9.5px; color:#64748b;">
        <span>Powered by <strong style="color:#101B3F;">${escapeHtml(APP_IDENTITY.name)}</strong></span>
        <span>${escapeHtml(APP_IDENTITY.subtitle)}</span>
      </div>
    </div>
  `;

  return {
    html: buildStandaloneDocument(`Invoice ${sale.invoiceNumber}`, bodyHtml, pageCss, extraStyles),
    paperSize,
    paperInfo: `${isA5 ? 'A5' : 'A4'} ${orientation === 'landscape' ? 'Landscape' : 'Portrait'} (Margin: ${sheetMargin}mm)`,
    showScaleGuidance: printer.showScaleGuidance,
  };
}

export function resolveLabelDimensionsMm(
  template: LabelTemplateId,
  customWidthMm?: number,
  customHeightMm?: number
): { widthMm: number; heightMm: number; isA4Sheet: boolean } {
  switch (template) {
    case '30x20':
      return { widthMm: 30, heightMm: 20, isA4Sheet: false };
    case '40x30':
      return { widthMm: 40, heightMm: 30, isA4Sheet: false };
    case '50x25':
      return { widthMm: 50, heightMm: 25, isA4Sheet: false };
    case '50x30':
      return { widthMm: 50, heightMm: 30, isA4Sheet: false };
    case 'a4_sheet':
      return { widthMm: customWidthMm || 62, heightMm: customHeightMm || 34, isA4Sheet: true };
    case 'custom':
    default:
      return {
        widthMm: Math.max(20, Math.min(120, customWidthMm || 40)),
        heightMm: Math.max(15, Math.min(120, customHeightMm || 30)),
        isA4Sheet: false,
      };
  }
}

interface LabelBuildContext {
  printer: PrinterSettings;
  dim: { widthMm: number; heightMm: number; isA4Sheet: boolean };
  labelW: number;
  labelH: number;
  isCompact: boolean;
  barcodeHeight: number;
  logoUrl: string;
  currency: string;
  shopName: string;
  configSignature: string;
  pageCss: string;
  extraStyles: string;
  paperInfoTemplate: (totalLabels: number) => string;
}

function createLabelBuildContext(
  config: LabelConfig,
  settings: ShopSettings,
  printerOverride?: Partial<PrinterSettings>
): LabelBuildContext {
  const printer = { ...getPrinterSettings(settings), ...(printerOverride || {}) };
  const dim = resolveLabelDimensionsMm(
    config.template,
    config.customWidthMm ?? printer.labelWidthMm,
    config.customHeightMm ?? printer.labelHeightMm
  );
  const logoUrl = config.showShopLogo ? getShopLogo(settings) : '';
  const currency = settings.currency || '৳';
  const shopName = getBusinessDisplayName(settings, 'My Shop');

  const orientation = printer.labelOrientation || 'portrait';
  const rawW = dim.widthMm;
  const rawH = dim.heightMm;
  const labelW =
    !dim.isA4Sheet && orientation === 'portrait' && rawW > rawH
      ? rawW
      : !dim.isA4Sheet && orientation === 'landscape' && rawH > rawW
      ? rawH
      : rawW;
  const labelH =
    !dim.isA4Sheet && orientation === 'portrait' && rawW > rawH
      ? rawH
      : !dim.isA4Sheet && orientation === 'landscape' && rawH > rawW
      ? rawW
      : rawH;

  const isCompact = labelH <= 22 || labelW <= 34;
  const fontDelta = printer.labelFontSize === 'small' ? -1 : printer.labelFontSize === 'large' ? 1 : 0;
  const shopFontPx = Math.max(6.5, (isCompact ? 7 : 8.5) + fontDelta);
  const nameFontPx = Math.max(7, (isCompact ? 8 : 9.5) + fontDelta);
  const metaFontPx = Math.max(6.5, (isCompact ? 7 : 8) + fontDelta);
  const priceFontPx = isCompact ? Math.max(12, 14 + fontDelta) : 19 + fontDelta;

  const barcodeHeight = Math.max(
    14,
    Math.min(
      dim.isA4Sheet ? 44 : Math.round(labelH * 1.15),
      Number(printer.barcodeHeightPx || (labelH <= 22 ? 18 : 26))
    )
  );
  const labelPadMm = Math.max(0.8, Math.min(5, Number(printer.labelMarginMm ?? (isCompact ? 1.2 : 1.8))));

  const configSignature = [
    labelW,
    labelH,
    barcodeHeight,
    config.barcodeFormat,
    config.showQrCode ? 1 : 0,
    config.qrContentMode || 'product_ref',
    config.showShopName ? 1 : 0,
    config.showShopLogo ? 1 : 0,
    config.showProductName ? 1 : 0,
    config.showVariantDetails ? 1 : 0,
    config.showPrice ? 1 : 0,
    config.showSku ? 1 : 0,
    config.showBarcodeNumber ? 1 : 0,
    config.customFooterText || '',
    priceFontPx,
    shopName,
    logoUrl ? logoUrl.slice(0, 40) : '',
    currency,
    isCompact ? 1 : 0,
  ].join('|');

  if (dim.isA4Sheet) {
    const sheetMarginMm = Math.max(3, Math.min(20, Number(printer.labelMarginMm ?? 6)));
    const cols = Math.max(1, Math.min(6, Number(printer.labelsPerRow || 3)));
    const gapX = Math.max(0, Math.min(15, Number(printer.labelGapXMm ?? 3)));
    const gapY = Math.max(0, Math.min(15, Number(printer.labelGapYMm ?? 3)));

    const pageCss = `
      @page {
        size: A4 portrait;
        margin: ${sheetMarginMm}mm;
      }
      @media screen {
        html.adp-preview-frame body {
          padding: 14px;
          background: #f1f5f9;
          display: flex;
          justify-content: center;
        }
      }
    `;
    const extraStyles = `
      .adp-doc .sheet-grid {
        display: grid;
        grid-template-columns: repeat(${cols}, ${labelW}mm);
        column-gap: ${gapX}mm;
        row-gap: ${gapY}mm;
        justify-content: start;
        background: #ffffff;
      }
      @media screen {
        .adp-doc .sheet-grid {
          padding: ${sheetMarginMm}mm;
          border: 1px solid #cbd5e1;
          box-shadow: 0 4px 16px rgba(15, 23, 42, 0.08);
        }
      }
      .adp-doc .label-card {
        width: ${labelW}mm;
        height: ${labelH}mm;
        padding: 1.8mm;
        border: 0.3mm solid #94a3b8;
        border-radius: 1mm;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        align-items: center;
        text-align: center;
        overflow: hidden;
        background: #ffffff;
        break-inside: avoid;
        page-break-inside: avoid;
      }
      .adp-doc .label-top { width: 100%; overflow: hidden; }
      .adp-doc .label-shop { display: flex; align-items: center; justify-content: center; gap: 3px; font-size: ${shopFontPx}px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.04em; line-height: 1.1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .adp-doc .label-logo { max-height: 10px; max-width: 24px; object-fit: contain; }
      .adp-doc .label-name { font-size: ${nameFontPx}px; font-weight: 700; color: #000; line-height: 1.15; display: -webkit-box; -webkit-line-clamp: 1; -webkit-box-orient: vertical; overflow: hidden; margin-top: 1px; }
      .adp-doc .label-variant { display: inline-block; font-size: ${metaFontPx}px; font-weight: 700; background: #f1f5f9; border: 0.2mm solid #cbd5e1; border-radius: 2px; padding: 0 3px; line-height: 1.2; margin-top: 1px; max-width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .adp-doc .label-barcode { width: 100%; flex: 1; min-height: 0; display: flex; align-items: center; justify-content: center; padding: 1px 0; overflow: hidden; }
      .adp-doc .label-bottom { width: 100%; flex-shrink: 0; }
      .adp-doc .label-meta-row { width: 100%; display: flex; align-items: flex-end; justify-content: space-between; gap: 4px; line-height: 1; padding-top: 1px; }
      .adp-doc .label-sku { flex: 1 1 auto; min-width: 0; text-align: left; font-size: ${metaFontPx - 0.5}px; color: #334155; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 1.15; }
      .adp-doc .label-price { flex-shrink: 0; font-size: ${priceFontPx}px; font-weight: 900; color: #000000; white-space: nowrap; line-height: 0.95; letter-spacing: -0.02em; text-align: right; }
      .adp-doc .label-footer { font-size: 6.5px; color: #64748b; line-height: 1.05; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 1px; }
    `;

    return {
      printer,
      dim,
      labelW,
      labelH,
      isCompact,
      barcodeHeight,
      logoUrl,
      currency,
      shopName,
      configSignature,
      pageCss,
      extraStyles,
      paperInfoTemplate: total => `A4 Sheet Grid · ${cols} columns × ${labelW}×${labelH}mm (${total} labels)`,
    };
  }

  const pageCss = `
    @page {
      size: ${labelW}mm ${labelH}mm;
      margin: 0;
    }
    @media screen {
      html.adp-preview-frame body {
        padding: 14px;
        background: #f1f5f9;
        display: flex;
        flex-direction: column;
        align-items: center;
      }
      .adp-doc {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 10px;
      }
    }
  `;
  const extraStyles = `
    .adp-doc .label-card {
      width: ${labelW}mm;
      height: ${labelH}mm;
      padding: ${labelPadMm}mm;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      align-items: center;
      text-align: center;
      overflow: hidden;
      background: #ffffff;
      color: #000000;
      break-inside: avoid;
      page-break-inside: avoid;
      page-break-after: always;
      break-after: page;
    }
    .adp-doc .label-card:last-child {
      page-break-after: auto;
      break-after: auto;
    }
    @media screen {
      .adp-doc .label-card {
        border: 1px dashed #64748b;
        box-shadow: 0 2px 6px rgba(15, 23, 42, 0.08);
      }
    }
    .adp-doc .label-top { width: 100%; overflow: hidden; }
    .adp-doc .label-shop { display: flex; align-items: center; justify-content: center; gap: 2px; font-size: ${shopFontPx}px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.03em; line-height: 1.05; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .adp-doc .label-logo { max-height: 9px; max-width: 20px; object-fit: contain; }
    .adp-doc .label-name { font-size: ${nameFontPx}px; font-weight: 700; color: #000; line-height: 1.1; display: -webkit-box; -webkit-line-clamp: 1; -webkit-box-orient: vertical; overflow: hidden; margin-top: 0.5px; }
    .adp-doc .label-variant { display: inline-block; font-size: ${metaFontPx}px; font-weight: 700; border: 0.2mm solid #94a3b8; border-radius: 1.5px; padding: 0 2.5px; line-height: 1.15; margin-top: 0.5px; max-width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .adp-doc .label-barcode { width: 100%; flex: 1; min-height: 0; display: flex; align-items: center; justify-content: center; overflow: hidden; padding: 0.5px 0; }
    .adp-doc .label-bottom { width: 100%; flex-shrink: 0; }
    .adp-doc .label-meta-row { width: 100%; display: flex; align-items: flex-end; justify-content: space-between; gap: 4px; line-height: 1; padding-top: 1px; }
    .adp-doc .label-sku { flex: 1 1 auto; min-width: 0; text-align: left; font-size: ${metaFontPx - 0.5}px; color: #1e293b; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 1.15; }
    .adp-doc .label-price { flex-shrink: 0; font-size: ${priceFontPx}px; font-weight: 900; color: #000000; white-space: nowrap; line-height: 0.95; letter-spacing: -0.02em; text-align: right; }
    .adp-doc .label-footer { font-size: 6px; color: #475569; line-height: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 0.5px; }
  `;

  return {
    printer,
    dim,
    labelW,
    labelH,
    isCompact,
    barcodeHeight,
    logoUrl,
    currency,
    shopName,
    configSignature,
    pageCss,
    extraStyles,
    paperInfoTemplate: total => `Thermal Label Roll · ${labelW}mm × ${labelH}mm (${total} labels)`,
  };
}

function renderSingleLabelCardHtml(
  item: PrintLabelItem,
  config: LabelConfig,
  ctx: LabelBuildContext
): string {
  const barcodeValue = (item.barcode || item.sku || '000000').trim();
  const qrPayload =
    config.qrContentMode === 'barcode'
      ? barcodeValue
      : buildProductQrPayload(item.productId, item.variantId, barcodeValue);
  const itemCacheKey = `${ctx.configSignature}|${item.productId}|${item.variantId || ''}|${item.productName}|${item.variantDetails || ''}|${item.sku}|${barcodeValue}|${item.price}`;
  const cachedCard = labelCardHtmlCache.get(itemCacheKey);
  if (cachedCard) {
    return cachedCard;
  }

  let codeBlockHtml = '';
  if (config.barcodeFormat === 'QR') {
    const qrSvg = generateQrSvgMarkup(qrPayload, {
      size: Math.max(44, Math.min(96, Math.round(ctx.labelH * 2.2))),
      quietModules: 2,
      showText: config.showBarcodeNumber,
      caption: barcodeValue,
      fontSize: ctx.isCompact ? 8 : 9.5,
    });
    codeBlockHtml = `<div style="height:100%;max-height:100%;aspect-ratio:1/1;display:flex;align-items:center;justify-content:center;margin:0 auto;">${qrSvg}</div>`;
  } else {
    const barcodeSvg = generateBarcodeSvgMarkup(barcodeValue, {
      width: Math.round(ctx.labelW * (config.showQrCode ? 3.2 : 4.6)),
      height: ctx.barcodeHeight,
      showText: config.showBarcodeNumber,
      format: config.barcodeFormat === 'EAN13' ? 'EAN13' : 'CODE128',
      fontSize: ctx.isCompact ? 9 : 10.5,
    });
    if (config.showQrCode) {
      const qrSvg = generateQrSvgMarkup(qrPayload, {
        size: Math.max(36, Math.round(ctx.barcodeHeight * 1.15)),
        quietModules: 1,
        showText: false,
      });
      codeBlockHtml = `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:space-between;gap:1.5mm;"><div style="flex:1;min-width:0;height:100%;display:flex;align-items:center;justify-content:center;">${barcodeSvg}</div><div style="height:92%;aspect-ratio:1/1;flex-shrink:0;display:flex;align-items:center;justify-content:center;">${qrSvg}</div></div>`;
    } else {
      codeBlockHtml = barcodeSvg;
    }
  }

  const formattedPrice = formatCurrency(item.price, 'en').replace('৳', ctx.currency);

  const cardHtml = `<div class="label-card"><div class="label-top">${
    config.showShopName || ctx.logoUrl
      ? `<div class="label-shop">${ctx.logoUrl ? `<img src="${escapeHtml(ctx.logoUrl)}" alt="" class="label-logo" />` : ''}${config.showShopName ? `<span>${escapeHtml(ctx.shopName)}</span>` : ''}</div>`
      : ''
  }${config.showProductName ? `<div class="label-name">${escapeHtml(item.productName)}</div>` : ''}${
    config.showVariantDetails && item.variantDetails
      ? `<div class="label-variant">${escapeHtml(item.variantDetails)}</div>`
      : ''
  }</div><div class="label-barcode">${codeBlockHtml}</div><div class="label-bottom"><div class="label-meta-row">${
    config.showSku ? `<span class="label-sku mono">${escapeHtml(item.sku)}</span>` : '<span></span>'
  }${config.showPrice ? `<span class="label-price mono">${escapeHtml(formattedPrice)}</span>` : ''}</div>${
    config.customFooterText ? `<div class="label-footer">${escapeHtml(config.customFooterText)}</div>` : ''
  }</div></div>`;

  setBoundedCardCache(itemCacheKey, cardHtml);
  return cardHtml;
}

export function buildLabelsHtml(
  items: PrintLabelItem[],
  config: LabelConfig,
  settings: ShopSettings,
  printerOverride?: Partial<PrinterSettings>
): { html: string; totalLabels: number; paperInfo: string; showScaleGuidance: boolean } {
  const ctx = createLabelBuildContext(config, settings, printerOverride);
  const expandedCards: string[] = [];
  let totalLabels = 0;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const copies = Math.max(1, Math.min(500, Math.floor(item.copies || 1)));
    const cardHtml = renderSingleLabelCardHtml(item, config, ctx);
    for (let c = 0; c < copies; c++) {
      expandedCards.push(cardHtml);
      totalLabels++;
    }
  }

  const bodyHtml = ctx.dim.isA4Sheet
    ? `<div class="sheet-grid">${expandedCards.join('')}</div>`
    : expandedCards.join('');

  return {
    html: buildStandaloneDocument(
      ctx.dim.isA4Sheet ? `Barcode Labels (${totalLabels})` : `Thermal Labels (${totalLabels})`,
      bodyHtml,
      ctx.pageCss,
      ctx.extraStyles
    ),
    totalLabels,
    paperInfo: ctx.paperInfoTemplate(totalLabels),
    showScaleGuidance: ctx.printer.showScaleGuidance,
  };
}

function yieldToMainThread(): Promise<void> {
  return new Promise(resolve => {
    window.setTimeout(resolve, 0);
  });
}

export async function buildLabelsHtmlAsync(
  items: PrintLabelItem[],
  config: LabelConfig,
  settings: ShopSettings,
  options?: {
    printerOverride?: Partial<PrinterSettings>;
    signal?: AbortSignal;
    onProgress?: (done: number, total: number) => void;
  }
): Promise<{ html: string; totalLabels: number; paperInfo: string; showScaleGuidance: boolean }> {
  const signal = options?.signal;
  if (signal?.aborted) {
    throw new DOMException('Label preview generation was cancelled.', 'AbortError');
  }

  const ctx = createLabelBuildContext(config, settings, options?.printerOverride);
  const totalCopies = items.reduce(
    (sum, item) => sum + Math.max(1, Math.min(500, Math.floor(item.copies || 1))),
    0
  );

  const expandedCards: string[] = [];
  let totalLabels = 0;
  const CHUNK_UNIQUE_ITEMS = 25;

  for (let i = 0; i < items.length; i++) {
    if (signal?.aborted) {
      throw new DOMException('Label preview generation was cancelled.', 'AbortError');
    }

    const item = items[i];
    const copies = Math.max(1, Math.min(500, Math.floor(item.copies || 1)));
    const cardHtml = renderSingleLabelCardHtml(item, config, ctx);

    for (let c = 0; c < copies; c++) {
      expandedCards.push(cardHtml);
      totalLabels++;
    }

    options?.onProgress?.(totalLabels, totalCopies);

    if ((i + 1) % CHUNK_UNIQUE_ITEMS === 0 && i + 1 < items.length) {
      await yieldToMainThread();
    }
  }

  if (signal?.aborted) {
    throw new DOMException('Label preview generation was cancelled.', 'AbortError');
  }

  const bodyHtml = ctx.dim.isA4Sheet
    ? `<div class="sheet-grid">${expandedCards.join('')}</div>`
    : expandedCards.join('');

  return {
    html: buildStandaloneDocument(
      ctx.dim.isA4Sheet ? `Barcode Labels (${totalLabels})` : `Thermal Labels (${totalLabels})`,
      bodyHtml,
      ctx.pageCss,
      ctx.extraStyles
    ),
    totalLabels,
    paperInfo: ctx.paperInfoTemplate(totalLabels),
    showScaleGuidance: ctx.printer.showScaleGuidance,
  };
}

function scopeCssSelectorList(selectorText: string, rootSelector: string): string {
  return selectorText
    .split(',')
    .map(part => {
      const s = part.trim();
      if (!s) return '';
      if (s === '*' || s === ':root') {
        return `${rootSelector}, ${rootSelector} *`;
      }
      if (/^(html|body)(\.[a-zA-Z0-9_-]+)?(\s*,\s*(html|body)(\.[a-zA-Z0-9_-]+)?)*$/i.test(s)) {
        return rootSelector;
      }
      if (/^(html|body)(\.[a-zA-Z0-9_-]+)?\s+/i.test(s)) {
        return s.replace(/^(html|body)(\.[a-zA-Z0-9_-]+)?\s+(?:(html|body)(\.[a-zA-Z0-9_-]+)?\s+)*/i, `${rootSelector} `);
      }
      if (s.startsWith(rootSelector)) return s;
      return `${rootSelector} ${s}`;
    })
    .filter(Boolean)
    .join(', ');
}

function scopeCssRuleBlock(cssBody: string, rootSelector: string): string {
  const output: string[] = [];
  let i = 0;
  const len = cssBody.length;

  while (i < len) {
    while (i < len && /\s/.test(cssBody[i])) i++;
    if (i >= len) break;

    if (cssBody[i] === '/' && cssBody[i + 1] === '*') {
      const commentEnd = cssBody.indexOf('*/', i + 2);
      if (commentEnd === -1) break;
      i = commentEnd + 2;
      continue;
    }

    const braceStart = cssBody.indexOf('{', i);
    const semiIdx = cssBody.indexOf(';', i);
    if (semiIdx !== -1 && (braceStart === -1 || semiIdx < braceStart)) {
      const stmt = cssBody.slice(i, semiIdx + 1).trim();
      if (stmt.startsWith('@import') || stmt.startsWith('@charset')) {
        output.push(stmt);
      }
      i = semiIdx + 1;
      continue;
    }
    if (braceStart === -1) break;

    const prelude = cssBody.slice(i, braceStart).trim();
    let depth = 1;
    let j = braceStart + 1;
    while (j < len && depth > 0) {
      if (cssBody[j] === '{') depth++;
      else if (cssBody[j] === '}') depth--;
      j++;
    }
    const inner = cssBody.slice(braceStart + 1, j - 1);
    i = j;

    if (prelude.startsWith('@')) {
      const lower = prelude.toLowerCase();
      if (lower.startsWith('@page') || lower.startsWith('@font-face') || lower.includes('keyframes')) {
        output.push(`${prelude} {${inner}}`);
      } else if (lower.startsWith('@media')) {
        if (!lower.includes('screen') || lower.includes('print')) {
          const scopedInner = scopeCssRuleBlock(inner, rootSelector);
          if (scopedInner.trim()) {
            output.push(`${prelude} {\n${scopedInner}\n}`);
          }
        }
      }
    } else {
      const scopedSelector = scopeCssSelectorList(prelude, rootSelector);
      if (scopedSelector) {
        output.push(`${scopedSelector} {${inner}}`);
      }
    }
  }

  return output.join('\n');
}

/**
 * Converts arbitrary standalone document CSS into strictly @media print + #root-scoped CSS
 * so host screen layout (html, body, #root) can never be altered even if fallback mode runs.
 */
export function scopeFallbackPrintCss(rawCss: string, rootId: string = PRINT_ROOT_ID): string {
  const rootSelector = `#${rootId}`;
  const topLevelMediaOrPage: string[] = [];
  const printScopedRules: string[] = [];

  let i = 0;
  const len = rawCss.length;
  while (i < len) {
    while (i < len && /\s/.test(rawCss[i])) i++;
    if (i >= len) break;

    if (rawCss[i] === '/' && rawCss[i + 1] === '*') {
      const commentEnd = rawCss.indexOf('*/', i + 2);
      if (commentEnd === -1) break;
      i = commentEnd + 2;
      continue;
    }

    const braceStart = rawCss.indexOf('{', i);
    const semiIdx = rawCss.indexOf(';', i);
    if (semiIdx !== -1 && (braceStart === -1 || semiIdx < braceStart)) {
      const stmt = rawCss.slice(i, semiIdx + 1).trim();
      if (stmt.startsWith('@import') || stmt.startsWith('@charset')) {
        topLevelMediaOrPage.push(stmt);
      }
      i = semiIdx + 1;
      continue;
    }
    if (braceStart === -1) break;

    const prelude = rawCss.slice(i, braceStart).trim();
    let depth = 1;
    let j = braceStart + 1;
    while (j < len && depth > 0) {
      if (rawCss[j] === '{') depth++;
      else if (rawCss[j] === '}') depth--;
      j++;
    }
    const inner = rawCss.slice(braceStart + 1, j - 1);
    i = j;

    if (prelude.startsWith('@')) {
      const lower = prelude.toLowerCase();
      if (lower.startsWith('@page') || lower.startsWith('@font-face') || lower.includes('keyframes')) {
        topLevelMediaOrPage.push(`${prelude} {${inner}}`);
      } else if (lower.startsWith('@media')) {
        if (!lower.includes('screen') || lower.includes('print')) {
          const scopedInner = scopeCssRuleBlock(inner, rootSelector);
          if (scopedInner.trim()) {
            topLevelMediaOrPage.push(`@media print {\n${scopedInner}\n}`);
          }
        }
      }
    } else {
      const scopedSelector = scopeCssSelectorList(prelude, rootSelector);
      if (scopedSelector) {
        printScopedRules.push(`${scopedSelector} {${inner}}`);
      }
    }
  }

  return [
    ...topLevelMediaOrPage,
    printScopedRules.length > 0 ? `@media print {\n${printScopedRules.join('\n')}\n}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

function registerPrintLifecycleCleanup(
  jobToken: number,
  iframeWin?: Window | null
): void {
  if (typeof window === 'undefined') return;

  const finishIfCurrent = () => {
    if (jobToken !== activePrintToken) return;
    cleanupPrintPortal();
  };

  let focusCheckTimer: number | null = null;
  const clearFocusTimer = () => {
    if (focusCheckTimer !== null) {
      window.clearTimeout(focusCheckTimer);
      focusCheckTimer = null;
    }
  };

  const onAfterPrint = () => {
    finishIfCurrent();
  };

  const onWindowFocus = () => {
    clearFocusTimer();
    focusCheckTimer = window.setTimeout(() => {
      if (jobToken !== activePrintToken) return;
      try {
        if (typeof window.matchMedia === 'function' && window.matchMedia('print').matches) {
          return;
        }
      } catch {
        // ignore matchMedia errors
      }
      finishIfCurrent();
    }, 350);
  };

  window.addEventListener('afterprint', onAfterPrint);
  window.addEventListener('focus', onWindowFocus);
  activeCleanupDisposers.push(() => {
    clearFocusTimer();
    window.removeEventListener('afterprint', onAfterPrint);
    window.removeEventListener('focus', onWindowFocus);
  });

  if (iframeWin && iframeWin !== window) {
    try {
      iframeWin.addEventListener('afterprint', onAfterPrint);
      activeCleanupDisposers.push(() => {
        try {
          iframeWin.removeEventListener('afterprint', onAfterPrint);
        } catch {
          // ignore detached iframe errors
        }
      });
    } catch {
      // ignore cross-realm listener restrictions
    }
  }

  if (typeof window.matchMedia === 'function') {
    try {
      const mql = window.matchMedia('print');
      const onPrintMediaChange = (e: MediaQueryListEvent) => {
        if (!e.matches) {
          finishIfCurrent();
        }
      };
      if (typeof mql.addEventListener === 'function') {
        mql.addEventListener('change', onPrintMediaChange);
        activeCleanupDisposers.push(() => mql.removeEventListener('change', onPrintMediaChange));
      } else if (typeof (mql as any).addListener === 'function') {
        (mql as any).addListener(onPrintMediaChange);
        activeCleanupDisposers.push(() => (mql as any).removeListener(onPrintMediaChange));
      }
    } catch {
      // ignore matchMedia errors
    }
  }

  cleanupTimerId = window.setTimeout(finishIfCurrent, 15000);
}

/**
 * Synchronously mounts an isolated hidden print iframe (never mutating host app CSS/layout)
 * and invokes print() directly from the user's click gesture so browsers and Save as PDF work reliably.
 */
export function printDocument(html: string, title: string = 'Print Document'): PrintResult {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return { opened: false, error: 'Printing is only available in a browser environment.' };
  }

  if (typeof window.print !== 'function') {
    return { opened: false, error: 'This browser does not support native printing.' };
  }

  if (!html || !html.trim()) {
    return { opened: false, error: 'Nothing to print. Please wait for preview content to load.' };
  }

  if (isPrintingInProgress) {
    return { opened: false, error: 'A print dialog is currently active. Please close it and retry.' };
  }

  activePrintToken += 1;
  const jobToken = activePrintToken;
  isPrintingInProgress = true;

  try {
    cleanupPrintPortal();
    savedHostDocumentTitle = document.title || APP_IDENTITY.fullTitle;
    document.title = title;

    // 1. Primary path: completely isolated hidden iframe (zero CSS leakage to host document)
    if (document.body && typeof document.createElement === 'function') {
      const iframe = document.createElement('iframe');
      iframe.id = PRINT_IFRAME_ID;
      iframe.setAttribute('aria-hidden', 'true');
      iframe.tabIndex = -1;
      iframe.style.cssText =
        'position:fixed;left:-10000px;top:0;width:210mm;height:297mm;border:0;margin:0;padding:0;opacity:0;pointer-events:none;z-index:-1;';
      document.body.appendChild(iframe);

      const iframeWin = iframe.contentWindow;
      const iframeDoc = iframe.contentDocument || iframeWin?.document;
      if (iframeDoc && iframeWin && typeof iframeWin.print === 'function') {
        iframeDoc.open();
        iframeDoc.write(html);
        iframeDoc.close();
        if (title) {
          iframeDoc.title = title;
        }
        // Force synchronous layout inside isolated iframe document
        void iframeDoc.body?.offsetHeight;

        registerPrintLifecycleCleanup(jobToken, iframeWin);
        iframeWin.focus();
        iframeWin.print();
        return { opened: true };
      }

      // Remove unusable iframe before falling back to scoped print portal
      if (iframe.parentNode) {
        iframe.parentNode.removeChild(iframe);
      }
    }

    // 2. Fallback path (environments without iframe.contentWindow.print): strictly @media print + #root scoped
    const { css, bodyHtml } = extractPrintParts(html);
    const scopedCss = scopeFallbackPrintCss(css, PRINT_ROOT_ID);

    const styleEl = document.createElement('style');
    styleEl.id = PRINT_STYLE_ID;
    styleEl.textContent = `
      @media screen {
        #${PRINT_ROOT_ID} {
          display: none !important;
        }
      }
      @media print {
        body > *:not(#${PRINT_ROOT_ID}) {
          display: none !important;
        }
        #${PRINT_ROOT_ID} {
          display: block !important;
          position: static !important;
          width: 100% !important;
          margin: 0 !important;
          padding: 0 !important;
          background: #ffffff !important;
          color: #000000 !important;
        }
      }
      ${scopedCss}
    `;

    const printRoot = document.createElement('div');
    printRoot.id = PRINT_ROOT_ID;
    printRoot.innerHTML = bodyHtml;

    document.head.appendChild(styleEl);
    document.body.appendChild(printRoot);

    void printRoot.offsetHeight;

    registerPrintLifecycleCleanup(jobToken, window);
    window.print();

    return { opened: true };
  } catch (err: any) {
    cleanupPrintPortal();
    return {
      opened: false,
      error: err?.message || 'Unable to open browser print dialog. Please try again.',
    };
  } finally {
    restoreHostDocumentTitle();
    isPrintingInProgress = false;
  }
}

export function printInvoice(
  sale: Sale,
  settings: ShopSettings,
  formatOverride?: InvoicePaperSize,
  activeBranch?: Branch | null
): PrintResult {
  try {
    const { html } = buildInvoiceHtml(sale, settings, formatOverride, undefined, activeBranch);
    return printDocument(html, `Invoice ${sale.invoiceNumber}`);
  } catch (err: any) {
    return { opened: false, error: err?.message || 'Failed to prepare invoice print.' };
  }
}

export function previewInvoice(
  sale: Sale,
  settings: ShopSettings,
  formatOverride?: InvoicePaperSize,
  activeBranch?: Branch | null
): PrintPreviewPayload {
  const { html, paperInfo, showScaleGuidance } = buildInvoiceHtml(sale, settings, formatOverride, undefined, activeBranch);
  return {
    title: `Invoice Preview — ${sale.invoiceNumber}`,
    html,
    paperInfo,
    showScaleGuidance,
  };
}

function buildBusinessDocHeaderHtml(
  settings: ShopSettings,
  docBadge: string,
  docRef: string,
  docDateText: string,
  activeBranch?: Branch | null
): string {
  const logoUrl = getShopLogo(settings);
  const biz = resolveBusinessProfile(settings, activeBranch);
  return `
    <div class="doc-header">
      <div class="doc-brand">
        <img src="${escapeHtml(logoUrl || APP_IDENTITY.symbolPath)}" alt="${escapeHtml(logoUrl ? biz.shopName : APP_IDENTITY.name)}" class="doc-logo" />
        <div>
          <h1 class="doc-shop-title">${escapeHtml(biz.shopName)}</h1>
          ${biz.tagline ? `<p class="doc-sub">${escapeHtml(biz.tagline)}</p>` : ''}
          ${biz.branchName ? `<p class="doc-sub" style="font-weight:600;">Branch: ${escapeHtml(biz.branchName)}</p>` : ''}
          ${biz.address ? `<p class="doc-sub">${escapeHtml(biz.address)}</p>` : ''}
          <p class="doc-sub">Phone: ${escapeHtml(biz.mobile || '-')}${biz.email ? ` | Email: ${escapeHtml(biz.email)}` : ''}</p>
          ${biz.vatRegistrationNo ? `<p class="doc-sub">VAT / BIN: ${escapeHtml(biz.vatRegistrationNo)}</p>` : ''}
        </div>
      </div>
      <div style="text-align:right;">
        <span class="doc-badge">${escapeHtml(docBadge)}</span>
        <div class="mono" style="font-weight:800; font-size:13px; margin-top:6px; color:#101B3F;">${escapeHtml(docRef)}</div>
        <div class="doc-sub">${escapeHtml(docDateText)}</div>
        <div class="doc-sub" style="font-size:9.5px; color:#64748b; margin-top:4px;">${escapeHtml(APP_IDENTITY.name)} · ${escapeHtml(APP_IDENTITY.subtitle)}</div>
      </div>
    </div>
  `;
}

const BUSINESS_DOC_SHARED_CSS = `
  @page { size: A4 portrait; margin: 12mm; }
  @media screen {
    html.adp-preview-frame body {
      padding: 16px;
      background: #F5F7FC;
      display: flex;
      justify-content: center;
    }
  }
  .adp-doc .doc-sheet {
    width: 100%;
    max-width: 186mm;
    background: #ffffff;
    color: #0f172a;
    font-size: 12px;
    line-height: 1.45;
    padding: 8mm;
  }
  @media screen {
    .adp-doc .doc-sheet {
      border: 1px solid #cbd5e1;
      box-shadow: 0 4px 18px rgba(16, 27, 63, 0.08);
      border-radius: 6px;
    }
  }
  .adp-doc .doc-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 16px;
    padding-bottom: 12px;
    border-bottom: 2px solid #101B3F;
  }
  .adp-doc .doc-brand { display: flex; gap: 12px; align-items: flex-start; }
  .adp-doc .doc-logo { max-height: 52px; max-width: 140px; object-fit: contain; }
  .adp-doc .doc-shop-title { font-size: 19px; font-weight: 800; margin: 0; color: #101B3F; }
  .adp-doc .doc-sub { color: #475569; margin: 2px 0; font-size: 11px; }
  .adp-doc .doc-badge {
    display: inline-block;
    padding: 3px 10px;
    background: #101B3F;
    color: #ffffff;
    border-bottom: 2px solid #FF9D32;
    font-weight: 800;
    letter-spacing: 0.08em;
    border-radius: 4px;
    font-size: 11px;
  }
  .adp-doc .doc-meta-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 14px;
    padding: 10px 0;
    border-bottom: 1px solid #cbd5e1;
  }
  .adp-doc .doc-meta-label {
    font-size: 9.5px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: #64748b;
    margin-bottom: 2px;
  }
  .adp-doc table { width: 100%; border-collapse: collapse; margin-top: 12px; }
  .adp-doc th {
    background: #f8fafc;
    color: #334155;
    font-weight: 700;
    font-size: 11px;
    text-align: left;
    padding: 7px 8px;
    border-top: 1px solid #cbd5e1;
    border-bottom: 1px solid #94a3b8;
  }
  .adp-doc td { padding: 7px 8px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
  .adp-doc .num { text-align: right; }
  .adp-doc .ctr { text-align: center; }
  .adp-doc .doc-summary {
    width: 260px;
    margin-left: auto;
    margin-top: 14px;
    border: 1px solid #cbd5e1;
    border-radius: 6px;
    padding: 10px 12px;
    background: #f8fafc;
  }
  .adp-doc .t-line { display: flex; justify-content: space-between; margin: 4px 0; }
  .adp-doc .t-grand {
    display: flex;
    justify-content: space-between;
    border-top: 2px solid #0f172a;
    margin-top: 6px;
    padding-top: 6px;
    font-size: 14px;
    font-weight: 800;
  }
`;

export function buildPurchaseOrderHtml(
  purchase: Purchase,
  settings: ShopSettings,
  activeBranch?: Branch | null
): string {
  const lang = settings.language || 'en';
  const currency = settings.currency || '৳';
  const formatMoney = (amount: number) => {
    const formatted = formatCurrency(amount, 'en');
    return currency === '৳' ? formatted : formatted.replace('৳', currency);
  };

  const rows = purchase.items
    .map(
      (item, idx) => `
      <tr>
        <td class="ctr mono">${idx + 1}</td>
        <td style="font-weight:700;">${escapeHtml(item.productName)}</td>
        <td class="ctr mono">${item.quantity}</td>
        <td class="num mono">${formatMoney(item.purchasePrice)}</td>
        <td class="num mono" style="font-weight:700;">${formatMoney(item.total)}</td>
      </tr>`
    )
    .join('');

  const directCosts =
    (purchase.transportCost || 0) +
    (purchase.loadingCost || 0) +
    (purchase.packagingCost || 0) +
    (purchase.otherCost || 0);

  const bodyHtml = `
    <div class="doc-sheet">
      ${buildBusinessDocHeaderHtml(
        settings,
        'PURCHASE ORDER',
        purchase.invoiceNumber,
        `${formatDate(purchase.date, lang)} · ${formatTime(purchase.date)}`,
        activeBranch
      )}
      <div class="doc-meta-grid">
        <div>
          <div class="doc-meta-label">Supplier / Vendor</div>
          <div style="font-weight:700; font-size:13px;">${escapeHtml(purchase.supplierName)}</div>
        </div>
        <div style="text-align:right;">
          <div class="doc-meta-label">Payment Method</div>
          <div style="font-weight:700; text-transform:uppercase;">${escapeHtml(purchase.paymentMethod)}</div>
          ${purchase.notes ? `<div class="doc-sub">Note: ${escapeHtml(purchase.notes)}</div>` : ''}
        </div>
      </div>
      <table>
        <thead>
          <tr>
            <th class="ctr" style="width:32px;">SL</th>
            <th>Product</th>
            <th class="ctr" style="width:60px;">Qty</th>
            <th class="num" style="width:90px;">Unit Cost</th>
            <th class="num" style="width:100px;">Total</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="doc-summary">
        <div class="t-line"><span>Items Subtotal:</span><span class="mono">${formatMoney(purchase.subtotal)}</span></div>
        ${purchase.discount > 0 ? `<div class="t-line"><span>Discount:</span><span class="mono">-${formatMoney(purchase.discount)}</span></div>` : ''}
        ${directCosts > 0 ? `<div class="t-line"><span>Direct Costs:</span><span class="mono">+${formatMoney(directCosts)}</span></div>` : ''}
        <div class="t-grand"><span>Total Payable:</span><span class="mono">${formatMoney(purchase.total)}</span></div>
        <div class="t-line" style="font-weight:600; color:#065f46;"><span>Paid:</span><span class="mono">${formatMoney(purchase.paid)}</span></div>
        ${purchase.due > 0 ? `<div class="t-line" style="font-weight:800; color:#be123c;"><span>Due Balance:</span><span class="mono">${formatMoney(purchase.due)}</span></div>` : ''}
      </div>
    </div>
  `;

  return buildStandaloneDocument(
    `Purchase Order ${purchase.invoiceNumber}`,
    bodyHtml,
    BUSINESS_DOC_SHARED_CSS
  );
}

export function printPurchaseOrder(
  purchase: Purchase,
  settings: ShopSettings,
  activeBranch?: Branch | null
): PrintResult {
  try {
    const html = buildPurchaseOrderHtml(purchase, settings, activeBranch);
    return printDocument(html, `Purchase Order ${purchase.invoiceNumber}`);
  } catch (err: any) {
    return { opened: false, error: err?.message || 'Failed to print purchase order.' };
  }
}

export function printCustomerStatement(
  customer: Customer,
  transactions: CustomerTransaction[],
  settings: ShopSettings,
  activeBranch?: Branch | null
): PrintResult {
  try {
    const lang = settings.language || 'en';
    const currency = settings.currency || '৳';
    const formatMoney = (amount: number) => {
      const formatted = formatCurrency(amount, 'en');
      return currency === '৳' ? formatted : formatted.replace('৳', currency);
    };

    const rows = transactions
      .map((t, idx) => {
        const isCredit = t.type === 'due_collection' || t.type === 'return_adjustment';
        const typeLabel =
          t.type === 'due_collection'
            ? 'Due Payment'
            : t.type === 'return_adjustment'
            ? 'Return Adjustment'
            : t.type === 'opening'
            ? 'Opening Due'
            : 'Due Sale';
        return `
        <tr>
          <td class="ctr mono">${idx + 1}</td>
          <td>${escapeHtml(formatDate(t.date, lang))}</td>
          <td>${escapeHtml(typeLabel)}${t.referenceId ? ` (${escapeHtml(t.referenceId)})` : ''}</td>
          <td>${escapeHtml(t.note || '—')}</td>
          <td class="num mono">${isCredit ? `-${formatMoney(t.amount)}` : `+${formatMoney(t.amount)}`}</td>
          <td class="num mono" style="font-weight:700;">${formatMoney(t.balanceAfter)}</td>
        </tr>`;
      })
      .join('');

    const bodyHtml = `
      <div class="doc-sheet">
        ${buildBusinessDocHeaderHtml(
          settings,
          'CUSTOMER STATEMENT',
          customer.name,
          `Generated: ${formatDate(new Date().toISOString(), lang)}`,
          activeBranch
        )}
        <div class="doc-meta-grid">
          <div>
            <div class="doc-meta-label">Customer Details</div>
            <div style="font-weight:700; font-size:13px;">${escapeHtml(customer.name)}</div>
            <div class="doc-sub mono">Mobile: ${escapeHtml(customer.mobile)}</div>
            ${customer.address ? `<div class="doc-sub">${escapeHtml(customer.address)}</div>` : ''}
          </div>
          <div style="text-align:right;">
            <div class="doc-meta-label">Account Summary</div>
            <div class="doc-sub">Total Purchases: <strong class="mono">${formatMoney(customer.totalPurchase)}</strong></div>
            <div class="doc-sub">Total Paid: <strong class="mono">${formatMoney(customer.totalPaid)}</strong></div>
            <div class="doc-sub">Current Due: <strong class="mono" style="color:#b45309;">${formatMoney(customer.currentDue)}</strong></div>
          </div>
        </div>
        <table>
          <thead>
            <tr>
              <th class="ctr" style="width:32px;">SL</th>
              <th>Date</th>
              <th>Type / Ref</th>
              <th>Note</th>
              <th class="num">Amount</th>
              <th class="num">Balance</th>
            </tr>
          </thead>
          <tbody>${rows || '<tr><td colspan="6" class="ctr">No transactions recorded.</td></tr>'}</tbody>
        </table>
      </div>
    `;

    const html = buildStandaloneDocument(
      `Customer Statement - ${customer.name}`,
      bodyHtml,
      BUSINESS_DOC_SHARED_CSS
    );
    return printDocument(html, `Customer Statement - ${customer.name}`);
  } catch (err: any) {
    return { opened: false, error: err?.message || 'Failed to print customer statement.' };
  }
}

export function printSupplierStatement(
  supplier: Supplier,
  transactions: SupplierTransaction[],
  settings: ShopSettings,
  activeBranch?: Branch | null
): PrintResult {
  try {
    const lang = settings.language || 'en';
    const currency = settings.currency || '৳';
    const formatMoney = (amount: number) => {
      const formatted = formatCurrency(amount, 'en');
      return currency === '৳' ? formatted : formatted.replace('৳', currency);
    };

    const rows = transactions
      .map((t, idx) => {
        const isCredit = t.type === 'due_payment' || t.type === 'return_adjustment';
        const typeLabel =
          t.type === 'due_payment'
            ? 'Due Payment'
            : t.type === 'return_adjustment'
            ? 'Return Adjustment'
            : t.type === 'opening'
            ? 'Opening Due'
            : 'Purchase Due';
        return `
        <tr>
          <td class="ctr mono">${idx + 1}</td>
          <td>${escapeHtml(formatDate(t.date, lang))}</td>
          <td>${escapeHtml(typeLabel)}${t.referenceId ? ` (${escapeHtml(t.referenceId)})` : ''}</td>
          <td>${escapeHtml(t.note || '—')}</td>
          <td class="num mono">${isCredit ? `-${formatMoney(t.amount)}` : `+${formatMoney(t.amount)}`}</td>
          <td class="num mono" style="font-weight:700;">${formatMoney(t.balanceAfter)}</td>
        </tr>`;
      })
      .join('');

    const bodyHtml = `
      <div class="doc-sheet">
        ${buildBusinessDocHeaderHtml(
          settings,
          'SUPPLIER STATEMENT',
          supplier.company,
          `Generated: ${formatDate(new Date().toISOString(), lang)}`,
          activeBranch
        )}
        <div class="doc-meta-grid">
          <div>
            <div class="doc-meta-label">Supplier Details</div>
            <div style="font-weight:700; font-size:13px;">${escapeHtml(supplier.company)}</div>
            <div class="doc-sub">Contact: ${escapeHtml(supplier.name)} · ${escapeHtml(supplier.mobile)}</div>
            ${supplier.address ? `<div class="doc-sub">${escapeHtml(supplier.address)}</div>` : ''}
          </div>
          <div style="text-align:right;">
            <div class="doc-meta-label">Account Summary</div>
            <div class="doc-sub">Total Purchase: <strong class="mono">${formatMoney(supplier.totalPurchase)}</strong></div>
            <div class="doc-sub">Total Paid: <strong class="mono">${formatMoney(supplier.totalPaid)}</strong></div>
            <div class="doc-sub">Payable Due: <strong class="mono" style="color:#be123c;">${formatMoney(supplier.currentDue)}</strong></div>
          </div>
        </div>
        <table>
          <thead>
            <tr>
              <th class="ctr" style="width:32px;">SL</th>
              <th>Date</th>
              <th>Type / Ref</th>
              <th>Note</th>
              <th class="num">Amount</th>
              <th class="num">Balance</th>
            </tr>
          </thead>
          <tbody>${rows || '<tr><td colspan="6" class="ctr">No transactions recorded.</td></tr>'}</tbody>
        </table>
      </div>
    `;

    const html = buildStandaloneDocument(
      `Supplier Statement - ${supplier.company}`,
      bodyHtml,
      BUSINESS_DOC_SHARED_CSS
    );
    return printDocument(html, `Supplier Statement - ${supplier.company}`);
  } catch (err: any) {
    return { opened: false, error: err?.message || 'Failed to print supplier statement.' };
  }
}

export function printFinancialReport(
  reportTitle: string,
  periodLabel: string,
  rows: { label: string; value: string; highlight?: boolean }[],
  settings: ShopSettings,
  activeBranch?: Branch | null
): PrintResult {
  try {
    const lang = settings.language || 'en';
    const tableRows = rows
      .map(
        r => `
        <tr style="${r.highlight ? 'background:#ecfdf5; font-weight:800;' : ''}">
          <td>${escapeHtml(r.label)}</td>
          <td class="num mono" style="font-weight:700;">${escapeHtml(r.value)}</td>
        </tr>`
      )
      .join('');

    const bodyHtml = `
      <div class="doc-sheet">
        ${buildBusinessDocHeaderHtml(
          settings,
          'BUSINESS REPORT',
          reportTitle,
          `Period: ${periodLabel} · ${formatDate(new Date().toISOString(), lang)}`,
          activeBranch
        )}
        <table>
          <thead>
            <tr>
              <th>Line Item / Metric</th>
              <th class="num">Amount / Value</th>
            </tr>
          </thead>
          <tbody>${tableRows}</tbody>
        </table>
      </div>
    `;

    const html = buildStandaloneDocument(
      `${reportTitle} - ${getBusinessDisplayName(settings)}`,
      bodyHtml,
      BUSINESS_DOC_SHARED_CSS
    );
    return printDocument(html, reportTitle);
  } catch (err: any) {
    return { opened: false, error: err?.message || 'Failed to print report.' };
  }
}

export function printProductLabel(
  items: PrintLabelItem[],
  config: LabelConfig,
  settings: ShopSettings
): PrintResult {
  if (!items || items.length === 0) {
    return { opened: false, error: 'Please select at least one item to print labels.' };
  }
  try {
    const { html } = buildLabelsHtml(items, config, settings);
    return printDocument(html, 'Barcode & Price Labels');
  } catch (err: any) {
    return { opened: false, error: err?.message || 'Failed to build barcode labels.' };
  }
}

export function previewProductLabel(
  items: PrintLabelItem[],
  config: LabelConfig,
  settings: ShopSettings
): PrintPreviewPayload {
  const { html, paperInfo, showScaleGuidance, totalLabels } = buildLabelsHtml(items, config, settings);
  return {
    title: 'Label Sheet Print Preview',
    html,
    paperInfo,
    showScaleGuidance,
    totalLabels,
  };
}

export async function previewProductLabelAsync(
  items: PrintLabelItem[],
  config: LabelConfig,
  settings: ShopSettings,
  options?: { signal?: AbortSignal; onProgress?: (done: number, total: number) => void }
): Promise<PrintPreviewPayload> {
  const { html, paperInfo, showScaleGuidance, totalLabels } = await buildLabelsHtmlAsync(
    items,
    config,
    settings,
    options
  );
  return {
    title: 'Label Sheet Print Preview',
    html,
    paperInfo,
    showScaleGuidance,
    totalLabels,
  };
}
