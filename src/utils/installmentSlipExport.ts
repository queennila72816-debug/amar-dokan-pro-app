import { jsPDF } from 'jspdf';
import {
  Branch,
  Customer,
  InstallmentAgreement,
  InstallmentPaymentRecord,
  InstallmentSlipLanguage,
  ShopSettings,
} from '../types';
import { resolveBusinessProfile } from '../config/appIdentity';
import { getShopLogo, printDocument, PrintResult } from './printEngine';
import {
  formatSlipCurrency,
  formatSlipDate,
  formatSlipNumber,
  maskNidNumber,
  toBnDigits,
} from './installmentUtils';

const escapeHtml = (unsafe: unknown): string => {
  return String(unsafe ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};

export interface SlipTextBundle {
  headerTitle: string;
  headerSubtitle: string;
  defaultMotto: string;
  customerInfo: string;
  customerName: string;
  customerId: string;
  mobile: string;
  address: string;
  nidLabel: string;
  identityDocuments: string;
  docOnFile: string;
  docPrivateNote: string;
  docOptionalNone: string;
  noPhoto: string;
  purchaseDetails: string;
  slCol: string;
  productNameCol: string;
  sizeCol: string;
  colorCol: string;
  qtyCol: string;
  unitPriceCol: string;
  totalPriceCol: string;
  totalPurchaseAmount: string;
  totalPurchaseCard: string;
  downPaymentCard: string;
  installmentBalanceCard: string;
  paymentDurationCard: string;
  monthsUnit: (n: number) => string;
  monthlyInstallment: string;
  firstDueDate: string;
  scheduleHeader: string;
  monthCol: string;
  dueDateCol: string;
  installmentAmountCol: string;
  statusCol: string;
  signatureCol: string;
  statusPaid: string;
  statusDue: string;
  statusPartial: string;
  statusOverdue: string;
  importantTerms: string;
  terms: (phone?: string) => string[];
  customerSignature: string;
  shopOwnerSignature: string;
  thankYouTitle: string;
  thankYouSub: string;
}

export function getSlipCopyTexts(lang: InstallmentSlipLanguage): SlipTextBundle {
  if (lang === 'en') {
    return {
      headerTitle: 'Installment Slip',
      headerSubtitle: '(Customer Installment Copy)',
      defaultMotto: 'Trust is Our Strength',
      customerInfo: 'Customer Information',
      customerName: 'Customer Name',
      customerId: 'Customer ID',
      mobile: 'Mobile',
      address: 'Address',
      nidLabel: 'NID',
      identityDocuments: 'Identity Documents',
      docOnFile: 'ID Verified & On File',
      docPrivateNote: 'Full NID images are kept private in store records',
      docOptionalNone: 'Optional · Not Provided',
      noPhoto: 'No Photo',
      purchaseDetails: 'Purchase Details',
      slCol: '#',
      productNameCol: 'Product Name',
      sizeCol: 'Size',
      colorCol: 'Color',
      qtyCol: 'Qty',
      unitPriceCol: 'Unit Price',
      totalPriceCol: 'Total Price',
      totalPurchaseAmount: 'Total Purchase Amount',
      totalPurchaseCard: 'Total Purchase',
      downPaymentCard: 'Down Payment',
      installmentBalanceCard: 'Installment Balance',
      paymentDurationCard: 'Payment Duration',
      monthsUnit: (n: number) => `${n} ${n === 1 ? 'Month' : 'Months'}`,
      monthlyInstallment: 'Monthly Installment',
      firstDueDate: 'First Due Date',
      scheduleHeader: 'Installment Payment Schedule (Max 6 Months)',
      monthCol: 'Month',
      dueDateCol: 'Due Date',
      installmentAmountCol: 'Installment Amount',
      statusCol: 'Status',
      signatureCol: 'Signature',
      statusPaid: 'Paid',
      statusDue: 'Due',
      statusPartial: 'Partial',
      statusOverdue: 'Overdue',
      importantTerms: 'Important Terms',
      terms: (phone?: string) => {
        const list = [
          'Please pay each installment on or before the scheduled due date.',
          'Additional late charges may apply if any monthly installment is missed.',
          'Do not sell or transfer installment products to any third party before full settlement.',
        ];
        if (phone && phone.trim()) {
          list.push(`For any inquiry or assistance, contact: ${phone.trim()}`);
        }
        return list;
      },
      customerSignature: 'Customer Signature',
      shopOwnerSignature: 'Shop Owner Signature',
      thankYouTitle: 'Thank You',
      thankYouSub: 'for your Trust',
    };
  }

  if (lang === 'both') {
    return {
      headerTitle: 'Installment Slip',
      headerSubtitle: '(কিস্তির কাস্টমার স্লিপ)',
      defaultMotto: 'বিশ্বাসই আমাদের শক্তি · Trust is Our Strength',
      customerInfo: 'Customer Information / গ্রাহকের তথ্য',
      customerName: 'Name / নাম',
      customerId: 'ID / আইডি',
      mobile: 'Mobile / মোবাইল',
      address: 'Address / ঠিকানা',
      nidLabel: 'NID / এনআইডি',
      identityDocuments: 'Identity / পরিচয়পত্র',
      docOnFile: 'Verified / সংরক্ষিত',
      docPrivateNote: 'পূর্ণ এনআইডি ছবি প্রাইভেট রেকর্ডে সংরক্ষিত',
      docOptionalNone: 'Optional / সংযুক্ত নয়',
      noPhoto: 'ছবি নেই / No Photo',
      purchaseDetails: 'Purchase Details / পণ্যের বিবরণ',
      slCol: '#',
      productNameCol: 'Product Name / পণ্যের নাম',
      sizeCol: 'Size',
      colorCol: 'Color',
      qtyCol: 'Qty',
      unitPriceCol: 'Unit Price',
      totalPriceCol: 'Total Price',
      totalPurchaseAmount: 'মোট ক্রয়মূল্য / Total Purchase Amount',
      totalPurchaseCard: 'মোট ক্রয় / Total Purchase',
      downPaymentCard: 'অগ্রিম জমা / Down Payment',
      installmentBalanceCard: 'বাকি টাকা / Installment Balance',
      paymentDurationCard: 'মেয়াদ / Payment Duration',
      monthsUnit: (n: number) => `${toBnDigits(n)} মাস (${n}M)`,
      monthlyInstallment: 'মাসিক কিস্তি / Monthly Installment',
      firstDueDate: 'প্রথম কিস্তির তারিখ / First Due Date',
      scheduleHeader: 'Installment Payment Schedule / কিস্তি পরিশোধের তালিকা (সর্বোচ্চ ৬ মাস)',
      monthCol: 'Month / মাস',
      dueDateCol: 'Due Date / তারিখ',
      installmentAmountCol: 'Amount / কিস্তির টাকা',
      statusCol: 'Status / অবস্থা',
      signatureCol: 'Signature / স্বাক্ষর',
      statusPaid: 'পরিশোধিত / Paid',
      statusDue: 'বাকি / Due',
      statusPartial: 'আংশিক / Partial',
      statusOverdue: 'মেয়াদোত্তীর্ণ / Overdue',
      importantTerms: 'গুরুত্বপূর্ণ শর্তাবলি / Important Terms',
      terms: (phone?: string) => {
        const list = [
          'নির্ধারিত তারিখে কিস্তির টাকা পরিশোধ করুন। (Pay on due date.)',
          'কোনো মাস মিস হলে অতিরিক্ত চার্জ প্রযোজ্য হতে পারে। (Late fees may apply.)',
          'কিস্তির পণ্য অন্য কাউকে বিক্রি বা হস্তান্তর করবেন না। (No transfer before payoff.)',
        ];
        if (phone && phone.trim()) {
          list.push(`যেকোনো সমস্যায় যোগাযোগ করুন / Contact: ${phone.trim()}`);
        }
        return list;
      },
      customerSignature: 'গ্রাহকের স্বাক্ষর / Customer Signature',
      shopOwnerSignature: 'দোকান মালিকের স্বাক্ষর / Owner Signature',
      thankYouTitle: 'Thank You / ধন্যবাদ',
      thankYouSub: 'বিশ্বাস ও আস্থার জন্য · for your Trust',
    };
  }

  // Default: Bangla ('bn')
  return {
    headerTitle: 'কিস্তির স্লিপ',
    headerSubtitle: '(গ্রাহকের কপি)',
    defaultMotto: 'বিশ্বাসই আমাদের শক্তি',
    customerInfo: 'গ্রাহকের তথ্য',
    customerName: 'গ্রাহকের নাম',
    customerId: 'গ্রাহক আইডি',
    mobile: 'মোবাইল',
    address: 'ঠিকানা',
    nidLabel: 'এনআইডি',
    identityDocuments: 'পরিচয়পত্র যাচাই',
    docOnFile: 'পরিচয়পত্র সংরক্ষিত',
    docPrivateNote: 'নিরাপত্তার স্বার্থে পূর্ণ এনআইডি ছবি কপিতে প্রদর্শিত নয়',
    docOptionalNone: 'ঐচ্ছিক · সংযুক্ত নয়',
    noPhoto: 'ছবি নেই',
    purchaseDetails: 'পণ্যের বিবরণ',
    slCol: '#',
    productNameCol: 'পণ্যের নাম',
    sizeCol: 'সাইজ',
    colorCol: 'রং',
    qtyCol: 'পরিমাণ',
    unitPriceCol: 'একক মূল্য',
    totalPriceCol: 'মোট মূল্য',
    totalPurchaseAmount: 'মোট ক্রয়মূল্য',
    totalPurchaseCard: 'মোট ক্রয়',
    downPaymentCard: 'অগ্রিম জমা',
    installmentBalanceCard: 'কিস্তির বাকি টাকা',
    paymentDurationCard: 'পরিশোধের মেয়াদ',
    monthsUnit: (n: number) => `${toBnDigits(n)} মাস`,
    monthlyInstallment: 'মাসিক কিস্তি',
    firstDueDate: 'প্রথম কিস্তির তারিখ',
    scheduleHeader: 'কিস্তি পরিশোধের তালিকা (সর্বোচ্চ ৬ মাস)',
    monthCol: 'মাস',
    dueDateCol: 'কিস্তির তারিখ',
    installmentAmountCol: 'কিস্তির টাকা',
    statusCol: 'অবস্থা',
    signatureCol: 'স্বাক্ষর',
    statusPaid: 'পরিশোধিত',
    statusDue: 'বাকি',
    statusPartial: 'আংশিক',
    statusOverdue: 'মেয়াদোত্তীর্ণ',
    importantTerms: 'গুরুত্বপূর্ণ শর্তাবলি',
    terms: (phone?: string) => {
      const list = [
        'নির্ধারিত তারিখে কিস্তির টাকা পরিশোধ করুন।',
        'কোনো মাস মিস হলে অতিরিক্ত চার্জ প্রযোজ্য হতে পারে।',
        'কিস্তির পণ্য অন্য কাউকে বিক্রি বা হস্তান্তর করবেন না।',
      ];
      if (phone && phone.trim()) {
        list.push(`কোনো সমস্যায় যোগাযোগ করুন : ${phone.trim()}`);
      }
      return list;
    },
    customerSignature: 'গ্রাহকের স্বাক্ষর',
    shopOwnerSignature: 'দোকান মালিকের স্বাক্ষর',
    thankYouTitle: 'ধন্যবাদ',
    thankYouSub: 'বিশ্বাস ও আস্থার জন্য',
  };
}

/**
 * Generates exact visual Customer Installment Slip HTML matching the reference layout.
 * STRICT RULE: Never includes Last Payment Date or Remaining Due on printed/PDF Customer Copy.
 */
export function buildInstallmentSlipHtml(params: {
  agreement: InstallmentAgreement;
  settings: ShopSettings;
  activeBranch?: Branch | null;
  customer?: Customer | null;
  language?: InstallmentSlipLanguage;
}): string {
  const { agreement, settings, activeBranch, customer, language = 'bn' } = params;
  const biz = resolveBusinessProfile(settings, activeBranch);
  const logoSrc = getShopLogo(settings) || biz.logoUrl;
  const t = getSlipCopyTexts(language);

  const shopName = biz.shopName?.trim() || '';
  const tagline = biz.tagline?.trim() || '';
  const address = biz.address?.trim() || '';
  const mobile = biz.mobile?.trim() || '';
  const email = biz.email?.trim() || '';
  const motto = tagline || t.defaultMotto;

  const photoUrl = agreement.customerPhotoUrl || customer?.photoUrl || '';
  const rawNid = agreement.customerNidNumber || customer?.nidNumber || '';
  const maskedNid = maskNidNumber(rawNid);
  const hasIdentityDocs = Boolean(
    agreement.hasIdentityDocuments ||
      rawNid ||
      customer?.nidFrontUrl ||
      customer?.nidBackUrl
  );

  const customerCode = agreement.customerCode || customer?.customerCode || agreement.customerId.slice(0, 8);
  const custAddress = agreement.customerAddress || customer?.address || '';
  const termsList = t.terms(mobile);

  const itemRowsHtml =
    agreement.items.length > 0
      ? agreement.items
          .map(
            (item, idx) => `
          <tr>
            <td class="col-sl">${escapeHtml(formatSlipNumber(idx + 1, language))}</td>
            <td class="col-name">${escapeHtml(item.productName)}</td>
            <td class="col-center">${escapeHtml(item.size || '—')}</td>
            <td class="col-center">${escapeHtml(item.color || '—')}</td>
            <td class="col-center">${escapeHtml(formatSlipNumber(item.quantity, language))}</td>
            <td class="col-right">${escapeHtml(formatSlipCurrency(item.unitPrice, language))}</td>
            <td class="col-right bold">${escapeHtml(formatSlipCurrency(item.totalPrice, language))}</td>
          </tr>
        `
          )
          .join('')
      : `
        <tr>
          <td class="col-sl">${escapeHtml(formatSlipNumber(1, language))}</td>
          <td class="col-name">${escapeHtml(agreement.agreementCode)}</td>
          <td class="col-center">—</td>
          <td class="col-center">—</td>
          <td class="col-center">${escapeHtml(formatSlipNumber(1, language))}</td>
          <td class="col-right">${escapeHtml(formatSlipCurrency(agreement.totalPurchaseAmount, language))}</td>
          <td class="col-right bold">${escapeHtml(formatSlipCurrency(agreement.totalPurchaseAmount, language))}</td>
        </tr>
      `;

  const scheduleRowsHtml = agreement.schedule
    .map(row => {
      const monthLabel =
        language === 'bn'
          ? row.labelBn
          : language === 'both'
          ? `${row.labelBn} (${row.labelEn})`
          : row.labelEn;

      const statusBadge =
        row.status === 'paid'
          ? `<span class="badge badge-paid">${escapeHtml(t.statusPaid)} ✓</span>`
          : row.status === 'partial'
          ? `<span class="badge badge-partial">${escapeHtml(t.statusPartial)}</span>`
          : row.status === 'overdue'
          ? `<span class="badge badge-overdue">${escapeHtml(t.statusOverdue)}</span>`
          : `<span class="badge badge-due">${escapeHtml(t.statusDue)}</span>`;

      const sigText = row.signatureText?.trim()
        ? escapeHtml(row.signatureText)
        : row.status === 'paid'
        ? '✓'
        : '—';

      return `
        <tr>
          <td class="col-sl">${escapeHtml(formatSlipNumber(row.installmentNumber, language))}</td>
          <td class="col-month">${escapeHtml(monthLabel)}</td>
          <td class="col-center">${escapeHtml(formatSlipDate(row.dueDate, language))}</td>
          <td class="col-right bold">${escapeHtml(formatSlipCurrency(row.amount, language))}</td>
          <td class="col-center">${statusBadge}</td>
          <td class="col-center sig-cell">${sigText}</td>
        </tr>
      `;
    })
    .join('');

  return `<!DOCTYPE html>
<html lang="${language === 'en' ? 'en' : 'bn'}" class="installment-slip-doc">
<head>
  <meta charset="UTF-8" />
  <title>${escapeHtml(t.headerTitle)} · ${escapeHtml(agreement.agreementCode)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Hind+Siliguri:wght@400;500;600;700&family=Noto+Sans+Bengali:wght@400;500;600;700;800&family=Plus+Jakarta+Sans:wght@400;600;700;800&display=swap" rel="stylesheet" />
  <style>
    @page {
      size: A4 portrait;
      margin: 0;
    }
    .slip-sheet,
    .slip-sheet * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    html.installment-slip-doc,
    html.installment-slip-doc body {
      margin: 0;
      padding: 0;
      background: #ffffff;
    }
    .slip-sheet {
      width: 210mm;
      min-height: 296mm;
      background: #ffffff;
      color: #0F172A;
      font-family: 'Noto Sans Bengali', 'Hind Siliguri', 'Plus Jakarta Sans', system-ui, sans-serif;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
      position: relative;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      overflow: hidden;
    }

    /* TOP WAVE HEADER */
    .top-header {
      position: relative;
      height: 36mm;
      background: #ffffff;
      overflow: hidden;
      flex-shrink: 0;
    }
    .header-svg-bg {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      z-index: 1;
    }
    .header-content {
      position: relative;
      z-index: 2;
      display: flex;
      justify-content: space-between;
      align-items: stretch;
      height: 100%;
      padding: 4.5mm 7mm 6mm 7mm;
    }
    .brand-zone {
      display: flex;
      align-items: center;
      gap: 3.5mm;
      width: 58%;
      padding-bottom: 3mm;
    }
    .shop-logo-box {
      width: 18mm;
      height: 18mm;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    .shop-logo-box img {
      max-width: 100%;
      max-height: 100%;
      object-fit: contain;
    }
    .shop-title-block {
      min-width: 0;
      max-width: 44mm;
    }
    .shop-name {
      font-size: 15pt;
      font-weight: 800;
      line-height: 1.15;
      color: #0B2A6B;
      word-break: break-word;
    }
    .shop-tagline {
      font-size: 8.5pt;
      font-weight: 600;
      font-style: italic;
      color: #0E7490;
      margin-top: 1mm;
      line-height: 1.25;
    }
    .contact-divider {
      width: 1px;
      height: 16mm;
      background: #94A3B8;
      flex-shrink: 0;
    }
    .shop-contacts {
      display: flex;
      flex-direction: column;
      gap: 1.3mm;
      font-size: 8pt;
      color: #1E293B;
      min-width: 0;
      flex: 1;
    }
    .contact-row {
      display: flex;
      align-items: flex-start;
      gap: 1.5mm;
      line-height: 1.25;
    }
    .contact-ico {
      width: 3.6mm;
      height: 3.6mm;
      color: #0B2A6B;
      flex-shrink: 0;
      margin-top: 0.3mm;
    }

    .right-title-zone {
      width: 39%;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      text-align: center;
      color: #ffffff;
      padding-left: 4mm;
      padding-bottom: 2.5mm;
    }
    .slip-main-title {
      font-size: 16.5pt;
      font-weight: 800;
      color: #ffffff;
      line-height: 1.15;
      letter-spacing: 0.01em;
    }
    .slip-sub-title {
      font-size: 10pt;
      font-weight: 600;
      color: #E2E8F0;
      margin-top: 0.8mm;
    }
    .motto-wrap {
      display: flex;
      align-items: center;
      gap: 2mm;
      margin-top: 2mm;
      width: 100%;
      justify-content: center;
    }
    .motto-line {
      height: 1px;
      flex: 1;
      max-width: 8mm;
      background: rgba(255,255,255,0.65);
    }
    .motto-pill {
      background: #FACC15;
      color: #0B2A6B;
      font-size: 8pt;
      font-weight: 800;
      padding: 0.8mm 3.5mm;
      border-radius: 999px;
      white-space: nowrap;
      max-width: 58mm;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    /* MAIN BODY */
    .slip-body {
      padding: 2.5mm 7mm 2mm 7mm;
      display: flex;
      flex-direction: column;
      gap: 3mm;
      flex: 1;
    }

    /* ROW 2: CUSTOMER PHOTO + INFO + IDENTITY DOCS */
    .customer-strip {
      display: grid;
      grid-template-columns: 26mm 1fr 56mm;
      gap: 3.5mm;
      align-items: stretch;
    }
    .cust-photo-frame {
      width: 26mm;
      height: 30mm;
      border-radius: 3mm;
      border: 1.6px solid #1D4ED8;
      background: #F8FAFC;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
    }
    .cust-photo-frame img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    .cust-photo-empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 1mm;
      color: #64748B;
      font-size: 7.5pt;
      font-weight: 600;
      text-align: center;
      padding: 2mm;
    }

    .cust-info-col {
      display: flex;
      flex-direction: column;
      justify-content: flex-start;
    }
    .pill-heading {
      display: inline-flex;
      align-items: center;
      gap: 1.5mm;
      background: #0B2A6B;
      color: #ffffff;
      font-size: 9pt;
      font-weight: 700;
      padding: 1mm 4mm;
      border-radius: 999px;
      width: fit-content;
      margin-bottom: 1.8mm;
    }
    .cust-kv-grid {
      display: grid;
      grid-template-columns: 27mm 4mm 1fr;
      row-gap: 1.1mm;
      font-size: 8.5pt;
      line-height: 1.3;
    }
    .cust-k {
      font-weight: 700;
      color: #0F172A;
    }
    .cust-colon {
      font-weight: 700;
      color: #475569;
    }
    .cust-v {
      font-weight: 600;
      color: #1E293B;
      word-break: break-word;
    }

    .identity-box {
      border: 1.4px solid #1E40AF;
      border-radius: 3mm;
      overflow: hidden;
      background: #F8FAFC;
      display: flex;
      flex-direction: column;
    }
    .identity-box-head {
      background: #0B2A6B;
      color: #ffffff;
      font-size: 8.5pt;
      font-weight: 700;
      text-align: center;
      padding: 1.1mm 2mm;
    }
    .identity-box-body {
      flex: 1;
      padding: 2mm 2.5mm;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      text-align: center;
      gap: 1.2mm;
    }
    .id-status-pill {
      display: inline-flex;
      align-items: center;
      gap: 1mm;
      font-size: 7.8pt;
      font-weight: 700;
      padding: 0.7mm 2.5mm;
      border-radius: 999px;
    }
    .id-verified {
      background: #DCFCE7;
      color: #166534;
      border: 1px solid #86EFAC;
    }
    .id-optional {
      background: #E2E8F0;
      color: #475569;
    }
    .id-masked-num {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 8pt;
      font-weight: 700;
      color: #0B2A6B;
    }
    .id-note {
      font-size: 6.8pt;
      color: #64748B;
      line-height: 1.25;
    }

    /* TABLES */
    .section-block {
      display: flex;
      flex-direction: column;
      break-inside: avoid;
    }
    .section-pill-bar {
      display: inline-flex;
      align-items: center;
      gap: 2mm;
      background: #0B2A6B;
      color: #ffffff;
      font-size: 9.2pt;
      font-weight: 700;
      padding: 1.3mm 4.5mm;
      border-radius: 2.5mm 2.5mm 0 0;
      width: fit-content;
    }
    .section-full-bar {
      display: flex;
      align-items: center;
      gap: 2mm;
      background: #0B2A6B;
      color: #ffffff;
      font-size: 9.2pt;
      font-weight: 700;
      padding: 1.5mm 4mm;
      border-radius: 2.5mm 2.5mm 0 0;
      width: 100%;
    }
    table.slip-table {
      width: 100%;
      border-collapse: collapse;
      border: 1.4px solid #1E40AF;
      font-size: 8.3pt;
    }
    table.slip-table th {
      background: #EFF6FF;
      color: #0F172A;
      font-weight: 700;
      padding: 1.4mm 2mm;
      border: 1px solid #93C5FD;
      text-align: center;
    }
    table.slip-table th.col-left {
      text-align: left;
    }
    table.slip-table td {
      padding: 1.3mm 2mm;
      border: 1px solid #CBD5E1;
      color: #0F172A;
      vertical-align: middle;
    }
    table.slip-table tbody tr:nth-child(even) td {
      background: #FAFBFD;
    }
    .col-sl { text-align: center; width: 9mm; font-weight: 600; }
    .col-name { text-align: left; font-weight: 600; }
    .col-month { text-align: left; font-weight: 600; }
    .col-center { text-align: center; }
    .col-right { text-align: right; font-variant-numeric: tabular-nums; }
    .bold { font-weight: 700; }
    .sig-cell { color: #475569; font-style: italic; }

    .total-summary-row td {
      background: #EFF6FF !important;
      border-top: 1.4px solid #1E40AF !important;
      font-weight: 800;
      font-size: 9pt;
      color: #0B2A6B;
      padding: 1.6mm 2.5mm !important;
    }

    /* 4 KPI CARDS */
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 3mm;
      break-inside: avoid;
    }
    .kpi-card {
      border-radius: 2.8mm;
      padding: 2.3mm 3mm;
      color: #ffffff;
      display: flex;
      align-items: center;
      gap: 2.5mm;
      box-shadow: 0 1px 3px rgba(15, 23, 42, 0.12);
    }
    .kpi-blue { background: #124191; }
    .kpi-green { background: #15803D; }
    .kpi-purple { background: #7E22CE; }
    .kpi-ico {
      width: 7mm;
      height: 7mm;
      flex-shrink: 0;
      opacity: 0.95;
    }
    .kpi-text {
      min-width: 0;
    }
    .kpi-label {
      font-size: 7.4pt;
      font-weight: 600;
      opacity: 0.95;
      line-height: 1.2;
    }
    .kpi-value {
      font-size: 12pt;
      font-weight: 800;
      line-height: 1.2;
      margin-top: 0.4mm;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }

    /* MONTHLY STRIP */
    .monthly-strip {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 3mm;
      padding: 1.5mm 3mm;
      background: #F8FAFC;
      border: 1px solid #CBD5E1;
      border-radius: 2mm;
      font-size: 9pt;
      font-weight: 700;
      color: #0B2A6B;
      break-inside: avoid;
    }
    .strip-sep {
      color: #94A3B8;
      font-weight: 400;
    }

    /* STATUS BADGES */
    .badge {
      display: inline-block;
      padding: 0.5mm 3mm;
      border-radius: 999px;
      font-size: 7.4pt;
      font-weight: 700;
      white-space: nowrap;
    }
    .badge-paid { background: #15803D; color: #ffffff; }
    .badge-due { background: #F59E0B; color: #1E293B; }
    .badge-partial { background: #0284C7; color: #ffffff; }
    .badge-overdue { background: #DC2626; color: #ffffff; }

    /* IMPORTANT TERMS CARD (FULL CLEAN WIDTH — NO LAST PAYMENT / REMAINING DUE!) */
    .terms-card {
      border: 1.3px solid #94A3B8;
      border-radius: 3mm;
      background: #F8FAFC;
      padding: 2.5mm 3.5mm;
      break-inside: avoid;
    }
    .terms-title {
      display: flex;
      align-items: center;
      gap: 1.8mm;
      font-size: 9pt;
      font-weight: 800;
      color: #0B2A6B;
      margin-bottom: 1.4mm;
    }
    .terms-list {
      list-style: none;
      display: grid;
      grid-template-columns: 1fr;
      gap: 0.9mm;
      font-size: 8pt;
      color: #1E293B;
    }
    .terms-list li {
      display: flex;
      align-items: flex-start;
      gap: 1.6mm;
      line-height: 1.3;
    }
    .term-check {
      color: #0B2A6B;
      font-weight: 800;
      flex-shrink: 0;
    }

    /* SIGNATURES & THANK YOU FOOTER */
    .footer-area {
      position: relative;
      padding-top: 2mm;
      break-inside: avoid;
      flex-shrink: 0;
    }
    .signatures-row {
      padding: 0 7mm 2.5mm 7mm;
      display: grid;
      grid-template-columns: 1fr auto 1fr;
      align-items: end;
      gap: 5mm;
    }
    .sig-block {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 1.5mm;
    }
    .sig-line {
      width: 48mm;
      border-bottom: 1.3px dotted #475569;
      height: 9mm;
    }
    .sig-pill {
      background: #DBEAFE;
      color: #0B2A6B;
      font-size: 8.2pt;
      font-weight: 700;
      padding: 1mm 4mm;
      border-radius: 999px;
      white-space: nowrap;
    }
    .thank-you-banner {
      background: #0B2A6B;
      color: #ffffff;
      padding: 2.2mm 8mm;
      border-radius: 4mm 4mm 1mm 1mm;
      text-align: center;
      box-shadow: 0 2px 6px rgba(11, 42, 107, 0.25);
    }
    .thank-you-title {
      font-size: 13pt;
      font-weight: 800;
      font-style: italic;
      line-height: 1.15;
    }
    .thank-you-sub {
      font-size: 8pt;
      font-weight: 600;
      color: #E2E8F0;
      margin-top: 0.4mm;
    }
    .bottom-wave-svg {
      width: 100%;
      height: 10mm;
      display: block;
    }

    @media print {
      .slip-sheet {
        min-height: 296mm;
      }
      table.slip-table tr {
        break-inside: avoid;
      }
    }
  </style>
</head>
<body>
  <div class="slip-sheet">
    <div>
      <!-- TOP CURVED WAVE HEADER -->
      <header class="top-header">
        <svg class="header-svg-bg" viewBox="0 0 800 140" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M 480 0 L 800 0 L 800 112 Q 635 130 500 92 Q 465 50 480 0 Z" fill="#0B2A6B" />
          <path d="M 0 124 Q 260 105 510 118 Q 660 126 800 102 L 800 116 Q 660 138 510 128 Q 260 114 0 132 Z" fill="#0EA5E9" />
          <path d="M 0 132 Q 260 114 510 128 Q 660 138 800 116 L 800 123 Q 660 140 510 132 Q 260 120 0 136 Z" fill="#0B2A6B" />
        </svg>

        <div class="header-content">
          <div class="brand-zone">
            ${
              logoSrc
                ? `<div class="shop-logo-box"><img src="${escapeHtml(logoSrc)}" alt="${escapeHtml(shopName || 'Shop Logo')}" /></div>`
                : ''
            }
            <div class="shop-title-block">
              ${shopName ? `<div class="shop-name">${escapeHtml(shopName)}</div>` : ''}
              ${tagline ? `<div class="shop-tagline">${escapeHtml(tagline)}</div>` : ''}
            </div>
            ${
              address || mobile || email
                ? `<div class="contact-divider"></div>
                   <div class="shop-contacts">
                     ${
                       address
                         ? `<div class="contact-row">
                              <svg class="contact-ico" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 010-5 2.5 2.5 0 010 5z"/></svg>
                              <span>${escapeHtml(address)}</span>
                            </div>`
                         : ''
                     }
                     ${
                       mobile
                         ? `<div class="contact-row">
                              <svg class="contact-ico" viewBox="0 0 24 24" fill="currentColor"><path d="M6.62 10.79a15.05 15.05 0 006.59 6.59l2.2-2.2a1 1 0 011.01-.24c1.12.37 2.33.57 3.58.57a1 1 0 011 1V20a1 1 0 01-1 1C10.61 21 3 13.39 3 4a1 1 0 011-1h3.5a1 1 0 011 1c0 1.25.2 2.46.57 3.58a1 1 0 01-.25 1.01l-2.2 2.2z"/></svg>
                              <span>${escapeHtml(mobile)}</span>
                            </div>`
                         : ''
                     }
                     ${
                       email
                         ? `<div class="contact-row">
                              <svg class="contact-ico" viewBox="0 0 24 24" fill="currentColor"><path d="M20 4H4a2 2 0 00-2 2v12a2 2 0 002 2h16a2 2 0 002-2V6a2 2 0 00-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z"/></svg>
                              <span>${escapeHtml(email)}</span>
                            </div>`
                         : ''
                     }
                   </div>`
                : ''
            }
          </div>

          <div class="right-title-zone">
            <div class="slip-main-title">${escapeHtml(t.headerTitle)}</div>
            <div class="slip-sub-title">${escapeHtml(t.headerSubtitle)}</div>
            <div class="motto-wrap">
              <span class="motto-line"></span>
              <span class="motto-pill">— ${escapeHtml(motto)} —</span>
              <span class="motto-line"></span>
            </div>
          </div>
        </div>
      </header>

      <div class="slip-body">
        <!-- ROW 2: CUSTOMER PHOTO + CUSTOMER INFO + IDENTITY DOCUMENTS -->
        <section class="customer-strip">
          <div class="cust-photo-frame">
            ${
              photoUrl
                ? `<img src="${escapeHtml(photoUrl)}" alt="${escapeHtml(agreement.customerName)}" />`
                : `<div class="cust-photo-empty">
                     <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#94A3B8" stroke-width="1.8">
                       <circle cx="12" cy="8" r="4"/>
                       <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>
                     </svg>
                     <span>${escapeHtml(t.noPhoto)}</span>
                   </div>`
            }
          </div>

          <div class="cust-info-col">
            <div class="pill-heading">${escapeHtml(t.customerInfo)}</div>
            <div class="cust-kv-grid">
              <span class="cust-k">${escapeHtml(t.customerName)}</span>
              <span class="cust-colon">:</span>
              <span class="cust-v">${escapeHtml(agreement.customerName)}</span>

              <span class="cust-k">${escapeHtml(t.customerId)}</span>
              <span class="cust-colon">:</span>
              <span class="cust-v">${escapeHtml(customerCode)} (${escapeHtml(agreement.agreementCode)})</span>

              <span class="cust-k">${escapeHtml(t.mobile)}</span>
              <span class="cust-colon">:</span>
              <span class="cust-v">${escapeHtml(agreement.customerMobile || '—')}</span>

              ${
                custAddress
                  ? `<span class="cust-k">${escapeHtml(t.address)}</span>
                     <span class="cust-colon">:</span>
                     <span class="cust-v">${escapeHtml(custAddress)}</span>`
                  : ''
              }
              ${
                maskedNid
                  ? `<span class="cust-k">${escapeHtml(t.nidLabel)}</span>
                     <span class="cust-colon">:</span>
                     <span class="cust-v" style="font-family:monospace;">${escapeHtml(maskedNid)}</span>`
                  : ''
              }
            </div>
          </div>

          <div class="identity-box">
            <div class="identity-box-head">${escapeHtml(t.identityDocuments)}</div>
            <div class="identity-box-body">
              ${
                hasIdentityDocs
                  ? `<span class="id-status-pill id-verified">✓ ${escapeHtml(t.docOnFile)}</span>
                     ${maskedNid ? `<span class="id-masked-num">${escapeHtml(t.nidLabel)}: ${escapeHtml(maskedNid)}</span>` : ''}
                     <span class="id-note">${escapeHtml(t.docPrivateNote)}</span>`
                  : `<span class="id-status-pill id-optional">${escapeHtml(t.docOptionalNone)}</span>`
              }
            </div>
          </div>
        </section>

        <!-- ROW 3: PURCHASE DETAILS TABLE -->
        <section class="section-block">
          <div class="section-pill-bar">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M18 6h-2c0-2.21-1.79-4-4-4S8 3.79 8 6H6c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm-6-2c1.1 0 2 .9 2 2h-4c0-1.1.9-2 2-2z"/></svg>
            <span>${escapeHtml(t.purchaseDetails)}</span>
          </div>
          <table class="slip-table">
            <thead>
              <tr>
                <th>${escapeHtml(t.slCol)}</th>
                <th class="col-left">${escapeHtml(t.productNameCol)}</th>
                <th>${escapeHtml(t.sizeCol)}</th>
                <th>${escapeHtml(t.colorCol)}</th>
                <th>${escapeHtml(t.qtyCol)}</th>
                <th>${escapeHtml(t.unitPriceCol)}</th>
                <th>${escapeHtml(t.totalPriceCol)}</th>
              </tr>
            </thead>
            <tbody>
              ${itemRowsHtml}
              <tr class="total-summary-row">
                <td colspan="6" style="text-align:center;">${escapeHtml(t.totalPurchaseAmount)}</td>
                <td class="col-right">${escapeHtml(formatSlipCurrency(agreement.totalPurchaseAmount, language))}</td>
              </tr>
            </tbody>
          </table>
        </section>

        <!-- ROW 4: 4 COLORED SUMMARY CARDS -->
        <section class="kpi-grid">
          <div class="kpi-card kpi-blue">
            <svg class="kpi-ico" viewBox="0 0 24 24" fill="currentColor"><path d="M7 18c-1.1 0-1.99.9-1.99 2S5.9 22 7 22s2-.9 2-2-.9-2-2-2zm10 0c-1.1 0-1.99.9-1.99 2s.89 2 1.99 2 2-.9 2-2-.9-2-2-2zM7.16 14.26l.04-.12.9-1.63h7.45c.75 0 1.41-.41 1.75-1.03l3.58-6.49A1 1 0 0020 3.5H5.21l-.94-2H1v2h2l3.6 7.59-1.35 2.44C4.52 14.37 5.48 16 7 16h12v-2H7.42c-.14 0-.25-.11-.26-.24z"/></svg>
            <div class="kpi-text">
              <div class="kpi-label">${escapeHtml(t.totalPurchaseCard)}</div>
              <div class="kpi-value">${escapeHtml(formatSlipCurrency(agreement.totalPurchaseAmount, language))}</div>
            </div>
          </div>

          <div class="kpi-card kpi-green">
            <svg class="kpi-ico" viewBox="0 0 24 24" fill="currentColor"><path d="M11.8 10.9c-2.27-.59-3-1.2-3-2.15 0-1.09 1.01-1.85 2.7-1.85 1.78 0 2.44.85 2.5 2.1h2.21c-.07-1.72-1.12-3.3-3.21-3.81V3h-3v2.16c-1.94.42-3.5 1.68-3.5 3.61 0 2.31 1.91 3.46 4.7 4.13 2.5.6 3 1.48 3 2.41 0 .69-.49 1.79-2.7 1.79-2.06 0-2.87-.92-2.98-2.1h-2.2c.12 2.19 1.76 3.42 3.68 3.83V21h3v-2.15c1.95-.37 3.5-1.5 3.5-3.55 0-2.84-2.43-3.81-4.7-4.4z"/></svg>
            <div class="kpi-text">
              <div class="kpi-label">${escapeHtml(t.downPaymentCard)}</div>
              <div class="kpi-value">${escapeHtml(formatSlipCurrency(agreement.downPayment, language))}</div>
            </div>
          </div>

          <div class="kpi-card kpi-blue">
            <svg class="kpi-ico" viewBox="0 0 24 24" fill="currentColor"><path d="M19 4h-1V2h-2v2H8V2H6v2H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2V6a2 2 0 00-2-2zm0 16H5V10h14v10zm0-12H5V6h14v2z"/></svg>
            <div class="kpi-text">
              <div class="kpi-label">${escapeHtml(t.installmentBalanceCard)}</div>
              <div class="kpi-value">${escapeHtml(formatSlipCurrency(agreement.installmentBalance, language))}</div>
            </div>
          </div>

          <div class="kpi-card kpi-purple">
            <svg class="kpi-ico" viewBox="0 0 24 24" fill="currentColor"><path d="M19 4h-1V2h-2v2H8V2H6v2H5c-1.11 0-2 .9-2 2v14a2 2 0 002 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V9h14v11zm-8.47-4.29l-2.12-2.12-1.06 1.06 3.18 3.18 6-6-1.06-1.06-4.94 4.94z"/></svg>
            <div class="kpi-text">
              <div class="kpi-label">${escapeHtml(t.paymentDurationCard)}</div>
              <div class="kpi-value">${escapeHtml(t.monthsUnit(agreement.durationMonths))}</div>
            </div>
          </div>
        </section>

        <!-- ROW 5: MONTHLY INSTALLMENT & FIRST DUE DATE BAR -->
        <section class="monthly-strip">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="#0B2A6B"><path d="M19 4h-1V2h-2v2H8V2H6v2H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2V6a2 2 0 00-2-2zm0 16H5V10h14v10z"/></svg>
          <span>${escapeHtml(t.monthlyInstallment)} : ${escapeHtml(formatSlipCurrency(agreement.monthlyInstallment, language))}</span>
          <span class="strip-sep">|</span>
          <span>${escapeHtml(t.firstDueDate)} : ${escapeHtml(formatSlipDate(agreement.firstDueDate, language))}</span>
        </section>

        <!-- ROW 6: INSTALLMENT SCHEDULE (DYNAMIC 1..6 ROWS) -->
        <section class="section-block">
          <div class="section-full-bar">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M19 4h-1V2h-2v2H8V2H6v2H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2V6a2 2 0 00-2-2zm0 16H5V9h14v11z"/></svg>
            <span>${escapeHtml(t.scheduleHeader)}</span>
          </div>
          <table class="slip-table">
            <thead>
              <tr>
                <th>${escapeHtml(t.slCol)}</th>
                <th class="col-left">${escapeHtml(t.monthCol)}</th>
                <th>${escapeHtml(t.dueDateCol)}</th>
                <th>${escapeHtml(t.installmentAmountCol)}</th>
                <th>${escapeHtml(t.statusCol)}</th>
                <th>${escapeHtml(t.signatureCol)}</th>
              </tr>
            </thead>
            <tbody>
              ${scheduleRowsHtml}
            </tbody>
          </table>
        </section>

        <!-- ROW 7: IMPORTANT TERMS (NO LAST PAYMENT DATE OR REMAINING DUE ON CUSTOMER COPY) -->
        <section class="terms-card">
          <div class="terms-title">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="#0B2A6B"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>
            <span>${escapeHtml(t.importantTerms)}</span>
          </div>
          <ul class="terms-list">
            ${termsList
              .map(
                line =>
                  `<li><span class="term-check">✔</span><span>${escapeHtml(line)}</span></li>`
              )
              .join('')}
          </ul>
        </section>
      </div>
    </div>

    <!-- ROW 8: SIGNATURES + THANK YOU BANNER + CURVED BOTTOM WAVE -->
    <footer class="footer-area">
      <div class="signatures-row">
        <div class="sig-block">
          <div class="sig-line"></div>
          <div class="sig-pill">${escapeHtml(t.customerSignature)}</div>
        </div>

        <div class="thank-you-banner">
          <div class="thank-you-title">${escapeHtml(t.thankYouTitle)}</div>
          <div class="thank-you-sub">— ${escapeHtml(t.thankYouSub)} —</div>
        </div>

        <div class="sig-block">
          <div class="sig-line"></div>
          <div class="sig-pill">${escapeHtml(t.shopOwnerSignature)}</div>
        </div>
      </div>

      <svg class="bottom-wave-svg" viewBox="0 0 800 40" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M 0 18 Q 220 4 460 22 Q 660 36 800 10 L 800 40 L 0 40 Z" fill="#0B2A6B" />
        <path d="M 0 14 Q 220 0 460 18 Q 660 32 800 6 L 800 12 Q 660 36 460 22 Q 220 4 0 18 Z" fill="#0EA5E9" />
      </svg>
    </footer>
  </div>
</body>
</html>`;
}

export function printInstallmentSlip(params: {
  agreement: InstallmentAgreement;
  settings: ShopSettings;
  activeBranch?: Branch | null;
  customer?: Customer | null;
  language?: InstallmentSlipLanguage;
}): PrintResult {
  const html = buildInstallmentSlipHtml(params);
  return printDocument(
    html,
    `Installment Slip - ${params.agreement.agreementCode}`
  );
}

// ==================== HIGH-DPI CANVAS -> A4 PDF EXPORT (BANGLA UNICODE SAFE) ====================

async function loadImageSafe(src?: string): Promise<HTMLImageElement | null> {
  if (!src || !src.trim()) return null;
  try {
    let resolvedSrc = src.trim();
    if (!resolvedSrc.startsWith('data:') && !resolvedSrc.startsWith('blob:')) {
      const resp = await fetch(resolvedSrc, { mode: 'cors' });
      if (!resp.ok) return null;
      const blob = await resp.blob();
      resolvedSrc = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('FileReader error'));
        reader.readAsDataURL(blob);
      });
    }
    if (!resolvedSrc) return null;
    return await new Promise<HTMLImageElement | null>(resolve => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = resolvedSrc;
    });
  } catch {
    return null;
  }
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.lineTo(x + w - rad, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
  ctx.lineTo(x + w, y + h - rad);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
  ctx.lineTo(x + rad, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
  ctx.lineTo(x, y + rad);
  ctx.quadraticCurveTo(x, y, x + rad, y);
  ctx.closePath();
}

function wrapLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string[] {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  if (words.length === 0) return [''];
  const lines: string[] = [];
  let current = words[0];
  for (let i = 1; i < words.length; i++) {
    const test = `${current} ${words[i]}`;
    if (ctx.measureText(test).width <= maxWidth) {
      current = test;
    } else {
      lines.push(current);
      current = words[i];
    }
  }
  lines.push(current);
  return lines;
}

/**
 * Generates and downloads an exact-design A4 PDF (supports 1 or multiple pages cleanly)
 * with native Unicode Bangla rendering via browser Canvas + loaded Noto Sans Bengali font.
 */
export async function downloadInstallmentSlipPdf(params: {
  agreement: InstallmentAgreement;
  settings: ShopSettings;
  activeBranch?: Branch | null;
  customer?: Customer | null;
  language?: InstallmentSlipLanguage;
}): Promise<void> {
  const { agreement, settings, activeBranch, customer, language = 'bn' } = params;
  if (typeof document !== 'undefined' && document.fonts?.ready) {
    await document.fonts.ready.catch(() => {});
  }

  const biz = resolveBusinessProfile(settings, activeBranch);
  const logoSrc = getShopLogo(settings) || biz.logoUrl;
  const photoUrl = agreement.customerPhotoUrl || customer?.photoUrl || '';
  const [logoImg, custImg] = await Promise.all([
    loadImageSafe(logoSrc),
    loadImageSafe(photoUrl),
  ]);

  const t = getSlipCopyTexts(language);
  const FONT = '"Noto Sans Bengali", "Hind Siliguri", "Plus Jakarta Sans", sans-serif';

  const W = 1240; // High-DPI A4 width (210mm * ~5.9px/mm)
  const A4_H = 1754; // Exact A4 ratio height (297mm / 210mm * 1240)
  const PAD = 44;
  const CONTENT_W = W - PAD * 2;

  const itemCount = Math.max(1, agreement.items.length);
  const schedCount = Math.max(1, agreement.schedule.length);
  const extraHeightNeeded =
    Math.max(0, itemCount - 5) * 44 + Math.max(0, schedCount - 6) * 44;
  const TOTAL_H = Math.max(A4_H, 1680 + extraHeightNeeded);

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = TOTAL_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable.');

  // White paper canvas
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, W, TOTAL_H);

  // 1. TOP CURVED HEADER WAVE
  ctx.save();
  ctx.fillStyle = '#0B2A6B';
  ctx.beginPath();
  ctx.moveTo(740, 0);
  ctx.lineTo(W, 0);
  ctx.lineTo(W, 185);
  ctx.quadraticCurveTo(990, 212, 760, 154);
  ctx.quadraticCurveTo(720, 80, 740, 0);
  ctx.closePath();
  ctx.fill();

  // Sky-blue curved accent wave
  ctx.fillStyle = '#0EA5E9';
  ctx.beginPath();
  ctx.moveTo(0, 198);
  ctx.quadraticCurveTo(400, 168, 790, 188);
  ctx.quadraticCurveTo(1030, 200, W, 166);
  ctx.lineTo(W, 186);
  ctx.quadraticCurveTo(1030, 218, 790, 202);
  ctx.quadraticCurveTo(400, 180, 0, 208);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#0B2A6B';
  ctx.beginPath();
  ctx.moveTo(0, 208);
  ctx.quadraticCurveTo(400, 180, 790, 202);
  ctx.quadraticCurveTo(1030, 218, W, 186);
  ctx.lineTo(W, 196);
  ctx.quadraticCurveTo(1030, 224, 790, 210);
  ctx.quadraticCurveTo(400, 190, 0, 214);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // Left Header: Shop Logo + Name + Tagline + Contacts
  let leftX = PAD;
  if (logoImg) {
    const maxLogoW = 104;
    const maxLogoH = 104;
    const ratio = Math.min(maxLogoW / logoImg.width, maxLogoH / logoImg.height);
    const dw = logoImg.width * ratio;
    const dh = logoImg.height * ratio;
    ctx.drawImage(logoImg, leftX, 34 + (maxLogoH - dh) / 2, dw, dh);
    leftX += dw + 20;
  }

  const shopName = biz.shopName?.trim() || '';
  const tagline = biz.tagline?.trim() || '';
  const address = biz.address?.trim() || '';
  const mobile = biz.mobile?.trim() || '';
  const email = biz.email?.trim() || '';
  const motto = tagline || t.defaultMotto;

  ctx.fillStyle = '#0B2A6B';
  ctx.font = `800 34px ${FONT}`;
  const nameLines = wrapLines(ctx, shopName, 260).slice(0, 2);
  let nameY = 66;
  nameLines.forEach(line => {
    ctx.fillText(line, leftX, nameY);
    nameY += 38;
  });
  if (tagline) {
    ctx.fillStyle = '#0E7490';
    ctx.font = `italic 600 18px ${FONT}`;
    ctx.fillText(tagline.slice(0, 38), leftX, nameY + 4);
  }

  // Contact divider + dynamic contacts
  if (address || mobile || email) {
    const divX = Math.max(leftX + 260, 445);
    ctx.strokeStyle = '#94A3B8';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(divX, 38);
    ctx.lineTo(divX, 146);
    ctx.stroke();

    const contactX = divX + 18;
    let cY = 58;
    ctx.fillStyle = '#1E293B';
    ctx.font = `600 18px ${FONT}`;
    if (address) {
      wrapLines(ctx, address, 235).slice(0, 2).forEach(line => {
        ctx.fillText(line, contactX, cY);
        cY += 24;
      });
    }
    if (mobile) {
      ctx.fillText(`Tel: ${mobile}`, contactX, cY);
      cY += 24;
    }
    if (email) {
      ctx.fillText(email.slice(0, 32), contactX, cY);
    }
  }

  // Right Navy Header Title + Yellow Ribbon Motto
  ctx.save();
  ctx.textAlign = 'center';
  ctx.fillStyle = '#FFFFFF';
  ctx.font = `800 36px ${FONT}`;
  ctx.fillText(t.headerTitle, 995, 62);
  ctx.fillStyle = '#E2E8F0';
  ctx.font = `600 22px ${FONT}`;
  ctx.fillText(t.headerSubtitle, 995, 98);

  // Yellow ribbon pill
  drawRoundedRect(ctx, 800, 114, 390, 34, 17);
  ctx.fillStyle = '#FACC15';
  ctx.fill();
  ctx.fillStyle = '#0B2A6B';
  ctx.font = `800 18px ${FONT}`;
  ctx.fillText(`— ${motto.slice(0, 36)} —`, 995, 137);
  ctx.restore();

  // 2. CUSTOMER STRIP (Photo + Customer Information + Identity Documents)
  let y = 236;
  const stripH = 188;

  // Customer Photo Box
  drawRoundedRect(ctx, PAD, y, 152, stripH, 16);
  ctx.fillStyle = '#F8FAFC';
  ctx.fill();
  ctx.strokeStyle = '#1D4ED8';
  ctx.lineWidth = 2.5;
  ctx.stroke();

  if (custImg) {
    ctx.save();
    drawRoundedRect(ctx, PAD + 2, y + 2, 148, stripH - 4, 14);
    ctx.clip();
    const scale = Math.max(148 / custImg.width, (stripH - 4) / custImg.height);
    const dw = custImg.width * scale;
    const dh = custImg.height * scale;
    ctx.drawImage(
      custImg,
      PAD + 2 + (148 - dw) / 2,
      y + 2 + (stripH - 4 - dh) / 2,
      dw,
      dh
    );
    ctx.restore();
  } else {
    ctx.fillStyle = '#64748B';
    ctx.textAlign = 'center';
    ctx.font = `600 17px ${FONT}`;
    ctx.fillText(t.noPhoto, PAD + 76, y + stripH / 2 + 6);
    ctx.textAlign = 'left';
  }

  // Middle: Customer Info Pill & Rows
  const infoX = PAD + 174;
  drawRoundedRect(ctx, infoX, y, 270, 34, 17);
  ctx.fillStyle = '#0B2A6B';
  ctx.fill();
  ctx.fillStyle = '#FFFFFF';
  ctx.font = `700 19px ${FONT}`;
  ctx.fillText(t.customerInfo, infoX + 20, y + 24);

  const custCode =
    agreement.customerCode || customer?.customerCode || agreement.customerId.slice(0, 8);
  const custAddr = agreement.customerAddress || customer?.address || '';
  const rawNid = agreement.customerNidNumber || customer?.nidNumber || '';
  const maskedNid = maskNidNumber(rawNid);

  const kvRows: [string, string][] = [
    [t.customerName, agreement.customerName],
    [t.customerId, `${custCode} (${agreement.agreementCode})`],
    [t.mobile, agreement.customerMobile || '—'],
  ];
  if (custAddr) kvRows.push([t.address, custAddr]);
  if (maskedNid) kvRows.push([t.nidLabel, maskedNid]);

  let kvY = y + 60;
  kvRows.slice(0, 5).forEach(([k, v]) => {
    ctx.fillStyle = '#0F172A';
    ctx.font = `700 18px ${FONT}`;
    ctx.fillText(k, infoX, kvY);
    ctx.fillText(':', infoX + 148, kvY);
    ctx.fillStyle = '#1E293B';
    ctx.font = `600 18px ${FONT}`;
    ctx.fillText(v.slice(0, 38), infoX + 164, kvY);
    kvY += 28;
  });

  // Right: Identity Verification Card (Privacy-Safe, No Raw NID Images Printed)
  const idBoxX = W - PAD - 320;
  drawRoundedRect(ctx, idBoxX, y, 320, stripH, 14);
  ctx.fillStyle = '#F8FAFC';
  ctx.fill();
  ctx.strokeStyle = '#1E40AF';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.save();
  drawRoundedRect(ctx, idBoxX, y, 320, 38, 12);
  ctx.fillStyle = '#0B2A6B';
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = '#0B2A6B';
  ctx.fillRect(idBoxX, y + 22, 320, 16);

  ctx.textAlign = 'center';
  ctx.fillStyle = '#FFFFFF';
  ctx.font = `700 18px ${FONT}`;
  ctx.fillText(t.identityDocuments, idBoxX + 160, y + 25);

  const hasIdDocs = Boolean(
    agreement.hasIdentityDocuments ||
      rawNid ||
      customer?.nidFrontUrl ||
      customer?.nidBackUrl
  );
  if (hasIdDocs) {
    drawRoundedRect(ctx, idBoxX + 46, y + 58, 228, 32, 16);
    ctx.fillStyle = '#DCFCE7';
    ctx.fill();
    ctx.fillStyle = '#166534';
    ctx.font = `700 16px ${FONT}`;
    ctx.fillText(`✓ ${t.docOnFile}`, idBoxX + 160, y + 80);

    if (maskedNid) {
      ctx.fillStyle = '#0B2A6B';
      ctx.font = `700 18px monospace`;
      ctx.fillText(`${t.nidLabel}: ${maskedNid}`, idBoxX + 160, y + 120);
    }
    ctx.fillStyle = '#64748B';
    ctx.font = `500 14px ${FONT}`;
    wrapLines(ctx, t.docPrivateNote, 280).slice(0, 2).forEach((ln, idx) => {
      ctx.fillText(ln, idBoxX + 160, y + 148 + idx * 18);
    });
  } else {
    drawRoundedRect(ctx, idBoxX + 46, y + 92, 228, 34, 17);
    ctx.fillStyle = '#E2E8F0';
    ctx.fill();
    ctx.fillStyle = '#475569';
    ctx.font = `700 16px ${FONT}`;
    ctx.fillText(t.docOptionalNone, idBoxX + 160, y + 115);
  }
  ctx.textAlign = 'left';

  // 3. PURCHASE DETAILS TABLE
  y += stripH + 22;
  drawRoundedRect(ctx, PAD, y, 270, 36, 10);
  ctx.fillStyle = '#0B2A6B';
  ctx.fill();
  ctx.fillRect(PAD, y + 22, 270, 14);
  ctx.fillStyle = '#FFFFFF';
  ctx.font = `700 19px ${FONT}`;
  ctx.fillText(t.purchaseDetails, PAD + 18, y + 25);
  y += 36;

  const pCols = [56, 404, 110, 118, 90, 176, 198]; // sum = 1152 = CONTENT_W
  const rowH = 40;
  // Header row
  ctx.fillStyle = '#EFF6FF';
  ctx.fillRect(PAD, y, CONTENT_W, rowH);
  ctx.strokeStyle = '#1E40AF';
  ctx.lineWidth = 2;
  ctx.strokeRect(PAD, y, CONTENT_W, rowH);

  const pHeaders = [
    t.slCol,
    t.productNameCol,
    t.sizeCol,
    t.colorCol,
    t.qtyCol,
    t.unitPriceCol,
    t.totalPriceCol,
  ];
  let cx = PAD;
  ctx.fillStyle = '#0F172A';
  ctx.font = `700 17px ${FONT}`;
  pCols.forEach((cw, idx) => {
    ctx.textAlign = idx === 1 ? 'left' : 'center';
    const tx = idx === 1 ? cx + 12 : cx + cw / 2;
    ctx.fillText(pHeaders[idx], tx, y + 26);
    if (idx > 0) {
      ctx.strokeStyle = '#93C5FD';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx, y);
      ctx.lineTo(cx, y + rowH);
      ctx.stroke();
    }
    cx += cw;
  });
  y += rowH;

  const itemsToDraw =
    agreement.items.length > 0
      ? agreement.items
      : [
          {
            productName: agreement.agreementCode,
            size: '—',
            color: '—',
            quantity: 1,
            unitPrice: agreement.totalPurchaseAmount,
            totalPrice: agreement.totalPurchaseAmount,
          },
        ];

  itemsToDraw.forEach((item, idx) => {
    ctx.fillStyle = idx % 2 === 1 ? '#FAFBFD' : '#FFFFFF';
    ctx.fillRect(PAD, y, CONTENT_W, rowH);
    ctx.strokeStyle = '#CBD5E1';
    ctx.lineWidth = 1;
    ctx.strokeRect(PAD, y, CONTENT_W, rowH);

    const vals = [
      formatSlipNumber(idx + 1, language),
      item.productName,
      item.size || '—',
      item.color || '—',
      formatSlipNumber(item.quantity, language),
      formatSlipCurrency(item.unitPrice, language),
      formatSlipCurrency(item.totalPrice, language),
    ];

    cx = PAD;
    vals.forEach((val, cIdx) => {
      ctx.fillStyle = '#0F172A';
      ctx.font = `${cIdx === 6 || cIdx === 1 ? '700' : '500'} 17px ${FONT}`;
      if (cIdx === 1) {
        ctx.textAlign = 'left';
        ctx.fillText(val.slice(0, 32), cx + 12, y + 26);
      } else if (cIdx >= 5) {
        ctx.textAlign = 'right';
        ctx.fillText(val, cx + pCols[cIdx] - 14, y + 26);
      } else {
        ctx.textAlign = 'center';
        ctx.fillText(val, cx + pCols[cIdx] / 2, y + 26);
      }
      if (cIdx > 0) {
        ctx.beginPath();
        ctx.moveTo(cx, y);
        ctx.lineTo(cx, y + rowH);
        ctx.stroke();
      }
      cx += pCols[cIdx];
    });
    y += rowH;
  });

  // Total Purchase Summary Row
  ctx.fillStyle = '#EFF6FF';
  ctx.fillRect(PAD, y, CONTENT_W, 44);
  ctx.strokeStyle = '#1E40AF';
  ctx.lineWidth = 2;
  ctx.strokeRect(PAD, y, CONTENT_W, 44);
  ctx.fillStyle = '#0B2A6B';
  ctx.font = `800 19px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.fillText(t.totalPurchaseAmount, PAD + (CONTENT_W - pCols[6]) / 2, y + 29);
  ctx.textAlign = 'right';
  ctx.fillText(
    formatSlipCurrency(agreement.totalPurchaseAmount, language),
    PAD + CONTENT_W - 14,
    y + 29
  );
  ctx.textAlign = 'left';
  y += 44 + 22;

  // 4. 4 COLORED KPI CARDS
  const gap = 18;
  const cardW = (CONTENT_W - gap * 3) / 4;
  const cardH = 92;
  const cards = [
    {
      bg: '#124191',
      label: t.totalPurchaseCard,
      val: formatSlipCurrency(agreement.totalPurchaseAmount, language),
    },
    {
      bg: '#15803D',
      label: t.downPaymentCard,
      val: formatSlipCurrency(agreement.downPayment, language),
    },
    {
      bg: '#124191',
      label: t.installmentBalanceCard,
      val: formatSlipCurrency(agreement.installmentBalance, language),
    },
    {
      bg: '#7E22CE',
      label: t.paymentDurationCard,
      val: t.monthsUnit(agreement.durationMonths),
    },
  ];
  cards.forEach((c, i) => {
    const bx = PAD + i * (cardW + gap);
    drawRoundedRect(ctx, bx, y, cardW, cardH, 14);
    ctx.fillStyle = c.bg;
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.font = `600 16px ${FONT}`;
    ctx.fillText(c.label, bx + 20, y + 32);
    ctx.fillStyle = '#FFFFFF';
    ctx.font = `800 28px ${FONT}`;
    ctx.fillText(c.val, bx + 20, y + 72);
  });
  y += cardH + 18;

  // 5. MONTHLY INSTALLMENT & FIRST DUE DATE STRIP
  drawRoundedRect(ctx, PAD, y, CONTENT_W, 44, 10);
  ctx.fillStyle = '#F8FAFC';
  ctx.fill();
  ctx.strokeStyle = '#CBD5E1';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.fillStyle = '#0B2A6B';
  ctx.font = `700 19px ${FONT}`;
  const stripText = `${t.monthlyInstallment} : ${formatSlipCurrency(
    agreement.monthlyInstallment,
    language
  )}   |   ${t.firstDueDate} : ${formatSlipDate(agreement.firstDueDate, language)}`;
  ctx.fillText(stripText, W / 2, y + 29);
  ctx.textAlign = 'left';
  y += 44 + 20;

  // 6. INSTALLMENT SCHEDULE TABLE (DYNAMIC 1..6 ROWS)
  drawRoundedRect(ctx, PAD, y, CONTENT_W, 38, 10);
  ctx.fillStyle = '#0B2A6B';
  ctx.fill();
  ctx.fillRect(PAD, y + 24, CONTENT_W, 14);
  ctx.fillStyle = '#FFFFFF';
  ctx.font = `700 19px ${FONT}`;
  ctx.fillText(t.scheduleHeader, PAD + 20, y + 26);
  y += 38;

  const sCols = [56, 260, 260, 210, 176, 190]; // sum = 1152
  ctx.fillStyle = '#EFF6FF';
  ctx.fillRect(PAD, y, CONTENT_W, rowH);
  ctx.strokeStyle = '#1E40AF';
  ctx.lineWidth = 2;
  ctx.strokeRect(PAD, y, CONTENT_W, rowH);

  const sHeaders = [
    t.slCol,
    t.monthCol,
    t.dueDateCol,
    t.installmentAmountCol,
    t.statusCol,
    t.signatureCol,
  ];
  cx = PAD;
  ctx.fillStyle = '#0F172A';
  ctx.font = `700 17px ${FONT}`;
  sCols.forEach((cw, idx) => {
    ctx.textAlign = idx === 1 ? 'left' : 'center';
    ctx.fillText(sHeaders[idx], idx === 1 ? cx + 14 : cx + cw / 2, y + 26);
    if (idx > 0) {
      ctx.strokeStyle = '#93C5FD';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx, y);
      ctx.lineTo(cx, y + rowH);
      ctx.stroke();
    }
    cx += cw;
  });
  y += rowH;

  agreement.schedule.forEach((row, idx) => {
    ctx.fillStyle = idx % 2 === 1 ? '#FAFBFD' : '#FFFFFF';
    ctx.fillRect(PAD, y, CONTENT_W, rowH);
    ctx.strokeStyle = '#CBD5E1';
    ctx.lineWidth = 1;
    ctx.strokeRect(PAD, y, CONTENT_W, rowH);

    const monthLabel =
      language === 'bn'
        ? row.labelBn
        : language === 'both'
        ? `${row.labelBn} (${row.labelEn})`
        : row.labelEn;

    cx = PAD;
    // 0: #
    ctx.fillStyle = '#0F172A';
    ctx.font = `600 17px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText(formatSlipNumber(row.installmentNumber, language), cx + sCols[0] / 2, y + 26);
    cx += sCols[0];

    // 1: Month
    ctx.textAlign = 'left';
    ctx.font = `600 17px ${FONT}`;
    ctx.fillText(monthLabel, cx + 14, y + 26);
    cx += sCols[1];

    // 2: Due Date
    ctx.textAlign = 'center';
    ctx.fillText(formatSlipDate(row.dueDate, language), cx + sCols[2] / 2, y + 26);
    cx += sCols[2];

    // 3: Amount
    ctx.textAlign = 'right';
    ctx.font = `700 17px ${FONT}`;
    ctx.fillText(formatSlipCurrency(row.amount, language), cx + sCols[3] - 18, y + 26);
    cx += sCols[3];

    // 4: Status badge
    const badgeColor =
      row.status === 'paid'
        ? '#15803D'
        : row.status === 'partial'
        ? '#0284C7'
        : row.status === 'overdue'
        ? '#DC2626'
        : '#F59E0B';
    const badgeTextColor = row.status === 'due' ? '#1E293B' : '#FFFFFF';
    const badgeLabel =
      row.status === 'paid'
        ? `${t.statusPaid} ✓`
        : row.status === 'partial'
        ? t.statusPartial
        : row.status === 'overdue'
        ? t.statusOverdue
        : t.statusDue;

    drawRoundedRect(ctx, cx + 22, y + 7, sCols[4] - 44, 26, 13);
    ctx.fillStyle = badgeColor;
    ctx.fill();
    ctx.textAlign = 'center';
    ctx.fillStyle = badgeTextColor;
    ctx.font = `700 14px ${FONT}`;
    ctx.fillText(badgeLabel, cx + sCols[4] / 2, y + 25);
    cx += sCols[4];

    // 5: Signature
    ctx.fillStyle = '#475569';
    ctx.font = `italic 500 16px ${FONT}`;
    ctx.fillText(
      row.signatureText?.trim() || (row.status === 'paid' ? '✓' : '—'),
      cx + sCols[5] / 2,
      y + 26
    );

    // Vertical column borders
    let vx = PAD;
    ctx.strokeStyle = '#CBD5E1';
    ctx.lineWidth = 1;
    for (let i = 1; i < sCols.length; i++) {
      vx += sCols[i - 1];
      ctx.beginPath();
      ctx.moveTo(vx, y);
      ctx.lineTo(vx, y + rowH);
      ctx.stroke();
    }
    ctx.textAlign = 'left';
    y += rowH;
  });

  // 7. IMPORTANT TERMS CARD (STRICTLY NO LAST PAYMENT DATE OR REMAINING DUE)
  y += 22;
  const terms = t.terms(mobile);
  const termsBoxH = 54 + terms.length * 28;
  drawRoundedRect(ctx, PAD, y, CONTENT_W, termsBoxH, 14);
  ctx.fillStyle = '#F8FAFC';
  ctx.fill();
  ctx.strokeStyle = '#94A3B8';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.fillStyle = '#0B2A6B';
  ctx.font = `800 19px ${FONT}`;
  ctx.fillText(`ⓘ  ${t.importantTerms}`, PAD + 20, y + 32);

  let termY = y + 64;
  terms.forEach(line => {
    ctx.fillStyle = '#0B2A6B';
    ctx.font = `800 17px ${FONT}`;
    ctx.fillText('✔', PAD + 22, termY);
    ctx.fillStyle = '#1E293B';
    ctx.font = `500 17px ${FONT}`;
    ctx.fillText(line, PAD + 48, termY);
    termY += 28;
  });

  // 8. SIGNATURES + THANK YOU BANNER + CURVED BOTTOM WAVE
  const footerTop = Math.max(y + termsBoxH + 36, TOTAL_H - 165);
  ctx.strokeStyle = '#475569';
  ctx.lineWidth = 2;
  ctx.setLineDash([4, 4]);
  // Left signature dotted line
  ctx.beginPath();
  ctx.moveTo(PAD + 30, footerTop + 42);
  ctx.lineTo(PAD + 310, footerTop + 42);
  ctx.stroke();
  // Right signature dotted line
  ctx.beginPath();
  ctx.moveTo(W - PAD - 310, footerTop + 42);
  ctx.lineTo(W - PAD - 30, footerTop + 42);
  ctx.stroke();
  ctx.setLineDash([]);

  // Customer Signature Pill
  drawRoundedRect(ctx, PAD + 30, footerTop + 54, 280, 34, 17);
  ctx.fillStyle = '#DBEAFE';
  ctx.fill();
  ctx.textAlign = 'center';
  ctx.fillStyle = '#0B2A6B';
  ctx.font = `700 17px ${FONT}`;
  ctx.fillText(t.customerSignature, PAD + 170, footerTop + 77);

  // Center Thank You Trapezoid
  drawRoundedRect(ctx, W / 2 - 185, footerTop + 12, 370, 78, 16);
  ctx.fillStyle = '#0B2A6B';
  ctx.fill();
  ctx.fillStyle = '#FFFFFF';
  ctx.font = `italic 800 28px ${FONT}`;
  ctx.fillText(t.thankYouTitle, W / 2, footerTop + 48);
  ctx.fillStyle = '#E2E8F0';
  ctx.font = `600 16px ${FONT}`;
  ctx.fillText(`— ${t.thankYouSub} —`, W / 2, footerTop + 74);

  // Shop Owner Signature Pill
  drawRoundedRect(ctx, W - PAD - 310, footerTop + 54, 280, 34, 17);
  ctx.fillStyle = '#DBEAFE';
  ctx.fill();
  ctx.fillStyle = '#0B2A6B';
  ctx.font = `700 17px ${FONT}`;
  ctx.fillText(t.shopOwnerSignature, W - PAD - 170, footerTop + 77);
  ctx.textAlign = 'left';

  // Bottom Wave
  const bY = TOTAL_H - 46;
  ctx.fillStyle = '#0EA5E9';
  ctx.beginPath();
  ctx.moveTo(0, bY + 12);
  ctx.quadraticCurveTo(360, bY - 6, 740, bY + 18);
  ctx.quadraticCurveTo(1040, bY + 36, W, bY + 2);
  ctx.lineTo(W, TOTAL_H);
  ctx.lineTo(0, TOTAL_H);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#0B2A6B';
  ctx.beginPath();
  ctx.moveTo(0, bY + 20);
  ctx.quadraticCurveTo(360, bY + 2, 740, bY + 26);
  ctx.quadraticCurveTo(1040, bY + 42, W, bY + 10);
  ctx.lineTo(W, TOTAL_H);
  ctx.lineTo(0, TOTAL_H);
  ctx.closePath();
  ctx.fill();

  // Export Multi-page-safe A4 PDF via jsPDF
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidthMm = pdf.internal.pageSize.getWidth(); // 210
  const pageHeightMm = pdf.internal.pageSize.getHeight(); // 297
  const pageSlicePx = Math.floor((W * pageHeightMm) / pageWidthMm);

  let yOffset = 0;
  let pageIndex = 0;
  while (yOffset < TOTAL_H - 10) {
    const sliceH = Math.min(pageSlicePx, TOTAL_H - yOffset);
    const sliceCanvas = document.createElement('canvas');
    sliceCanvas.width = W;
    sliceCanvas.height = sliceH;
    const sCtx = sliceCanvas.getContext('2d');
    if (sCtx) {
      sCtx.fillStyle = '#FFFFFF';
      sCtx.fillRect(0, 0, W, sliceH);
      sCtx.drawImage(canvas, 0, yOffset, W, sliceH, 0, 0, W, sliceH);
      const dataUrl = sliceCanvas.toDataURL('image/png', 1.0);
      if (pageIndex > 0) pdf.addPage();
      const renderedHmm = (sliceH * pageWidthMm) / W;
      pdf.addImage(dataUrl, 'PNG', 0, 0, pageWidthMm, renderedHmm, undefined, 'FAST');
    }
    yOffset += sliceH;
    pageIndex++;
  }

  pdf.save(`Installment-Slip-${agreement.agreementCode}.pdf`);
}

