import React, { useState } from 'react';
import { InvoicePaperSize, Sale, ShopSettings } from '../../types';
import { useApp } from '../../context/AppContext';
import { APP_IDENTITY, resolveBusinessProfile } from '../../config/appIdentity';
import { formatCurrency, formatDate, formatTime } from '../../utils/formatters';
import {
  getPrinterSettings,
  getShopLogo,
  previewInvoice,
  printInvoice,
  PrintPreviewPayload,
} from '../../utils/printEngine';
import { PrintPreviewModal } from '../printing/PrintPreviewModal';
import { BarcodeSvg } from '../barcodes/BarcodeSvg';
import { ProductThumbnail } from '../common/ProductThumbnail';
import { inferColorHex, resolveProductImage } from '../../utils/productImageResolver';
import { copyTextSafely } from '../../utils/polyfills';
import {
  Printer,
  Share2,
  X,
  CheckCircle2,
  MessageSquare,
  Eye,
  AlertTriangle,
} from 'lucide-react';

interface InvoiceModalProps {
  sale: Sale | null;
  onClose: () => void;
  settings: ShopSettings;
}

export const InvoiceModal: React.FC<InvoiceModalProps> = ({ sale, onClose, settings }) => {
  const { hasPermission, branches, activeBranchId, products } = useApp();
  const canPrintInvoice = hasPermission('invoice_printing', 'print');
  const defaultPaper = getPrinterSettings(settings).invoicePaperSize || settings.invoiceFormat || 'thermal';
  const [format, setFormat] = useState<InvoicePaperSize>(defaultPaper);
  const [copied, setCopied] = useState(false);
  const [isPrinting, setIsPrinting] = useState(false);
  const [printError, setPrintError] = useState<string | null>(null);
  const [previewPayload, setPreviewPayload] = useState<PrintPreviewPayload | null>(null);

  if (!sale) return null;

  const lang = settings.language;
  const activeBranch = branches.find(b => b.id === activeBranchId) || branches[0];
  const biz = resolveBusinessProfile(settings, activeBranch);
  const shopLogo = getShopLogo(settings);

  const handlePrint = () => {
    if (!canPrintInvoice) {
      setPrintError('Your role does not have Invoice Printing permission.');
      return;
    }
    if (isPrinting) return;
    setPrintError(null);
    setIsPrinting(true);
    try {
      const res = printInvoice(sale, settings, format, activeBranch);
      if (!res.opened && !res.cancelled) {
        setPrintError(res.error || 'Could not open system print dialog.');
      }
    } catch (err: any) {
      setPrintError(err?.message || 'Unexpected error while preparing invoice print.');
    } finally {
      setIsPrinting(false);
    }
  };

  const handleOpenPreview = () => {
    setPrintError(null);
    const payload = previewInvoice(sale, settings, format, activeBranch);
    setPreviewPayload(payload);
  };

  const generateWhatsAppMessage = () => {
    const itemsText = sale.items
      .map(
        (item, idx) =>
          `${idx + 1}. ${item.productName}${item.variantDetails ? ` (${item.variantDetails})` : ''} - ${item.quantity} x ৳${item.unitPrice} = ৳${item.total}`
      )
      .join('%0A');

    const message =
      `*${encodeURIComponent(biz.shopName)}*%0A` +
      `Invoice No: ${sale.invoiceNumber}%0A` +
      `Date: ${formatDate(sale.date, 'en')}%0A` +
      `Customer: ${encodeURIComponent(sale.customerName)}%0A` +
      `--------------------------------%0A` +
      `*Items:*%0A${itemsText}%0A` +
      `--------------------------------%0A` +
      `Total: ৳${sale.total}%0A` +
      `Paid: ৳${sale.paid}%0A` +
      `Due: ৳${sale.due}%0A%0A` +
      `Thank you for shopping with us!`;

    const mobileClean = sale.customerMobile?.replace(/[^0-9]/g, '') || '';
    const phoneParam = mobileClean ? `phone=${mobileClean}&` : '';
    window.open(`https://api.whatsapp.com/send?${phoneParam}text=${message}`, '_blank');
  };

  const handleCopySummary = async () => {
    const text = `${biz.shopName} | Invoice: ${sale.invoiceNumber}\nTotal: ৳${sale.total} | Paid: ৳${sale.paid} | Due: ৳${sale.due}\nThank you for shopping with us!`;
    const ok = await copyTextSafely(text);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const comboDiscount = Number(sale.comboDiscount || 0);
  const additionalDiscount = Math.max(0, Number(sale.discount || 0) - comboDiscount);

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 md:p-6 bg-slate-900/60 backdrop-blur-xs overflow-y-auto">
        <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl overflow-hidden my-auto border border-slate-200">
          {/* Header with format switcher & close */}
          <div className="p-3 sm:p-4 border-b border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-2 no-print">
            <div className="flex items-center gap-1.5 min-w-0">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
              <h3 className="text-sm sm:text-base font-bold text-slate-900 truncate">
                Invoice Details · {sale.invoiceNumber}
              </h3>
            </div>

            <div className="flex items-center gap-1.5 sm:gap-2">
              {/* Format Toggle (80mm Thermal / A5 / A4) */}
              <div className="flex bg-slate-200/80 p-0.5 rounded-lg text-xs font-medium">
                {(
                  [
                    { id: 'thermal', label: '80mm' },
                    { id: 'a5', label: 'A5' },
                    { id: 'a4', label: 'A4' },
                  ] as { id: InvoicePaperSize; label: string }[]
                ).map(opt => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setFormat(opt.id)}
                    className={`px-2.5 py-1 rounded-md transition-colors text-[11px] sm:text-xs cursor-pointer ${
                      format === opt.id
                        ? 'bg-white text-slate-900 shadow-xs font-semibold'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              <button
                type="button"
                onClick={onClose}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-200/60 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {printError && (
            <div className="px-4 py-2 bg-rose-50 border-b border-rose-200 text-rose-800 text-xs flex items-center gap-2 no-print">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{printError}</span>
            </div>
          )}

          {/* Invoice Content Viewport */}
          <div className="p-4 sm:p-6 max-h-[68vh] overflow-y-auto bg-slate-100/60 flex justify-center">
            {format === 'thermal' ? (
              /* Thermal POS Receipt Format (80mm standard) */
              <div
                id="printable-receipt"
                className="print-paper-white bg-white p-5 rounded-lg shadow-sm border border-slate-200 w-full max-w-[340px] text-slate-900 text-xs font-mono"
              >
                {/* Shop Info */}
                <div className="text-center space-y-1 pb-3 border-b border-dashed border-slate-300">
                  <img
                    src={shopLogo || APP_IDENTITY.symbolPath}
                    alt={shopLogo ? biz.shopName : APP_IDENTITY.name}
                    className="h-9 max-w-[120px] object-contain mx-auto mb-1"
                  />
                  <h2 className="text-sm font-bold tracking-tight text-[#101B3F] font-sans">
                    {biz.shopName}
                  </h2>
                  {biz.tagline && (
                    <p className="text-[10px] text-slate-600 font-sans">{biz.tagline}</p>
                  )}
                  {biz.branchName && (
                    <p className="text-[10px] text-slate-600 font-sans font-semibold">
                      Branch: {biz.branchName}
                    </p>
                  )}
                  {biz.address && (
                    <p className="text-[10px] text-slate-600 font-sans">{biz.address}</p>
                  )}
                  <p className="text-[10px] text-slate-600 font-sans">Mobile: {biz.mobile || '-'}</p>
                  {biz.vatRegistrationNo && (
                    <p className="text-[10px] text-slate-600 font-sans">VAT/BIN: {biz.vatRegistrationNo}</p>
                  )}
                </div>

                {/* Invoice Meta */}
                <div className="py-2 border-b border-dashed border-slate-300 text-[11px] space-y-0.5">
                  <div className="flex justify-between">
                    <span>Invoice No:</span>
                    <span className="font-bold">{sale.invoiceNumber}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Date &amp; Time:</span>
                    <span>
                      {formatDate(sale.date, 'en')} {formatTime(sale.date)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Customer:</span>
                    <span className="font-medium truncate max-w-[170px]">{sale.customerName}</span>
                  </div>
                  {sale.customerMobile && (
                    <div className="flex justify-between">
                      <span>Phone:</span>
                      <span>{sale.customerMobile}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-slate-600">
                    <span>Served By:</span>
                    <span>
                      {sale.employeeCode ? `${sale.employeeCode} · ` : ''}
                      {sale.employeeName || sale.sellerName || sale.servedBy}
                    </span>
                  </div>
                </div>

                {/* Items List */}
                <div className="py-2 border-b border-dashed border-slate-300">
                  <div className="flex justify-between font-bold text-[11px] pb-1">
                    <span>Item &amp; Qty</span>
                    <span>Amount</span>
                  </div>
                  <div className="space-y-1.5 pt-1">
                    {sale.items.map((item, idx) => (
                      <div key={idx} className="text-[11px]">
                        <div className="font-sans font-semibold text-slate-800 leading-tight">
                          {item.productName}
                        </div>
                        {(item.sku || item.variantDetails) && (
                          <div className="text-[9.5px] text-slate-500 font-mono">
                            {item.sku ? `SKU: ${item.sku}` : ''}
                            {item.variantDetails ? `${item.sku ? ' · ' : ''}${item.variantDetails}` : ''}
                          </div>
                        )}
                        <div className="flex justify-between text-slate-600 text-[10px] pt-0.5">
                          <span>
                            {item.quantity} x {formatCurrency(item.unitPrice, 'en')}
                            {item.discount > 0 && ` (-৳${item.discount})`}
                          </span>
                          <span className="font-semibold text-slate-900 font-mono-num">
                            {formatCurrency(item.total, 'en')}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Bill Calculation */}
                <div className="py-2 border-b border-dashed border-slate-300 space-y-1 text-[11px]">
                  <div className="flex justify-between text-slate-600">
                    <span>Subtotal:</span>
                    <span className="font-mono-num">{formatCurrency(sale.subtotal, 'en')}</span>
                  </div>
                  {comboDiscount > 0 && (
                    <div className="flex justify-between text-purple-700 font-semibold">
                      <span>Bundle/Combo Savings:</span>
                      <span className="font-mono-num">-{formatCurrency(comboDiscount, 'en')}</span>
                    </div>
                  )}
                  {sale.appliedOffers && sale.appliedOffers.length > 0 && (
                    <div className="text-[10px] text-purple-700 bg-purple-50/70 p-1 rounded font-sans">
                      Offer: {sale.appliedOffers.map(o => o.offerName).join(', ')}
                    </div>
                  )}
                  {additionalDiscount > 0 && (
                    <div className="flex justify-between text-emerald-700">
                      <span>Discount:</span>
                      <span className="font-mono-num">-{formatCurrency(additionalDiscount, 'en')}</span>
                    </div>
                  )}
                  {sale.vatTaxAmount > 0 && (
                    <div className="flex justify-between text-slate-600">
                      <span>VAT/Tax ({sale.vatTaxRate}%):</span>
                      <span className="font-mono-num">+{formatCurrency(sale.vatTaxAmount, 'en')}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-xs font-bold text-slate-900 pt-1 border-t border-slate-200">
                    <span>Grand Total:</span>
                    <span className="font-mono-num">{formatCurrency(sale.total, 'en')}</span>
                  </div>
                  <div className="flex justify-between text-slate-800 pt-0.5">
                    <span>Paid ({sale.paymentMethod}):</span>
                    <span className="font-mono-num font-semibold">{formatCurrency(sale.paid, 'en')}</span>
                  </div>
                  {sale.due > 0 && (
                    <div className="flex justify-between text-rose-700 font-bold">
                      <span>Due:</span>
                      <span className="font-mono-num">{formatCurrency(sale.due, 'en')}</span>
                    </div>
                  )}
                </div>

                {/* Barcode & Footer */}
                <div className="pt-3 text-center space-y-1.5">
                  <div className="flex justify-center items-center py-1">
                    <BarcodeSvg value={sale.invoiceNumber} width={180} height={32} showText={true} />
                  </div>
                  <p className="text-[10px] text-slate-600 font-sans font-medium">
                    Thank you for shopping with us!
                  </p>
                  <div className="pt-3 mx-auto w-36 border-t border-dashed border-slate-400 text-[9px] text-slate-500 font-sans">
                    Authorized Signature
                  </div>
                  <p className="text-[8.5px] text-slate-400 font-sans pt-1">
                    Powered by <span className="font-bold text-[#101B3F]">{APP_IDENTITY.name}</span> · {APP_IDENTITY.subtitle}
                  </p>
                </div>
              </div>
            ) : (
              /* A4 or A5 Invoice Layout */
              <div
                id="printable-receipt"
                className={`print-paper-white bg-white p-6 sm:p-8 rounded-lg shadow-sm border border-slate-200 w-full text-slate-900 text-xs ${
                  format === 'a5' ? 'max-w-md' : 'max-w-xl'
                }`}
              >
                {/* Header */}
                <div className="flex justify-between items-start pb-5 border-b-2 border-[#101B3F] gap-4">
                  <div className="flex items-start gap-3">
                    <img
                      src={shopLogo || APP_IDENTITY.symbolPath}
                      alt={shopLogo ? biz.shopName : APP_IDENTITY.name}
                      className="h-12 max-w-[110px] object-contain shrink-0"
                    />
                    <div>
                      <h1 className="text-lg sm:text-xl font-bold text-[#101B3F]">{biz.shopName}</h1>
                      {biz.tagline && <p className="text-xs text-slate-500 mt-0.5">{biz.tagline}</p>}
                      {biz.branchName && (
                        <p className="text-xs font-semibold text-slate-600 mt-0.5">
                          Branch: {biz.branchName}
                        </p>
                      )}
                      {biz.address && <p className="text-xs text-slate-500 mt-0.5">{biz.address}</p>}
                      <p className="text-xs text-slate-500">
                        Phone: {biz.mobile || '-'}
                        {biz.email ? ` | Email: ${biz.email}` : ''}
                      </p>
                      {biz.vatRegistrationNo && (
                        <p className="text-xs text-slate-500">VAT / BIN: {biz.vatRegistrationNo}</p>
                      )}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <span className="text-[11px] font-bold px-2.5 py-1 bg-[#101B3F] text-white border border-[#243B70] rounded-md">
                      INVOICE ({format.toUpperCase()})
                    </span>
                    <p className="text-xs font-mono font-bold text-[#101B3F] mt-2">{sale.invoiceNumber}</p>
                    <p className="text-[11px] text-slate-500">
                      {formatDate(sale.date, 'en')} · {formatTime(sale.date)}
                    </p>
                  </div>
                </div>

                {/* Bill To */}
                <div className="py-4 border-b border-slate-200 grid grid-cols-2 gap-4">
                  <div>
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                      BILL TO (CUSTOMER)
                    </span>
                    <p className="text-sm font-bold text-slate-900 mt-1">{sale.customerName}</p>
                    {sale.customerMobile && <p className="text-xs text-slate-600">Mobile: {sale.customerMobile}</p>}
                  </div>
                  <div className="text-right">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                      Payment Method &amp; Status
                    </span>
                    <p className="text-sm font-semibold capitalize mt-1 text-slate-800">
                      {sale.paymentMethod} ({sale.status === 'paid' ? 'Paid' : sale.status === 'due' ? 'Due' : 'Partial'})
                    </p>
                    <p className="text-[11px] text-slate-500">
                      Served By: {sale.employeeCode ? `${sale.employeeCode} · ` : ''}{sale.employeeName || sale.sellerName || sale.servedBy}
                    </p>
                  </div>
                </div>

                {/* Items Table */}
                <div className="py-4 overflow-x-auto">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="border-b border-slate-200 text-slate-500 text-[11px]">
                        <th className="pb-2">SL</th>
                        <th className="pb-2">Product / SKU / Variant</th>
                        <th className="pb-2 text-center">Qty</th>
                        <th className="pb-2 text-right">Unit Price</th>
                        <th className="pb-2 text-right">Disc.</th>
                        <th className="pb-2 text-right">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {sale.items.map((item, idx) => {
                        const matchedProd = products.find(p => p.id === item.productId);
                        const thumbUrl =
                          item.imageUrl ||
                          resolveProductImage(matchedProd, {
                            colorId: item.colorId,
                            variantId: item.variantId,
                            colorName: item.colorName,
                          });
                        return (
                        <tr key={idx} className="text-slate-800">
                          <td className="py-2 text-slate-400">{idx + 1}</td>
                          <td className="py-2">
                            <div className="flex items-center gap-2">
                              <ProductThumbnail
                                src={thumbUrl}
                                alt={item.productName}
                                colorHex={item.colorName ? inferColorHex(item.colorName) : undefined}
                                colorName={item.colorName}
                                size="xs"
                              />
                              <div>
                                <span className="font-semibold block">{item.productName}</span>
                                <span className="text-[10px] text-slate-500 font-mono">
                                  {item.sku ? `SKU: ${item.sku}` : ''}
                                  {item.variantDetails ? `${item.sku ? ' · ' : ''}${item.variantDetails}` : ''}
                                </span>
                              </div>
                            </div>
                          </td>
                          <td className="py-2 text-center font-mono-num">{item.quantity}</td>
                          <td className="py-2 text-right font-mono-num">{formatCurrency(item.unitPrice, lang)}</td>
                          <td className="py-2 text-right font-mono-num text-emerald-700">
                            {item.discount > 0 ? `-${formatCurrency(item.discount, lang)}` : '—'}
                          </td>
                          <td className="py-2 text-right font-mono-num font-semibold">
                            {formatCurrency(item.total, lang)}
                          </td>
                        </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Total Summary */}
                <div className="pt-3 border-t border-slate-200 flex flex-col sm:flex-row justify-between items-start gap-4">
                  <div className="pt-1">
                    <BarcodeSvg value={sale.invoiceNumber} width={150} height={30} showText={true} />
                  </div>
                  <div className="w-full sm:w-64 space-y-1.5 text-xs ml-auto">
                    <div className="flex justify-between text-slate-600">
                      <span>Subtotal:</span>
                      <span className="font-mono-num">{formatCurrency(sale.subtotal, lang)}</span>
                    </div>
                    {comboDiscount > 0 && (
                      <div className="flex justify-between text-purple-700 font-semibold">
                        <span>Bundle/Combo Savings:</span>
                        <span className="font-mono-num">-{formatCurrency(comboDiscount, lang)}</span>
                      </div>
                    )}
                    {sale.appliedOffers && sale.appliedOffers.length > 0 && (
                      <div className="text-[10px] text-purple-700 bg-purple-50/70 p-1 rounded">
                        Offer: {sale.appliedOffers.map(o => o.offerName).join(', ')}
                      </div>
                    )}
                    {additionalDiscount > 0 && (
                      <div className="flex justify-between text-emerald-700">
                        <span>Additional Discount:</span>
                        <span className="font-mono-num">-{formatCurrency(additionalDiscount, lang)}</span>
                      </div>
                    )}
                    {sale.vatTaxAmount > 0 && (
                      <div className="flex justify-between text-slate-600">
                        <span>VAT/Tax ({sale.vatTaxRate}%):</span>
                        <span className="font-mono-num">+{formatCurrency(sale.vatTaxAmount, lang)}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-sm font-bold text-slate-900 pt-1 border-t border-slate-200">
                      <span>Grand Total:</span>
                      <span className="font-mono-num">{formatCurrency(sale.total, lang)}</span>
                    </div>
                    <div className="flex justify-between text-slate-800 font-medium">
                      <span>Paid:</span>
                      <span className="font-mono-num">{formatCurrency(sale.paid, lang)}</span>
                    </div>
                    {sale.due > 0 && (
                      <div className="flex justify-between text-rose-700 font-bold">
                        <span>Due:</span>
                        <span className="font-mono-num">{formatCurrency(sale.due, lang)}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Signature & Note */}
                <div className="pt-10 flex justify-between items-end text-slate-500 text-[11px]">
                  <div>
                    <p>For exchange or return, please bring this invoice within 3 days.</p>
                    <p className="font-semibold text-slate-700 mt-1">Thank you!</p>
                  </div>
                  <div className="text-center border-t border-slate-300 pt-1 w-36">
                    <p>Authorized Signature</p>
                  </div>
                </div>
                <div className="mt-5 pt-2.5 border-t border-slate-200 flex items-center justify-between text-[10px] text-slate-400">
                  <span>Powered by <strong className="text-[#101B3F]">{APP_IDENTITY.name}</strong></span>
                  <span>{APP_IDENTITY.subtitle}</span>
                </div>
              </div>
            )}
          </div>

          {/* Footer Actions */}
          <div className="p-3 sm:p-4 bg-white border-t border-slate-200 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 no-print">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={generateWhatsAppMessage}
                className="flex-1 sm:flex-initial flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 rounded-lg border border-emerald-200 transition-colors cursor-pointer"
              >
                <MessageSquare className="w-4 h-4 text-emerald-600" />
                <span>Share WhatsApp</span>
              </button>
              <button
                type="button"
                onClick={handleCopySummary}
                className="flex-1 sm:flex-initial flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg border border-slate-200 transition-colors cursor-pointer"
              >
                <Share2 className="w-4 h-4 text-slate-600" />
                <span>{copied ? 'Copied!' : 'Copy Text'}</span>
              </button>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-3.5 py-2 text-xs md:text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-lg transition-colors border border-slate-200 cursor-pointer"
              >
                Close
              </button>
              {canPrintInvoice && (
                <>
                  <button
                    type="button"
                    onClick={handleOpenPreview}
                    className="flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs md:text-sm font-semibold text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-lg border border-slate-300 transition-colors cursor-pointer"
                  >
                    <Eye className="w-4 h-4 text-slate-700" />
                    <span>Print Preview</span>
                  </button>
                  <button
                    type="button"
                    onClick={handlePrint}
                    disabled={isPrinting}
                    className="flex items-center justify-center gap-2 px-4 py-2 text-xs md:text-sm font-semibold text-white bg-[#087F8C] bg-gradient-to-r from-[#087F8C] to-[#10B981] hover:brightness-110 disabled:opacity-60 rounded-[10px] shadow-xs transition-all cursor-pointer"
                  >
                    <Printer className="w-4 h-4" />
                    <span>{isPrinting ? 'Printing...' : 'Print Invoice'}</span>
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {previewPayload && (
        <PrintPreviewModal
          isOpen={Boolean(previewPayload)}
          title={previewPayload.title}
          html={previewPayload.html}
          paperInfo={previewPayload.paperInfo}
          showScaleGuidance={previewPayload.showScaleGuidance}
          onClose={() => setPreviewPayload(null)}
        />
      )}
    </>
  );
};
