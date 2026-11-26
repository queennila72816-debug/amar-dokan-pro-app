import { jsPDF } from 'jspdf';
import { Branch, ComboOffer, Product, ShopSettings } from '../types';
import { APP_IDENTITY, resolveBusinessProfile } from '../config/appIdentity';
import { comboOfferService } from '../services/comboOfferService';
import { formatCurrency, formatDate } from './formatters';
import {
  buildStandaloneDocument,
  escapeHtml,
  getPrinterSettings,
  getShopLogo,
  printDocument,
  PrintResult,
} from './printEngine';

export type ComboPrintFormat = 'a4' | 'a5' | '80mm' | '58mm';
export type ComboPdfFormat = 'a4' | 'a5';

export interface ComboExportItemRow {
  index: number;
  productName: string;
  size: string;
  color: string;
  variantDetails: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  isFree: boolean;
}

export interface ComboExportModel {
  shopName: string;
  tagline: string;
  branchName: string;
  address: string;
  mobile: string;
  email: string;
  vatRegistrationNo: string;
  logoUrl: string;
  comboName: string;
  comboCategory: string;
  description: string;
  startDate: string;
  endDate: string;
  items: ComboExportItemRow[];
  regularTotalPrice: number;
  finalComboPrice: number;
  discountAmount: number;
  discountPercent: number;
  customerSavings: number;
  formatMoney: (amount: number) => string;
}

const round2 = (n: number): number => Math.round((Number(n) || 0) * 100) / 100;