/**
 * Generates and prints an Installment Payment Collection Receipt (Thermal 80mm / A5 clean receipt).
 */
export function buildInstallmentReceiptHtml(params: {
  payment: InstallmentPaymentRecord;
  agreement: InstallmentAgreement;
  settings: ShopSettings;
  activeBranch?: Branch | null;
}): string {
  const { payment, agreement, settings, activeBranch } = params;
  const biz = resolveBusinessProfile(settings, activeBranch);
  const logoSrc = getShopLogo(settings) || biz.logoUrl;

  return `<!DOCTYPE html>
<html lang="bn" class="installment-receipt-doc">
<head>
  <meta charset="UTF-8" />
  <title>Payment Receipt · ${escapeHtml(payment.receiptNumber)}</title>
  <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+Bengali:wght@400;600;700&family=Plus+Jakarta+Sans:wght@400;600;700&display=swap" rel="stylesheet" />
  <style>
    @page { size: 80mm auto; margin: 4mm; }
    html.installment-receipt-doc,
    html.installment-receipt-doc body {
      margin: 0;
      padding: 0;
      background: #ffffff;
    }
    .receipt-sheet {
      font-family: 'Noto Sans Bengali', 'Plus Jakarta Sans', sans-serif;
      color: #0F172A;
      font-size: 11px;
      margin: 0;
      padding: 6px;
      max-width: 310px;
      background: #ffffff;
    }
    .receipt-sheet .center { text-align: center; }
    .receipt-sheet .logo { max-height: 36px; max-width: 110px; object-fit: contain; margin: 0 auto 4px; display: block; }
    .receipt-sheet .shop { font-size: 14px; font-weight: 800; color: #0B2A6B; }
    .receipt-sheet .muted { font-size: 10px; color: #475569; }
    .receipt-sheet .divider { border-top: 1px dashed #94A3B8; margin: 7px 0; }
    .receipt-sheet .badge { display: inline-block; background: #0B2A6B; color: #fff; font-weight: 700; padding: 2px 8px; border-radius: 99px; font-size: 10px; margin: 4px 0; }
    .receipt-sheet .row { display: flex; justify-content: space-between; gap: 8px; margin: 3px 0; }
    .receipt-sheet .bold { font-weight: 700; }
    .receipt-sheet .amt-box { background: #ECFDF5; border: 1px solid #6EE7B7; border-radius: 6px; padding: 6px 8px; margin: 6px 0; }
  </style>
</head>
<body>
  <div class="receipt-sheet">
    <div class="center">
      ${logoSrc ? `<img class="logo" src="${escapeHtml(logoSrc)}" alt="" />` : ''}
      ${biz.shopName ? `<div class="shop">${escapeHtml(biz.shopName)}</div>` : ''}
      ${biz.address ? `<div class="muted">${escapeHtml(biz.address)}</div>` : ''}
      ${biz.mobile ? `<div class="muted">${escapeHtml(biz.mobile)}</div>` : ''}
      <div class="badge">INSTALLMENT PAYMENT RECEIPT</div>
    </div>
    <div class="divider"></div>
    <div class="row"><span>Receipt No:</span><span class="bold">${escapeHtml(payment.receiptNumber)}</span></div>
    <div class="row"><span>Agreement ID:</span><span class="bold">${escapeHtml(agreement.agreementCode)}</span></div>
    <div class="row"><span>Date:</span><span>${escapeHtml(formatSlipDate(payment.paymentDate, 'en'))}</span></div>
    <div class="row"><span>Customer:</span><span class="bold">${escapeHtml(agreement.customerName)}</span></div>
    <div class="row"><span>Mobile:</span><span>${escapeHtml(agreement.customerMobile)}</span></div>
    <div class="divider"></div>
    <div class="amt-box">
      <div class="row bold"><span>Paid Amount:</span><span>৳${escapeHtml(payment.amount.toLocaleString('en-US'))}</span></div>
      <div class="row muted"><span>Method:</span><span style="text-transform:uppercase">${escapeHtml(payment.paymentMethod)}</span></div>
      <div class="row bold" style="color:#0B2A6B;margin-top:4px;"><span>Remaining Due:</span><span>৳${escapeHtml(agreement.remainingDue.toLocaleString('en-US'))}</span></div>
    </div>
    <div class="row muted"><span>Collected By:</span><span>${escapeHtml(payment.collectedBy)}</span></div>
    ${payment.remarks ? `<div class="muted" style="margin-top:3px;">Note: ${escapeHtml(payment.remarks)}</div>` : ''}
    <div class="divider"></div>
    <div class="center muted">Thank you for your payment!</div>
  </div>
</body>
</html>`;
}

export function printInstallmentPaymentReceipt(params: {
  payment: InstallmentPaymentRecord;
  agreement: InstallmentAgreement;
  settings: ShopSettings;
  activeBranch?: Branch | null;
}): PrintResult {
  const html = buildInstallmentReceiptHtml(params);
  return printDocument(html, `Installment Receipt - ${params.payment.receiptNumber}`);
}
