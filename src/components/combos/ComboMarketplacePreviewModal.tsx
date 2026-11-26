import React, { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  Globe,
  Loader2,
  Minus,
  PackageCheck,
  Plus,
  ShoppingBag,
  X,
} from 'lucide-react';
import {
  Branch,
  ComboOffer,
  MarketplaceComboOrder,
  Product,
  ShopSettings,
} from '../../types';
import { resolveBusinessProfile } from '../../config/appIdentity';
import { comboOfferService } from '../../services/comboOfferService';
import { formatCurrency } from '../../utils/formatters';
import {
  buildAppPreviewComboLink,
  resolveComboMarketplaceQrUrl,
  resolvePosterProductItems,
} from '../../utils/comboPosterEngine';

interface ComboMarketplacePreviewModalProps {
  offer: ComboOffer;
  products: Product[];
  settings: ShopSettings;
  activeBranch?: Branch | null;
  onClose: () => void;
  onSubmitOrder: (params: {
    offer: ComboOffer;
    comboQuantity: number;
    customerName: string;
    customerPhone: string;
    customerAddress: string;
    paymentMethod: MarketplaceComboOrder['paymentMethod'];
    notes?: string;
    orderSource: MarketplaceComboOrder['orderSource'];
    branchId?: string;
  }) => Promise<MarketplaceComboOrder>;
}