export function buildComboPdfFilename(comboName: string, pageSize: ComboPdfFormat): string {
  const slug = (comboName || 'combo-offer')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${slug || 'combo-offer'}-${pageSize}.pdf`;
}

export function resolveComboExportModel(
  offer: ComboOffer,
  products: Product[],
  settings: ShopSettings,
  activeBranch?: Branch | null
): ComboExportModel {
  const biz = resolveBusinessProfile(settings, activeBranch);
  const logoUrl = getShopLogo(settings);
  const currency = settings.currency || '৳';
  const formatMoney = (amount: number): string =>
    formatCurrency(round2(amount), 'en').replace('৳', currency);

  const items: ComboExportItemRow[] = (offer.items || []).map((item, idx) => {
    const prod = products.find(p => p.id === item.productId);
    const variant =
      item.variantId && prod?.variants
        ? prod.variants.find(v => v.id === item.variantId)
        : undefined;

    const size = (variant?.size || (!prod?.hasVariants ? prod?.size : '') || '').trim();
    const color = (variant?.color || (!prod?.hasVariants ? prod?.color : '') || '').trim();
    const fallbackVariantText = (item.variantDetails || '').trim();
    const variantDetails =
      [color, size].filter(Boolean).join(' / ') || fallbackVariantText;

    const unitPrice = round2(
      item.salePrice ??
        variant?.salePrice ??
        (variant?.additionalPrice && prod ? prod.salePrice + variant.additionalPrice : undefined) ??
        prod?.salePrice ??
        0
    );
    const quantity = Math.max(1, Number(item.quantity) || 1);
    const isFree = Boolean(item.isFree);
    const lineTotal = isFree ? 0 : round2(unitPrice * quantity);

    return {
      index: idx + 1,
      productName: item.productName || prod?.name || 'Product',
      size,
      color,
      variantDetails,
      quantity,
      unitPrice,
      lineTotal,
      isFree,
    };
  });

  const computedRegular = round2(items.reduce((sum, it) => sum + (it.isFree ? 0 : it.lineTotal), 0));
  const regularTotalPrice = round2(
    offer.regularTotalPrice > 0 ? offer.regularTotalPrice : computedRegular
  );
  const finalComboPrice = round2(offer.finalComboPrice);
  const discountAmount = Math.max(0, round2(regularTotalPrice - finalComboPrice));
  const discountPercent = comboOfferService.calculateEquivalentDiscountPercent(
    regularTotalPrice,
    finalComboPrice
  );

  return {
    shopName: biz.shopName,
    tagline: biz.tagline || '',
    branchName: biz.branchName || '',
    address: biz.address || '',
    mobile: biz.mobile || '',
    email: biz.email || '',
    vatRegistrationNo: biz.vatRegistrationNo || '',
    logoUrl,
    comboName: offer.name || 'Combo Offer',
    comboCategory: offer.comboCategory || 'Combo Offer',
    description: offer.description || '',
    startDate: offer.startDate || '',
    endDate: offer.endDate || '',
    items,
    regularTotalPrice,
    finalComboPrice,
    discountAmount,
    discountPercent,
    customerSavings: discountAmount,
    formatMoney,
  };
}

export function buildComboOfferPrintHtml(
  offer: ComboOffer,
  products: Product[],
  settings: ShopSettings,
  format: ComboPrintFormat = 'a4',
  activeBranch?: Branch | null
): string {
  const m = resolveComboExportModel(offer, products, settings, activeBranch);
  const printer = getPrinterSettings(settings);
  const lang = settings.language || 'en';
  const contactParts = [
    m.mobile ? `Tel: ${m.mobile}` : '',
    m.email ? m.email : '',
  ].filter(Boolean);

  if (format === '80mm' || format === '58mm') {
    const rollMm = format === '58mm' ? 58 : 80;
    const printableMm = format === '58mm' ? 52 : 74;
    const basePx = format === '58mm' ? 9.5 : 10.5;
    const pricePx = format === '58mm' ? 16 : 19;

    const pageCss = `
      @page {
        size: ${rollMm}mm auto;
        margin: 2mm;
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
      .adp-doc .combo-roll {
        width: ${printableMm}mm;
        max-width: 100%;
        background: #ffffff;
        color: #000000;
        font-size: ${basePx}px;
        line-height: 1.35;
        padding: 2mm;
      }
      .adp-doc .center { text-align: center; }
      .adp-doc .dashed-b { border-bottom: 1px dashed #64748b; padding-bottom: 6px; margin-bottom: 6px; }
      .adp-doc .logo { max-height: 32px; max-width: 96px; object-fit: contain; margin: 0 auto 4px; display: block; }
      .adp-doc .shop-name { font-size: ${basePx + 3}px; font-weight: 800; margin: 0; color: #000; }
      .adp-doc .muted { font-size: ${Math.max(8, basePx - 1.5)}px; color: #334155; margin: 1px 0; }
      .adp-doc .badge {
        display: inline-block;
        padding: 2px 7px;
        background: #0f766e;
        color: #ffffff;
        font-size: ${Math.max(8, basePx - 1.5)}px;
        font-weight: 800;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        border-radius: 3px;
        margin-bottom: 4px;
      }
      .adp-doc .combo-title { font-size: ${basePx + 2.5}px; font-weight: 800; color: #000; margin: 2px 0; }
      .adp-doc .row { display: flex; justify-content: space-between; align-items: baseline; gap: 6px; margin: 2px 0; }
      .adp-doc .item { padding: 4px 0; border-bottom: 1px dotted #cbd5e1; break-inside: avoid; }
      .adp-doc .item:last-child { border-bottom: none; }
      .adp-doc .item-name { font-weight: 700; color: #000; }
      .adp-doc .item-meta { font-size: ${Math.max(8, basePx - 1.5)}px; color: #334155; }
      .adp-doc .price-box {
        border: 1.5px solid #0f766e;
        background: #f0fdfa;
        border-radius: 4px;
        padding: 6px;
        margin-top: 6px;
        text-align: center;
      }
      .adp-doc .final-price {
        font-size: ${pricePx}px;
        font-weight: 900;
        color: #000;
        line-height: 1.1;
        margin: 2px 0;
      }
      .adp-doc .savings { font-size: ${Math.max(8.5, basePx - 0.5)}px; font-weight: 800; color: #047857; }
    `;

    const itemsHtml = m.items
      .map(
        it => `
        <div class="item">
          <div class="item-name">${it.index}. ${escapeHtml(it.productName)}${it.isFree ? ' [FREE]' : ''}</div>
          ${it.variantDetails ? `<div class="item-meta">Variant: ${escapeHtml(it.variantDetails)}</div>` : ''}
          <div class="row">
            <span class="mono">${it.quantity} × ${it.isFree ? 'FREE' : escapeHtml(m.formatMoney(it.unitPrice))}</span>
            <span class="mono" style="font-weight:700;">${it.isFree ? 'FREE' : escapeHtml(m.formatMoney(it.lineTotal))}</span>
          </div>
        </div>`
      )
      .join('');

    const bodyHtml = `
      <div class="combo-roll">
        <div class="center dashed-b">
          ${m.logoUrl ? `<img src="${escapeHtml(m.logoUrl)}" alt="${escapeHtml(m.shopName)}" class="logo" />` : ''}
          <h1 class="shop-name">${escapeHtml(m.shopName)}</h1>
          ${m.tagline ? `<p class="muted">${escapeHtml(m.tagline)}</p>` : ''}
          ${m.branchName ? `<p class="muted" style="font-weight:600;">Branch: ${escapeHtml(m.branchName)}</p>` : ''}
          ${m.address ? `<p class="muted">${escapeHtml(m.address)}</p>` : ''}
          ${contactParts.length > 0 ? `<p class="muted">${escapeHtml(contactParts.join(' | '))}</p>` : ''}
          ${m.vatRegistrationNo ? `<p class="muted">VAT/BIN: ${escapeHtml(m.vatRegistrationNo)}</p>` : ''}
        </div>

        <div class="center dashed-b">
          <span class="badge">${escapeHtml(m.comboCategory)}</span>
          <div class="combo-title">${escapeHtml(m.comboName)}</div>
          ${m.description ? `<p class="muted">${escapeHtml(m.description)}</p>` : ''}
          ${
            m.startDate
              ? `<p class="muted">Valid: ${escapeHtml(formatDate(m.startDate, lang))}${
                  m.endDate ? ` – ${escapeHtml(formatDate(m.endDate, lang))}` : ''
                }</p>`
              : ''
          }
        </div>

        <div class="dashed-b">
          <div class="row" style="font-weight:700; border-bottom:1px solid #94a3b8; padding-bottom:2px; margin-bottom:2px;">
            <span>Included Products</span>
            <span>Price</span>
          </div>
          ${itemsHtml}
        </div>

        <div class="dashed-b">
          <div class="row"><span>Regular Total:</span><span class="mono" style="text-decoration:line-through;">${escapeHtml(m.formatMoney(m.regularTotalPrice))}</span></div>
          <div class="row"><span>Discount (${m.discountPercent}%):</span><span class="mono">-${escapeHtml(m.formatMoney(m.discountAmount))}</span></div>
          <div class="price-box">
            <div class="muted" style="font-weight:700; text-transform:uppercase;">Special Combo Offer Price</div>
            <div class="final-price mono">${escapeHtml(m.formatMoney(m.finalComboPrice))}</div>
            <div class="savings">You Save ${escapeHtml(m.formatMoney(m.customerSavings))} (${m.discountPercent}% OFF)</div>
          </div>
        </div>

        <div class="center">
          <p class="muted">Combo offer preview · Not a sales invoice</p>
          <p class="muted" style="margin-top:4px; font-size:8px;">Powered by <strong>${escapeHtml(APP_IDENTITY.name)}</strong></p>
        </div>
      </div>
    `;

    return buildStandaloneDocument(`Combo Offer - ${m.comboName}`, bodyHtml, pageCss, extraStyles);
  }

  // A4 & A5 Professional Retail Layout
  const isA5 = format === 'a5';
  const sheetMargin = isA5 ? 8 : 12;
  const containerWidth = isA5 ? '132mm' : '186mm';
  const baseFontPx = isA5 ? 10.5 : 12;

  const pageCss = `
    @page {
      size: ${isA5 ? 'A5 portrait' : 'A4 portrait'};
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

  const extraStyles = `
    .adp-doc .combo-sheet {
      width: 100%;
      max-width: ${containerWidth};
      background: #ffffff;
      color: #0f172a;
      font-size: ${baseFontPx}px;
      line-height: 1.45;
      padding: ${isA5 ? '5mm' : '8mm'};
    }
    @media screen {
      .adp-doc .combo-sheet {
        border: 1px solid #cbd5e1;
        box-shadow: 0 4px 18px rgba(15, 23, 42, 0.08);
        border-radius: 6px;
      }
    }
    .adp-doc .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 14px;
      padding-bottom: 12px;
      border-bottom: 2px solid #101B3F;
    }
    .adp-doc .brand { display: flex; gap: 12px; align-items: flex-start; }
    .adp-doc .logo { max-height: ${isA5 ? 40 : 54}px; max-width: ${isA5 ? 105 : 140}px; object-fit: contain; }
    .adp-doc .shop-title { font-size: ${isA5 ? 15 : 19}px; font-weight: 800; margin: 0; color: #101B3F; }
    .adp-doc .sub { color: #475569; margin: 2px 0; font-size: ${isA5 ? 9.5 : 11}px; }
    .adp-doc .offer-tag {
      display: inline-block;
      padding: 4px 10px;
      background: #0f766e;
      color: #ffffff;
      font-weight: 800;
      letter-spacing: 0.07em;
      border-radius: 4px;
      font-size: ${isA5 ? 9.5 : 10.5}px;
      text-transform: uppercase;
    }
    .adp-doc .combo-banner {
      margin-top: 12px;
      padding: ${isA5 ? '10px 12px' : '12px 16px'};
      background: #f8fafc;
      border: 1px solid #cbd5e1;
      border-left: 4px solid #0f766e;
      border-radius: 6px;
    }
    .adp-doc .cat-pill {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 4px;
      background: #ccfbf1;
      color: #0f766e;
      font-weight: 800;
      font-size: ${isA5 ? 9 : 10}px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .adp-doc .combo-name {
      font-size: ${isA5 ? 15 : 18}px;
      font-weight: 800;
      color: #0f172a;
      margin: 4px 0 2px;
    }
    .adp-doc table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 12px;
    }
    .adp-doc th {
      background: #f1f5f9;
      color: #334155;
      font-weight: 700;
      font-size: ${isA5 ? 9.5 : 10.5}px;
      text-align: left;
      padding: 7px 8px;
      border-top: 1px solid #cbd5e1;
      border-bottom: 1px solid #94a3b8;
    }
    .adp-doc td {
      padding: 7px 8px;
      border-bottom: 1px solid #e2e8f0;
      vertical-align: top;
      font-size: ${isA5 ? 10 : 11.5}px;
    }
    .adp-doc tr { break-inside: avoid; page-break-inside: avoid; }
    .adp-doc .num { text-align: right; }
    .adp-doc .ctr { text-align: center; }
    .adp-doc .pricing-card {
      margin-top: 14px;
      border: 1.5px solid #0f766e;
      border-radius: 8px;
      background: #f0fdfa;
      padding: ${isA5 ? '10px 12px' : '14px 16px'};
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .adp-doc .p-line {
      display: flex;
      gap: 10px;
      font-size: ${isA5 ? 10.5 : 11.5}px;
      color: #334155;
      margin: 2px 0;
    }
    .adp-doc .final-price-wrap { text-align: right; }
    .adp-doc .final-label {
      font-size: ${isA5 ? 9.5 : 10.5}px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #0f766e;
    }
    .adp-doc .final-price {
      font-size: ${isA5 ? 21 : 26}px;
      font-weight: 900;
      color: #0f172a;
      line-height: 1.1;
      margin: 2px 0;
    }
    .adp-doc .savings-line {
      font-size: ${isA5 ? 10.5 : 12}px;
      font-weight: 800;
      color: #047857;
    }
    .adp-doc .doc-footer {
      margin-top: 18px;
      padding-top: 8px;
      border-top: 1px solid #e2e8f0;
      display: flex;
      justify-content: space-between;
      font-size: ${isA5 ? 8.5 : 9.5}px;
      color: #64748b;
    }
  `;

  const rowsHtml = m.items
    .map(
      it => `
      <tr>
        <td class="ctr mono">${it.index}</td>
        <td>
          <div style="font-weight:700; color:#0f172a;">
            ${escapeHtml(it.productName)}
            ${it.isFree ? '<span style="font-size:9px;background:#dcfce7;color:#166534;padding:1px 5px;border-radius:3px;margin-left:4px;">FREE</span>' : ''}
          </div>
        </td>
        <td>${it.variantDetails ? escapeHtml(it.variantDetails) : 'Standard'}</td>
        <td class="ctr mono" style="font-weight:700;">${it.quantity}</td>
        <td class="num mono">${it.isFree ? 'FREE' : escapeHtml(m.formatMoney(it.unitPrice))}</td>
        <td class="num mono" style="font-weight:700;">${it.isFree ? 'FREE' : escapeHtml(m.formatMoney(it.lineTotal))}</td>
      </tr>`
    )
    .join('');

  const bodyHtml = `
    <div class="combo-sheet">
      <div class="header">
        <div class="brand">
          ${m.logoUrl ? `<img src="${escapeHtml(m.logoUrl)}" alt="${escapeHtml(m.shopName)}" class="logo" />` : ''}
          <div>
            <h1 class="shop-title">${escapeHtml(m.shopName)}</h1>
            ${m.tagline ? `<p class="sub">${escapeHtml(m.tagline)}</p>` : ''}
            ${m.branchName ? `<p class="sub" style="font-weight:600;">Branch: ${escapeHtml(m.branchName)}</p>` : ''}
            ${m.address ? `<p class="sub">${escapeHtml(m.address)}</p>` : ''}
            ${contactParts.length > 0 ? `<p class="sub">${escapeHtml(contactParts.join(' | '))}</p>` : ''}
            ${m.vatRegistrationNo ? `<p class="sub">VAT / BIN: ${escapeHtml(m.vatRegistrationNo)}</p>` : ''}
          </div>
        </div>
        <div style="text-align:right; flex-shrink:0;">
          <span class="offer-tag">COMBO OFFER</span>
          ${
            m.startDate
              ? `<p class="sub" style="margin-top:6px;">Valid: ${escapeHtml(formatDate(m.startDate, lang))}${
                  m.endDate ? ` – ${escapeHtml(formatDate(m.endDate, lang))}` : ''
                }</p>`
              : ''
          }
        </div>
      </div>

      <div class="combo-banner">
        <span class="cat-pill">${escapeHtml(m.comboCategory)}</span>
        <h2 class="combo-name">${escapeHtml(m.comboName)}</h2>
        ${m.description ? `<p class="sub" style="margin:0;">${escapeHtml(m.description)}</p>` : ''}
      </div>

      <table>
        <thead>
          <tr>
            <th class="ctr" style="width:34px;">SL</th>
            <th>Product Name</th>
            <th>Color / Size</th>
            <th class="ctr" style="width:46px;">Qty</th>
            <th class="num" style="width:86px;">Unit Price</th>
            <th class="num" style="width:92px;">Total</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
      </table>

      <div class="pricing-card">
        <div>
          <div class="p-line">
            <span>Regular Total Price:</span>
            <strong class="mono" style="text-decoration:line-through; color:#64748b;">${escapeHtml(m.formatMoney(m.regularTotalPrice))}</strong>
          </div>
          <div class="p-line">
            <span>Discount (${m.discountPercent}%):</span>
            <strong class="mono" style="color:#0f766e;">-${escapeHtml(m.formatMoney(m.discountAmount))}</strong>
          </div>
          <div class="p-line">
            <span>Customer Savings:</span>
            <strong class="mono" style="color:#047857;">${escapeHtml(m.formatMoney(m.customerSavings))}</strong>
          </div>
        </div>
        <div class="final-price-wrap">
          <div class="final-label">Special Combo Offer Price</div>
          <div class="final-price mono">${escapeHtml(m.formatMoney(m.finalComboPrice))}</div>
          <div class="savings-line">Save ${escapeHtml(m.formatMoney(m.customerSavings))} (${m.discountPercent}% OFF)</div>
        </div>
      </div>

      <div class="doc-footer">
        <span>Customer Combo Preview · Stock is only reserved upon billing.</span>
        <span>${printer.showScaleGuidance ? `Format: ${format.toUpperCase()} · ` : ''}Powered by <strong style="color:#101B3F;">${escapeHtml(APP_IDENTITY.name)}</strong></span>
      </div>
    </div>
  `;

  return buildStandaloneDocument(`Combo Offer - ${m.comboName}`, bodyHtml, pageCss, extraStyles);
}

export function printComboOffer(
  offer: ComboOffer,
  products: Product[],
  settings: ShopSettings,
  format: ComboPrintFormat = 'a4',
  activeBranch?: Branch | null
): PrintResult {
  try {
    const html = buildComboOfferPrintHtml(offer, products, settings, format, activeBranch);
    return printDocument(html, `Combo Offer - ${offer.name}`);
  } catch (err: any) {
    return { opened: false, error: err?.message || 'Failed to prepare combo print document.' };
  }
}

async function loadImageForCanvasSafe(src: string): Promise<HTMLImageElement | null> {
  if (!src) return null;

  const loadFromSrc = (url: string): Promise<HTMLImageElement | null> =>
    new Promise(resolve => {
      const img = new Image();
      if (!url.startsWith('data:') && !url.startsWith('blob:')) {
        img.crossOrigin = 'anonymous';
      }
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = url;
    });

  if (src.startsWith('data:') || src.startsWith('blob:')) {
    return loadFromSrc(src);
  }

  try {
    const resp = await fetch(src, { mode: 'cors' });
    if (!resp.ok) return null;
    const blob = await resp.blob();
    const objUrl = URL.createObjectURL(blob);
    const img = await loadFromSrc(objUrl);
    window.setTimeout(() => URL.revokeObjectURL(objUrl), 2500);
    return img;
  } catch {
    return null;
  }
}

function wrapCanvasText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string[] {
  const words = (text || '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const lines: string[] = [];
  let current = words[0];

  for (let i = 1; i < words.length; i++) {
    const candidate = `${current} ${words[i]}`;
    if (ctx.measureText(candidate).width <= maxWidth) {
      current = candidate;
    } else {
      lines.push(current);
      current = words[i];
    }
  }
  lines.push(current);
  return lines;
}

function drawRoundedRect(
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

/**
 * Generate & download a crisp A4 or A5 vector-backed PDF matching the Combo Print design.
 * Uses native browser font canvas rendering so currency symbols (৳) and Bangla/English text
 * render cleanly without garbled glyphs or oklch CSS parser issues.
 */
export async function downloadComboOfferPdf(
  offer: ComboOffer,
  products: Product[],
  settings: ShopSettings,
  pageSize: ComboPdfFormat = 'a4',
  activeBranch?: Branch | null
): Promise<{ ok: boolean; filename?: string; error?: string }> {
  try {
    const m = resolveComboExportModel(offer, products, settings, activeBranch);
    const lang = settings.language || 'en';
    const pageWidthMm = pageSize === 'a5' ? 148 : 210;
    const pageHeightMm = pageSize === 'a5' ? 210 : 297;

    // 8 px/mm gives ultra-sharp print/PDF output
    const pxPerMm = 8;
    const canvasW = Math.round(pageWidthMm * pxPerMm);
    const canvasH = Math.round(pageHeightMm * pxPerMm);
    const isA5 = pageSize === 'a5';
    const marginPx = (isA5 ? 10 : 14) * pxPerMm;
    const contentW = canvasW - marginPx * 2;
    const s = isA5 ? 0.82 : 1; // proportional typography scaling for A5 vs A4

    const fontSans = `'Hind Siliguri', 'Noto Sans Bengali', 'Plus Jakarta Sans', system-ui, -apple-system, sans-serif`;
    const fontMono = `'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace`;

    const logoImg = await loadImageForCanvasSafe(m.logoUrl);

    const createPageCanvas = (): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } => {
      const canvas = document.createElement('canvas');
      canvas.width = canvasW;
      canvas.height = canvasH;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        throw new Error('Could not initialize PDF canvas renderer.');
      }
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvasW, canvasH);
      return { canvas, ctx };
    };

    const pages: HTMLCanvasElement[] = [];
    let { canvas, ctx } = createPageCanvas();
    pages.push(canvas);
    let y = marginPx;

    // 1. Header with Shop Logo, Name, Contacts & COMBO OFFER badge
    let logoOffsetX = 0;
    let logoBottomY = y;
    if (logoImg && logoImg.width > 0 && logoImg.height > 0) {
      const maxLogoH = 92 * s;
      const maxLogoW = 220 * s;
      const ratio = Math.min(maxLogoW / logoImg.width, maxLogoH / logoImg.height);
      const drawW = logoImg.width * ratio;
      const drawH = logoImg.height * ratio;
      ctx.drawImage(logoImg, marginPx, y, drawW, drawH);
      logoOffsetX = drawW + 24 * s;
      logoBottomY = y + drawH;
    }

    // Right badge
    ctx.font = `800 ${Math.round(21 * s)}px ${fontSans}`;
    const tagText = 'COMBO OFFER';
    const tagMetrics = ctx.measureText(tagText);
    const tagPadX = 20 * s;
    const tagW = tagMetrics.width + tagPadX * 2;
    const tagH = 44 * s;
    drawRoundedRect(ctx, marginPx + contentW - tagW, y, tagW, tagH, 8 * s);
    ctx.fillStyle = '#0f766e';
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(tagText, marginPx + contentW - tagW / 2, y + tagH / 2 + 1);

    let rightTextY = y + tagH + 14 * s;
    if (m.startDate) {
      ctx.font = `500 ${Math.round(20 * s)}px ${fontSans}`;
      ctx.fillStyle = '#475569';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'top';
      const validityStr = `Valid: ${formatDate(m.startDate, lang)}${
        m.endDate ? ` – ${formatDate(m.endDate, lang)}` : ''
      }`;
      ctx.fillText(validityStr, marginPx + contentW, rightTextY);
      rightTextY += 28 * s;
    }

    // Left Shop Details
    let leftTextY = y;
    const leftX = marginPx + logoOffsetX;
    const leftMaxW = contentW - logoOffsetX - tagW - 24 * s;

    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.font = `800 ${Math.round(36 * s)}px ${fontSans}`;
    ctx.fillStyle = '#101B3F';
    for (const line of wrapCanvasText(ctx, m.shopName, Math.max(260, leftMaxW))) {
      ctx.fillText(line, leftX, leftTextY);
      leftTextY += 44 * s;
    }

    const shopMetaLines: string[] = [];
    if (m.tagline) shopMetaLines.push(m.tagline);
    if (m.branchName) shopMetaLines.push(`Branch: ${m.branchName}`);
    if (m.address) shopMetaLines.push(m.address);
    const contacts = [m.mobile ? `Tel: ${m.mobile}` : '', m.email || ''].filter(Boolean).join(' | ');
    if (contacts) shopMetaLines.push(contacts);
    if (m.vatRegistrationNo) shopMetaLines.push(`VAT / BIN: ${m.vatRegistrationNo}`);

    ctx.font = `500 ${Math.round(21 * s)}px ${fontSans}`;
    ctx.fillStyle = '#475569';
    for (const rawLine of shopMetaLines) {
      for (const wrapped of wrapCanvasText(ctx, rawLine, Math.max(260, leftMaxW))) {
        ctx.fillText(wrapped, leftX, leftTextY);
        leftTextY += 28 * s;
      }
    }

    y = Math.max(leftTextY, logoBottomY, rightTextY) + 18 * s;

    // Header divider
    ctx.strokeStyle = '#101B3F';
    ctx.lineWidth = 4 * s;
    ctx.beginPath();
    ctx.moveTo(marginPx, y);
    ctx.lineTo(marginPx + contentW, y);
    ctx.stroke();
    y += 24 * s;

    // 2. Combo Banner (Category, Name, Description)
    ctx.font = `500 ${Math.round(22 * s)}px ${fontSans}`;
    const descLines = m.description ? wrapCanvasText(ctx, m.description, contentW - 56 * s) : [];
    ctx.font = `800 ${Math.round(34 * s)}px ${fontSans}`;
    const nameLines = wrapCanvasText(ctx, m.comboName, contentW - 56 * s);

    const bannerH =
      24 * s + // top pad
      38 * s + // category pill
      10 * s +
      nameLines.length * (42 * s) +
      (descLines.length > 0 ? 6 * s + descLines.length * (28 * s) : 0) +
      20 * s;

    drawRoundedRect(ctx, marginPx, y, contentW, bannerH, 10 * s);
    ctx.fillStyle = '#f8fafc';
    ctx.fill();
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Left teal accent bar
    ctx.fillStyle = '#0f766e';
    ctx.fillRect(marginPx, y + 2, 8 * s, bannerH - 4);

    let by = y + 22 * s;
    const bx = marginPx + 28 * s;

    ctx.font = `800 ${Math.round(19 * s)}px ${fontSans}`;
    const catText = m.comboCategory.toUpperCase();
    const catW = ctx.measureText(catText).width + 24 * s;
    drawRoundedRect(ctx, bx, by, catW, 34 * s, 6 * s);
    ctx.fillStyle = '#ccfbf1';
    ctx.fill();
    ctx.fillStyle = '#0f766e';
    ctx.textBaseline = 'middle';
    ctx.fillText(catText, bx + 12 * s, by + 17 * s);
    by += 44 * s;

    ctx.textBaseline = 'top';
    ctx.font = `800 ${Math.round(34 * s)}px ${fontSans}`;
    ctx.fillStyle = '#0f172a';
    for (const line of nameLines) {
      ctx.fillText(line, bx, by);
      by += 42 * s;
    }

    if (descLines.length > 0) {
      by += 6 * s;
      ctx.font = `500 ${Math.round(21 * s)}px ${fontSans}`;
      ctx.fillStyle = '#475569';
      for (const line of descLines) {
        ctx.fillText(line, bx, by);
        by += 28 * s;
      }
    }

    y += bannerH + 26 * s;

    // 3. Included Products Table
    const colWidths = {
      sl: Math.round(contentW * 0.06),
      name: Math.round(contentW * 0.34),
      variant: Math.round(contentW * 0.24),
      qty: Math.round(contentW * 0.08),
      unit: Math.round(contentW * 0.14),
      total: Math.round(contentW * 0.14),
    };

    const drawTableHeader = () => {
      const thH = 54 * s;
      ctx.fillStyle = '#f1f5f9';
      ctx.fillRect(marginPx, y, contentW, thH);
      ctx.strokeStyle = '#94a3b8';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(marginPx, y);
      ctx.lineTo(marginPx + contentW, y);
      ctx.moveTo(marginPx, y + thH);
      ctx.lineTo(marginPx + contentW, y + thH);
      ctx.stroke();

      ctx.font = `700 ${Math.round(20 * s)}px ${fontSans}`;
      ctx.fillStyle = '#334155';
      ctx.textBaseline = 'middle';

      let cx = marginPx;
      ctx.textAlign = 'center';
      ctx.fillText('SL', cx + colWidths.sl / 2, y + thH / 2);
      cx += colWidths.sl;

      ctx.textAlign = 'left';
      ctx.fillText('Product Name', cx + 10 * s, y + thH / 2);
      cx += colWidths.name;

      ctx.fillText('Color / Size', cx + 10 * s, y + thH / 2);
      cx += colWidths.variant;

      ctx.textAlign = 'center';
      ctx.fillText('Qty', cx + colWidths.qty / 2, y + thH / 2);
      cx += colWidths.qty;

      ctx.textAlign = 'right';
      ctx.fillText('Unit Price', cx + colWidths.unit - 10 * s, y + thH / 2);
      cx += colWidths.unit;

      ctx.fillText('Total', cx + colWidths.total - 10 * s, y + thH / 2);

      y += thH;
    };

    drawTableHeader();

    const footerReserveH = 260 * s;
    for (const row of m.items) {
      ctx.font = `700 ${Math.round(21 * s)}px ${fontSans}`;
      const prodLines = wrapCanvasText(
        ctx,
        `${row.productName}${row.isFree ? ' [FREE]' : ''}`,
        colWidths.name - 20 * s
      );
      ctx.font = `500 ${Math.round(20 * s)}px ${fontSans}`;
      const varLines = wrapCanvasText(ctx, row.variantDetails || 'Standard', colWidths.variant - 20 * s);
      const lineCount = Math.max(1, prodLines.length, varLines.length);
      const rowH = lineCount * (28 * s) + 26 * s;

      if (y + rowH > canvasH - marginPx - 90 * s) {
        const nextPage = createPageCanvas();
        canvas = nextPage.canvas;
        ctx = nextPage.ctx;
        pages.push(canvas);
        y = marginPx;
        drawTableHeader();
      }

      ctx.textBaseline = 'top';
      let cx = marginPx;
      const textStartY = y + 14 * s;

      ctx.font = `600 ${Math.round(20 * s)}px ${fontMono}`;
      ctx.fillStyle = '#475569';
      ctx.textAlign = 'center';
      ctx.fillText(String(row.index), cx + colWidths.sl / 2, textStartY);
      cx += colWidths.sl;

      ctx.font = `700 ${Math.round(21 * s)}px ${fontSans}`;
      ctx.fillStyle = '#0f172a';
      ctx.textAlign = 'left';
      prodLines.forEach((ln, li) => {
        ctx.fillText(ln, cx + 10 * s, textStartY + li * (28 * s));
      });
      cx += colWidths.name;

      ctx.font = `500 ${Math.round(20 * s)}px ${fontSans}`;
      ctx.fillStyle = '#334155';
      varLines.forEach((ln, li) => {
        ctx.fillText(ln, cx + 10 * s, textStartY + li * (28 * s));
      });
      cx += colWidths.variant;

      ctx.font = `700 ${Math.round(21 * s)}px ${fontMono}`;
      ctx.fillStyle = '#0f172a';
      ctx.textAlign = 'center';
      ctx.fillText(String(row.quantity), cx + colWidths.qty / 2, textStartY);
      cx += colWidths.qty;

      ctx.font = `500 ${Math.round(20 * s)}px ${fontMono}`;
      ctx.textAlign = 'right';
      ctx.fillText(row.isFree ? 'FREE' : m.formatMoney(row.unitPrice), cx + colWidths.unit - 10 * s, textStartY);
      cx += colWidths.unit;

      ctx.font = `700 ${Math.round(21 * s)}px ${fontMono}`;
      ctx.fillStyle = row.isFree ? '#047857' : '#0f172a';
      ctx.fillText(row.isFree ? 'FREE' : m.formatMoney(row.lineTotal), cx + colWidths.total - 10 * s, textStartY);

      y += rowH;
      ctx.strokeStyle = '#e2e8f0';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(marginPx, y);
      ctx.lineTo(marginPx + contentW, y);
      ctx.stroke();
    }

    // Check room for pricing summary + footer
    if (y + footerReserveH > canvasH - marginPx) {
      const nextPage = createPageCanvas();
      canvas = nextPage.canvas;
      ctx = nextPage.ctx;
      pages.push(canvas);
      y = marginPx;
    }

    y += 28 * s;

    // 4. Pricing & Savings Card
    const cardH = 164 * s;
    drawRoundedRect(ctx, marginPx, y, contentW, cardH, 12 * s);
    ctx.fillStyle = '#f0fdfa';
    ctx.fill();
    ctx.strokeStyle = '#0f766e';
    ctx.lineWidth = 3 * s;
    ctx.stroke();

    const leftCardX = marginPx + 28 * s;
    let ly = y + 26 * s;

    // Regular Total Price (with strikethrough)
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.font = `600 ${Math.round(22 * s)}px ${fontSans}`;
    ctx.fillStyle = '#334155';
    const regLabel = 'Regular Total Price: ';
    ctx.fillText(regLabel, leftCardX, ly);
    const regLabelW = ctx.measureText(regLabel).width;
    const regValStr = m.formatMoney(m.regularTotalPrice);
    ctx.font = `700 ${Math.round(22 * s)}px ${fontMono}`;
    ctx.fillStyle = '#64748b';
    ctx.fillText(regValStr, leftCardX + regLabelW, ly);
    const regValW = ctx.measureText(regValStr).width;
    ctx.strokeStyle = '#64748b';
    ctx.lineWidth = 2 * s;
    ctx.beginPath();
    ctx.moveTo(leftCardX + regLabelW, ly + 13 * s);
    ctx.lineTo(leftCardX + regLabelW + regValW, ly + 13 * s);
    ctx.stroke();
    ly += 38 * s;

    ctx.font = `600 ${Math.round(22 * s)}px ${fontSans}`;
    ctx.fillStyle = '#334155';
    const discLabel = `Discount (${m.discountPercent}%): `;
    ctx.fillText(discLabel, leftCardX, ly);
    ctx.font = `700 ${Math.round(22 * s)}px ${fontMono}`;
    ctx.fillStyle = '#0f766e';
    ctx.fillText(`-${m.formatMoney(m.discountAmount)}`, leftCardX + ctx.measureText(discLabel).width, ly);
    ly += 38 * s;

    ctx.font = `600 ${Math.round(22 * s)}px ${fontSans}`;
    ctx.fillStyle = '#334155';
    const savLabel = 'Customer Savings: ';
    ctx.fillText(savLabel, leftCardX, ly);
    ctx.font = `700 ${Math.round(22 * s)}px ${fontMono}`;
    ctx.fillStyle = '#047857';
    ctx.fillText(m.formatMoney(m.customerSavings), leftCardX + ctx.measureText(savLabel).width, ly);

    // Right Final Combo Price (Large Bold)
    const rightCardX = marginPx + contentW - 28 * s;
    ctx.textAlign = 'right';
    ctx.font = `800 ${Math.round(19 * s)}px ${fontSans}`;
    ctx.fillStyle = '#0f766e';
    ctx.fillText('SPECIAL COMBO OFFER PRICE', rightCardX, y + 24 * s);

    ctx.font = `900 ${Math.round(52 * s)}px ${fontMono}`;
    ctx.fillStyle = '#0f172a';
    ctx.fillText(m.formatMoney(m.finalComboPrice), rightCardX, y + 54 * s);

    ctx.font = `800 ${Math.round(23 * s)}px ${fontSans}`;
    ctx.fillStyle = '#047857';
    ctx.fillText(
      `Save ${m.formatMoney(m.customerSavings)} (${m.discountPercent}% OFF)`,
      rightCardX,
      y + 118 * s
    );

    // 5. Footer at bottom of last page
    const footY = canvasH - marginPx - 26 * s;
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(marginPx, footY - 14 * s);
    ctx.lineTo(marginPx + contentW, footY - 14 * s);
    ctx.stroke();

    ctx.font = `500 ${Math.round(18 * s)}px ${fontSans}`;
    ctx.fillStyle = '#64748b';
    ctx.textAlign = 'left';
    ctx.fillText('Customer Combo Preview · Stock is only reserved upon billing.', marginPx, footY);
    ctx.textAlign = 'right';
    ctx.fillText(`Powered by ${APP_IDENTITY.name}`, marginPx + contentW, footY);

    // Build jsPDF from canvas pages
    const pdf = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: pageSize,
      compress: true,
    });

    pages.forEach((pgCanvas, idx) => {
      if (idx > 0) pdf.addPage(pageSize, 'portrait');
      const imgData = pgCanvas.toDataURL('image/png');
      pdf.addImage(imgData, 'PNG', 0, 0, pageWidthMm, pageHeightMm, undefined, 'FAST');
    });

    const filename = buildComboPdfFilename(m.comboName, pageSize);
    pdf.save(filename);
    return { ok: true, filename };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Failed to generate combo PDF.' };
  }
}