export const ComboMarketplacePreviewModal: React.FC<ComboMarketplacePreviewModalProps> = ({
  offer,
  products,
  settings,
  activeBranch,
  onClose,
  onSubmitOrder,
}) => {
  const lang = settings.language || 'en';
  const biz = resolveBusinessProfile(settings, activeBranch);
  const resolvedItems = useMemo(
    () => resolvePosterProductItems(offer, products, offer.posterConfig?.posterProductImages),
    [offer, products]
  );

  const fulfillment = useMemo(
    () =>
      comboOfferService.checkOfferFulfillment(
        offer,
        products,
        1,
        offer.branchId && offer.branchId !== 'all' ? offer.branchId : activeBranch?.id
      ),
    [offer, products, activeBranch?.id]
  );

  const maxOrderQty = Math.max(0, fulfillment.maxCombos);
  const [comboQty, setComboQty] = useState(maxOrderQty > 0 ? 1 : 0);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerAddress, setCustomerAddress] = useState('');
  const [paymentMethod, setPaymentMethod] =
    useState<MarketplaceComboOrder['paymentMethod']>('cash_on_delivery');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [placedOrder, setPlacedOrder] = useState<MarketplaceComboOrder | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string>('');

  const qrResolved = useMemo(
    () => resolveComboMarketplaceQrUrl(offer, settings, offer.posterConfig?.customQrUrl),
    [offer, settings]
  );
  const shareUrl = qrResolved.url || buildAppPreviewComboLink(offer);

  useEffect(() => {
    if (!qrResolved.url) {
      setQrDataUrl('');
      return;
    }
    QRCode.toDataURL(qrResolved.url, { width: 160, margin: 1 })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(''));
  }, [qrResolved.url]);

  const regularUnit = Number(offer.regularTotalPrice || 0);
  const finalUnit = Number(offer.finalComboPrice || 0);
  const savingsUnit = Math.max(0, regularUnit - finalUnit);
  const discPct = comboOfferService.calculateEquivalentDiscountPercent(regularUnit, finalUnit);

  const handleCopyShareUrl = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    } catch {
      setErrorMsg('Copy failed — please copy URL manually.');
    }
  };

  const handlePlaceOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    if (maxOrderQty <= 0) {
      setErrorMsg('This combo offer is currently out of stock.');
      return;
    }
    if (comboQty < 1 || comboQty > maxOrderQty) {
      setErrorMsg(`Quantity must be between 1 and ${maxOrderQty}.`);
      return;
    }
    if (!customerName.trim() || !customerPhone.trim() || !customerAddress.trim()) {
      setErrorMsg('Customer name, phone number, and delivery address are required.');
      return;
    }

    setSubmitting(true);
    try {
      const order = await onSubmitOrder({
        offer,
        comboQuantity: comboQty,
        customerName,
        customerPhone,
        customerAddress,
        paymentMethod,
        notes,
        orderSource: 'online_storefront',
        branchId: offer.branchId && offer.branchId !== 'all' ? offer.branchId : activeBranch?.id,
      });
      setPlacedOrder(order);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to place online combo order.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-3 sm:p-5"
    >
      <div
        onClick={e => e.stopPropagation()}
        className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-teal-600 text-white flex items-center justify-center shrink-0">
              <Globe className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-slate-900 truncate">
                Online Marketplace Storefront Preview — {biz.shopName}
              </h3>
              <p className="text-[11px] text-slate-500">
                Status:{' '}
                <strong className={offer.isPublishedOnline ? 'text-emerald-700' : 'text-amber-700'}>
                  {offer.isPublishedOnline ? 'Published Online' : 'Draft / Internal Storefront Preview'}
                </strong>
                {biz.branchName ? ` · Branch: ${biz.branchName}` : ''}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCopyShareUrl}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-bold text-slate-700 cursor-pointer"
            >
              {copiedLink ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copiedLink ? 'Copied!' : 'Copy Offer Link'}</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close Online Preview"
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 grid grid-cols-1 md:grid-cols-12 gap-5 text-xs">
          {/* Left Showcase */}
          <div className="md:col-span-7 space-y-4">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 flex flex-col sm:flex-row gap-4 items-start">
              <div className="w-full sm:w-44 h-44 rounded-xl bg-white border border-slate-200 flex items-center justify-center overflow-hidden shrink-0">
                {offer.image || offer.posterImageUrl ? (
                  <img
                    src={offer.image || offer.posterImageUrl}
                    alt={offer.name}
                    className="w-full h-full object-contain"
                  />
                ) : (
                  <ShoppingBag className="w-10 h-10 text-slate-300" />
                )}
              </div>

              <div className="flex-1 min-w-0 space-y-2">
                <div className="text-[11px] font-bold uppercase tracking-wider text-teal-700">
                  {offer.comboCategory || 'Combo Offer'}
                </div>
                <h4 className="text-lg font-extrabold text-slate-900">{offer.name}</h4>
                {offer.description && (
                  <p className="text-slate-600 leading-relaxed">{offer.description}</p>
                )}

                <div className="pt-1 flex flex-wrap items-baseline gap-2.5">
                  <span className="text-2xl font-black font-mono-num text-slate-900">
                    {formatCurrency(finalUnit, lang)}
                  </span>
                  {savingsUnit > 0 && (
                    <>
                      <span className="text-xs font-mono-num text-slate-400 line-through">
                        {formatCurrency(regularUnit, lang)}
                      </span>
                      <span className="text-xs font-bold text-emerald-700 font-mono-num">
                        Save {formatCurrency(savingsUnit, lang)} ({discPct}% OFF)
                      </span>
                    </>
                  )}
                </div>

                <div className="text-[11px] font-semibold">
                  {maxOrderQty > 0 ? (
                    <span className="text-emerald-700">
                      In Stock · Up to {maxOrderQty} combo pack(s) available
                    </span>
                  ) : (
                    <span className="text-rose-600">Currently Out of Stock</span>
                  )}
                </div>
              </div>
            </div>

            {/* Included Products Breakdown */}
            <div className="space-y-2">
              <h5 className="font-bold text-slate-900">
                Included Items ({resolvedItems.length})
              </h5>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {resolvedItems.map(item => (
                  <div
                    key={item.itemKey}
                    className="p-2.5 rounded-xl border border-slate-200 bg-white flex items-center gap-2.5"
                  >
                    <div className="w-11 h-11 rounded-lg bg-slate-50 border border-slate-200 overflow-hidden flex items-center justify-center shrink-0">
                      {item.imageUrl ? (
                        <img
                          src={item.imageUrl}
                          alt={item.productName}
                          className="w-full h-full object-contain"
                        />
                      ) : (
                        <span className="text-[9px] text-slate-400 font-bold">NO IMG</span>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-bold text-slate-900 truncate">
                        {item.quantity}× {item.productName}
                      </div>
                      <div className="text-[10px] text-slate-500 truncate">
                        {item.variantDetails || 'Standard'}
                      </div>
                      <div className="text-[10px] font-mono-num text-teal-700 font-bold">
                        {item.isFree ? 'FREE ITEM' : formatCurrency(item.lineRegularTotal, lang)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {qrDataUrl && (
              <div className="p-3 rounded-xl border border-slate-200 bg-slate-50 flex items-center gap-3">
                <img src={qrDataUrl} alt="Combo QR Code" className="w-16 h-16 rounded-lg bg-white p-1 border" />
                <div className="min-w-0">
                  <div className="font-bold text-slate-800">Marketplace QR Link</div>
                  <div className="text-[11px] text-slate-500 break-all">{shareUrl}</div>
                </div>
              </div>
            )}
          </div>

          {/* Right Order Submission Form */}
          <div className="md:col-span-5">
            {placedOrder ? (
              <div className="p-5 rounded-2xl border border-emerald-200 bg-emerald-50 space-y-3 text-center">
                <div className="w-12 h-12 rounded-full bg-emerald-600 text-white mx-auto flex items-center justify-center">
                  <CheckCircle2 className="w-6 h-6" />
                </div>
                <h4 className="text-base font-extrabold text-emerald-950">
                  Online Order Submitted
                </h4>
                <p className="text-xs text-emerald-900">
                  Order <strong className="font-mono">{placedOrder.orderNumber}</strong> for{' '}
                  <strong>{placedOrder.comboQuantity}× {placedOrder.comboOfferName}</strong> has been recorded as <strong>Pending</strong>.
                </p>
                <div className="p-3 rounded-xl bg-white border border-emerald-200 text-left space-y-1 text-[11px]">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Total Payable:</span>
                    <strong className="font-mono-num text-slate-900">
                      {formatCurrency(placedOrder.totalAmount, lang)}
                    </strong>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Stock Deducted Yet:</span>
                    <strong className="text-amber-700">No (Pending Admin Confirmation)</strong>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setPlacedOrder(null)}
                  className="w-full py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-bold cursor-pointer"
                >
                  Place Another Order
                </button>
              </div>
            ) : (
              <form
                onSubmit={handlePlaceOrder}
                className="p-4 rounded-2xl border border-slate-200 bg-slate-50 space-y-3"
              >
                <h4 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                  <PackageCheck className="w-4 h-4 text-teal-600" />
                  <span>Customer Checkout Form</span>
                </h4>

                {errorMsg && (
                  <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 text-[11px] font-semibold flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                    <span>{errorMsg}</span>
                  </div>
                )}

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Combo Quantity (Max {maxOrderQty})
                  </label>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={comboQty <= 1}
                      onClick={() => setComboQty(q => Math.max(1, q - 1))}
                      className="w-8 h-8 rounded-lg border border-slate-300 bg-white flex items-center justify-center cursor-pointer disabled:opacity-40"
                    >
                      <Minus className="w-3.5 h-3.5" />
                    </button>
                    <input
                      type="number"
                      min={maxOrderQty > 0 ? 1 : 0}
                      max={maxOrderQty}
                      value={comboQty}
                      onChange={e =>
                        setComboQty(
                          Math.max(1, Math.min(maxOrderQty, Number(e.target.value) || 1))
                        )
                      }
                      className="w-20 text-center p-1.5 rounded-lg border border-slate-200 bg-white font-mono-num font-bold"
                    />
                    <button
                      type="button"
                      disabled={comboQty >= maxOrderQty}
                      onClick={() => setComboQty(q => Math.min(maxOrderQty, q + 1))}
                      className="w-8 h-8 rounded-lg border border-slate-300 bg-white flex items-center justify-center cursor-pointer disabled:opacity-40"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Customer Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={customerName}
                    onChange={e => setCustomerName(e.target.value)}
                    placeholder="Full Name"
                    className="w-full p-2 rounded-lg border border-slate-200 bg-white"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Mobile Phone *
                  </label>
                  <input
                    type="tel"
                    required
                    value={customerPhone}
                    onChange={e => setCustomerPhone(e.target.value)}
                    placeholder="01XXXXXXXXX"
                    className="w-full p-2 rounded-lg border border-slate-200 bg-white font-mono"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Delivery Address *
                  </label>
                  <textarea
                    rows={2}
                    required
                    value={customerAddress}
                    onChange={e => setCustomerAddress(e.target.value)}
                    placeholder="House, Road, Area, City"
                    className="w-full p-2 rounded-lg border border-slate-200 bg-white"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Payment Option
                  </label>
                  <select
                    value={paymentMethod}
                    onChange={e =>
                      setPaymentMethod(
                        e.target.value as MarketplaceComboOrder['paymentMethod']
                      )
                    }
                    className="w-full p-2 rounded-lg border border-slate-200 bg-white"
                  >
                    <option value="cash_on_delivery">Cash on Delivery</option>
                    <option value="bkash">bKash</option>
                    <option value="nagad">Nagad</option>
                    <option value="card">Card</option>
                    <option value="bank">Bank Transfer</option>
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Order Note (Optional)
                  </label>
                  <input
                    type="text"
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                    placeholder="Preferred delivery window or note"
                    className="w-full p-2 rounded-lg border border-slate-200 bg-white"
                  />
                </div>

                <div className="p-3 rounded-xl bg-white border border-slate-200 flex items-center justify-between">
                  <span className="font-semibold text-slate-600">Total Payable</span>
                  <span className="text-lg font-black font-mono-num text-teal-700">
                    {formatCurrency(finalUnit * Math.max(0, comboQty), lang)}
                  </span>
                </div>

                <button
                  type="submit"
                  disabled={submitting || maxOrderQty <= 0}
                  className="w-full py-2.5 rounded-xl bg-[#101B3F] hover:bg-[#19295c] text-white font-bold flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShoppingBag className="w-4 h-4" />}
                  <span>{submitting ? 'Submitting...' : 'Submit Combo Order'}</span>
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
