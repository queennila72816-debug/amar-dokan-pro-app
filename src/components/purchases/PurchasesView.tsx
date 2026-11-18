import React, { useEffect, useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { resolveBusinessProfile } from '../../config/appIdentity';
import { Purchase, PurchaseItem, PaymentMethod } from '../../types';
import { formatCurrency, formatDate, toBnNumber } from '../../utils/formatters';
import { getShopLogo, printPurchaseOrder } from '../../utils/printEngine';
import { ComboboxOption, SearchableCombobox } from '../common/SearchableCombobox';
import {
  Truck,
  Plus,
  Search,
  Trash2,
  X,
  Eye,
  Printer,
  Edit2,
} from 'lucide-react';

interface PurchasesViewProps {
  isAddModalOpen?: boolean;
  onCloseAddModal?: () => void;
}

export const PurchasesView: React.FC<PurchasesViewProps> = ({ isAddModalOpen: propIsAddModalOpen, onCloseAddModal: propOnCloseAddModal }) => {
  const { purchases, suppliers, products, recordPurchase, updatePurchase, deletePurchase, isAdmin, settings, branches, activeBranchId, hasPermission } = useApp();
  const canEditPurchase = isAdmin || hasPermission('purchase_management', 'edit');
  const canDeletePurchase = isAdmin || hasPermission('purchase_management', 'delete');
  const lang = settings.language;
  const activeBranch = branches.find(b => b.id === activeBranchId) || branches[0];
  const biz = resolveBusinessProfile(settings, activeBranch);
  const shopLogo = getShopLogo(settings);

  const [searchQuery, setSearchQuery] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(propIsAddModalOpen || false);
  const [editingPurchase, setEditingPurchase] = useState<Purchase | null>(null);
  const [isSubmittingPurchase, setIsSubmittingPurchase] = useState(false);
  const [selectedPurchase, setSelectedPurchase] = useState<Purchase | null>(null);
  const [purchaseToDelete, setPurchaseToDelete] = useState<Purchase | null>(null);
  const [isDeletingPurchase, setIsDeletingPurchase] = useState(false);

  React.useEffect(() => {
    if (propIsAddModalOpen === true) {
      handleOpenAdd();
    } else if (propIsAddModalOpen === false) {
      setIsModalOpen(false);
    }
  }, [propIsAddModalOpen]);

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingPurchase(null);
    if (propOnCloseAddModal) propOnCloseAddModal();
  };

  // Purchase Form State
  const activeProducts = useMemo(
    () => products.filter(p => p.isActive !== false),
    [products]
  );
  const [supplierId, setSupplierId] = useState(suppliers[0]?.id || '');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [items, setItems] = useState<PurchaseItem[]>([
    {
      productId: activeProducts[0]?.id || '',
      productName: activeProducts[0]?.name || '',
      quantity: 10,
      purchasePrice: activeProducts[0]?.purchasePrice || 500,
      total: (activeProducts[0]?.purchasePrice || 500) * 10,
    },
  ]);

  useEffect(() => {
    if (!supplierId && suppliers.length > 0) {
      setSupplierId(suppliers[0].id);
    }
  }, [suppliers, supplierId]);

  useEffect(() => {
    if (activeProducts.length > 0 && items.length === 1 && !items[0].productId) {
      const first = activeProducts[0];
      setItems([
        {
          productId: first.id,
          productName: first.name,
          quantity: 10,
          purchasePrice: first.purchasePrice,
          total: first.purchasePrice * 10,
        },
      ]);
    }
  }, [activeProducts, items]);

  const supplierOptions = useMemo<ComboboxOption[]>(
    () =>
      suppliers.map(s => ({
        id: s.id,
        label: s.company
          ? s.name && s.name !== s.company
            ? `${s.company} (${s.name})`
            : s.company
          : s.name,
        sublabel: s.mobile ? `Phone: ${s.mobile}` : undefined,
        badge: `Due: ৳${s.currentDue}`,
        searchText: [s.company, s.name, s.mobile, s.email].filter(Boolean).join(' '),
      })),
    [suppliers]
  );

  const productOptions = useMemo<ComboboxOption[]>(
    () =>
      activeProducts.map(p => ({
        id: p.id,
        label: p.name,
        sublabel: [p.code ? `SKU: ${p.code}` : '', p.category || '', p.brand || '']
          .filter(Boolean)
          .join(' · '),
        badge: `Stock: ${p.currentStock} | ৳${p.purchasePrice}`,
        searchText: [p.name, p.code, p.barcode, p.category, p.brand]
          .filter(Boolean)
          .join(' '),
      })),
    [activeProducts]
  );

  const [discount, setDiscount] = useState<number>(0);
  const [transportCost, setTransportCost] = useState<number>(0);
  const [loadingCost, setLoadingCost] = useState<number>(0);
  const [packagingCost, setPackagingCost] = useState<number>(0);
  const [otherCost, setOtherCost] = useState<number>(0);
  const [paidAmount, setPaidAmount] = useState<number | ''>('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [notes, setNotes] = useState('');

  // Landed Cost & Total Calculations
  const totalDirectCosts = Math.max(0, transportCost || 0) + Math.max(0, loadingCost || 0) + Math.max(0, packagingCost || 0) + Math.max(0, otherCost || 0);
  const totalQuantity = items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
  const subtotal = items.reduce((sum, item) => sum + item.total, 0);
  const total = Math.max(0, subtotal - Math.max(0, discount || 0) + totalDirectCosts);
  const landedCost = subtotal + totalDirectCosts;
  const landedCostPerUnit = totalQuantity > 0 ? (landedCost / totalQuantity) : 0;
  const effectivePaid = paidAmount === '' ? total : Math.max(0, Number(paidAmount) || 0);
  const due = Math.max(0, total - effectivePaid);

  const handleOpenAdd = () => {
    setEditingPurchase(null);
    setSupplierId(suppliers[0]?.id || '');
    setInvoiceNumber(`BILL-${Math.floor(1000 + Math.random() * 9000)}`);
    if (activeProducts.length > 0) {
      setItems([
        {
          productId: activeProducts[0].id,
          productName: activeProducts[0].name,
          quantity: 10,
          purchasePrice: activeProducts[0].purchasePrice,
          total: activeProducts[0].purchasePrice * 10,
        },
      ]);
    }
    setDiscount(0);
    setTransportCost(0);
    setLoadingCost(0);
    setPackagingCost(0);
    setOtherCost(0);
    setPaidAmount('');
    setPaymentMethod('cash');
    setNotes('');
    setIsModalOpen(true);
  };

  const handleOpenEdit = (purchase: Purchase) => {
    setEditingPurchase(purchase);
    setSupplierId(purchase.supplierId || suppliers[0]?.id || '');
    setInvoiceNumber(purchase.invoiceNumber);
    setItems(
      purchase.items.map(it => ({
        ...it,
      }))
    );
    setDiscount(purchase.discount || 0);
    setTransportCost(purchase.transportCost || 0);
    setLoadingCost(purchase.loadingCost || 0);
    setPackagingCost(purchase.packagingCost || 0);
    setOtherCost(purchase.otherCost || 0);
    setPaidAmount(purchase.paid);
    setPaymentMethod(purchase.paymentMethod);
    setNotes(purchase.notes || '');
    setIsModalOpen(true);
  };

  const handleItemChange = (index: number, field: 'productId' | 'quantity' | 'purchasePrice', value: any) => {
    setItems(prev => {
      const updated = [...prev];
      const item = { ...updated[index] };

      if (field === 'productId') {
        const prod = products.find(p => p.id === value);
        if (prod) {
          item.productId = prod.id;
          item.productName = prod.name;
          item.purchasePrice = prod.purchasePrice;
          item.total = prod.purchasePrice * item.quantity;
        }
      } else if (field === 'quantity') {
        item.quantity = Number(value) || 0;
        item.total = item.quantity * item.purchasePrice;
      } else if (field === 'purchasePrice') {
        item.purchasePrice = Number(value) || 0;
        item.total = item.quantity * item.purchasePrice;
      }

      updated[index] = item;
      return updated;
    });
  };

  const addItemRow = () => {
    const firstProd = activeProducts[0] || products[0];
    if (!firstProd) return;
    setItems(prev => [
      ...prev,
      {
        productId: firstProd.id,
        productName: firstProd.name,
        quantity: 5,
        purchasePrice: firstProd.purchasePrice,
        total: firstProd.purchasePrice * 5,
      },
    ]);
  };

  const removeItemRow = (index: number) => {
    if (items.length <= 1) return;
    setItems(prev => prev.filter((_, idx) => idx !== index));
  };

  const handleSubmitPurchase = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingPurchase || !supplierId || items.length === 0) {
      if (!supplierId) alert('Please select a supplier!');
      return;
    }

    const supp = suppliers.find(s => s.id === supplierId);
    if (!supp) {
      alert('Selected supplier was not found.');
      return;
    }

    const invalidItem = items.find(it => !it.productId || Number(it.quantity) <= 0 || Number(it.purchasePrice) < 0);
    if (invalidItem) {
      alert('Each purchase item must have a valid product, quantity >= 1, and non-negative unit price.');
      return;
    }

    setIsSubmittingPurchase(true);
    const payload = {
      invoiceNumber: invoiceNumber.trim() || undefined,
      supplierId: supp.id,
      supplierName: supp.company || supp.name,
      items: items.map(it => ({
        ...it,
        landedCostPerUnit:
          totalQuantity > 0
            ? Math.round((((it.quantity * it.purchasePrice) + ((it.quantity / totalQuantity) * totalDirectCosts)) / it.quantity) * 100) / 100
            : it.purchasePrice,
      })),
      subtotal,
      discount: discount || 0,
      transportCost: transportCost || 0,
      loadingCost: loadingCost || 0,
      packagingCost: packagingCost || 0,
      otherCost: otherCost || 0,
      total,
      paid: effectivePaid,
      due,
      paymentMethod,
      branchId: editingPurchase?.branchId || activeBranchId,
      notes,
    };

    try {
      if (editingPurchase) {
        await updatePurchase(editingPurchase.id, {
          ...payload,
          invoiceNumber: payload.invoiceNumber || editingPurchase.invoiceNumber,
        });
      } else {
        await recordPurchase(payload);
      }
      closeModal();
    } catch (err: any) {
      alert(`Failed to save purchase: ${err.message || 'Database transaction error'}`);
    } finally {
      setIsSubmittingPurchase(false);
    }
  };

  const filteredPurchases = purchases.filter(p =>
    p.invoiceNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
    p.supplierName.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-4">
      {/* Top Header */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <span className="p-1.5 rounded-[8px] bg-[#4169E1]/15 text-[#4169E1]">
              <Truck className="w-5 h-5" />
            </span>
            <span>{'Purchase Invoices'}</span>
          </h2>
          <p className="text-xs text-slate-600 mt-0.5">
            {'Receiving purchases automatically increments stock & logs supplier dues'}
          </p>
        </div>

        <button
          onClick={handleOpenAdd}
          className="flex items-center gap-2 px-3.5 py-2 text-xs md:text-sm font-semibold text-white bg-[#4169E1] hover:brightness-110 rounded-[10px] shadow-xs transition-all self-start md:self-auto cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>{'New Purchase'}</span>
        </button>
      </div>

      {/* Filter Bar */}
      <div className="bg-white rounded-xl border border-slate-200 p-3 shadow-xs flex items-center gap-2 text-xs">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-2 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={'Search invoice or supplier...'}
            className="w-full pl-9 pr-3 py-1.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500 bg-slate-50/50"
          />
        </div>
      </div>

      {/* Purchases Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
              <tr>
                <th className="px-4 py-3 font-semibold">{'Invoice #'}</th>
                <th className="px-4 py-3 font-semibold">{'Date'}</th>
                <th className="px-4 py-3 font-semibold">{'Supplier'}</th>
                <th className="px-4 py-3 font-semibold text-center">{'Items'}</th>
                <th className="px-4 py-3 font-semibold text-right">{'Total'}</th>
                <th className="px-4 py-3 font-semibold text-right">{'Paid'}</th>
                <th className="px-4 py-3 font-semibold text-right">{'Due'}</th>
                <th className="px-4 py-3 font-semibold">{'Method'}</th>
                <th className="px-4 py-3 font-semibold text-right">{'Actions'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredPurchases.map(purchase => (
                <tr key={purchase.id} className="hover:bg-slate-50/80 transition-colors">
                  <td className="px-4 py-3 font-mono font-bold text-slate-900">
                    {purchase.invoiceNumber}
                  </td>
                  <td className="px-4 py-3 text-slate-600 whitespace-nowrap">
                    {formatDate(purchase.date, lang)}
                  </td>
                  <td className="px-4 py-3 font-medium text-slate-900">
                    {purchase.supplierName}
                  </td>
                  <td className="px-4 py-3 text-center font-mono-num text-slate-700">
                    {toBnNumber(purchase.items.length)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono-num font-bold text-slate-900">
                    {formatCurrency(purchase.total, lang)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono-num text-emerald-700 font-semibold">
                    {formatCurrency(purchase.paid, lang)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono-num font-bold">
                    <span className={purchase.due > 0 ? 'text-rose-700' : 'text-slate-400'}>
                      {purchase.due > 0 ? formatCurrency(purchase.due, lang) : '—'}
                    </span>
                  </td>
                  <td className="px-4 py-3 capitalize text-slate-700">
                    {purchase.paymentMethod}
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        onClick={() => setSelectedPurchase(purchase)}
                        className="flex items-center gap-1 px-2 py-1 text-slate-700 bg-slate-100 hover:bg-slate-200 rounded font-medium transition-colors"
                        title={'View Bill Details'}
                      >
                        <Eye className="w-3.5 h-3.5" />
                        <span>{'View'}</span>
                      </button>

                      {canEditPurchase && (
                        <button
                          onClick={() => handleOpenEdit(purchase)}
                          className="p-1 text-slate-500 hover:text-[#4169E1] hover:bg-indigo-50 rounded transition-colors"
                          title={'Edit Purchase Bill'}
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                      )}

                      {canDeletePurchase && (
                        <button
                          onClick={() => setPurchaseToDelete(purchase)}
                          className="p-1 text-rose-500 hover:text-rose-700 hover:bg-rose-50 rounded transition-colors"
                          title={'Delete Purchase (Authorized Only)'}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}

              {filteredPurchases.length === 0 && (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-slate-400 text-xs">
                    {'No purchase records found.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* New Purchase Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 w-full max-w-2xl overflow-hidden my-6">
            <div className="p-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
              <h3 className="font-bold text-sm md:text-base text-slate-900 flex items-center gap-2">
                <Truck className="w-5 h-5 text-[#4169E1]" />
                <span>{editingPurchase ? 'Edit Purchase Order' : 'New Purchase Order'}</span>
              </h3>
              <button
                onClick={closeModal}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-md cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmitPurchase} className="p-5 space-y-4 max-h-[75vh] overflow-y-auto text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">{'Supplier *'}</label>
                  <SearchableCombobox
                    ariaLabel={'Select Supplier'}
                    options={supplierOptions}
                    value={supplierId}
                    onChange={setSupplierId}
                    placeholder={'Type to search supplier...'}
                    emptyMessage={'No matching suppliers found'}
                    size="md"
                  />
                </div>

                <div>
                  <label className="block font-medium text-slate-700 mb-1">{'Bill / Invoice #'}</label>
                  <input
                    type="text"
                    value={invoiceNumber}
                    onChange={(e) => setInvoiceNumber(e.target.value)}
                    placeholder="BILL-001"
                    className="w-full p-2 border border-slate-200 rounded-lg font-mono"
                  />
                </div>
              </div>

              {/* Items Table */}
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                <div className="flex items-center justify-between pb-1 border-b">
                  <span className="font-bold text-slate-800">{'Purchase Items'}</span>
                  <button
                    type="button"
                    onClick={addItemRow}
                    className="text-xs font-semibold text-emerald-700 hover:underline flex items-center gap-1"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>{'+ Add Item'}</span>
                  </button>
                </div>

                <div className="space-y-2">
                  {items.map((item, idx) => (
                    <div key={idx} className="grid grid-cols-12 gap-2 items-center bg-white p-2 rounded-lg border border-slate-200">
                      <div className="col-span-5">
                        <SearchableCombobox
                          ariaLabel={'Select Product'}
                          options={productOptions}
                          value={item.productId}
                          onChange={(selectedProdId) => handleItemChange(idx, 'productId', selectedProdId)}
                          placeholder={'Type to search product...'}
                          emptyMessage={'No matching products found'}
                          size="sm"
                        />
                      </div>

                      <div className="col-span-2">
                        <input
                          type="number"
                          min="1"
                          placeholder="Qty"
                          value={item.quantity}
                          onChange={(e) => handleItemChange(idx, 'quantity', e.target.value)}
                          className="w-full p-1.5 border border-slate-200 rounded text-xs font-mono-num text-center"
                        />
                      </div>

                      <div className="col-span-2">
                        <input
                          type="number"
                          min="0"
                          placeholder="Rate"
                          value={item.purchasePrice}
                          onChange={(e) => handleItemChange(idx, 'purchasePrice', e.target.value)}
                          className="w-full p-1.5 border border-slate-200 rounded text-xs font-mono-num text-right"
                        />
                      </div>

                      <div className="col-span-2 text-right font-mono-num font-bold text-slate-900">
                        {formatCurrency(item.total, lang)}
                      </div>

                      <div className="col-span-1 text-center">
                        {items.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeItemRow(idx)}
                            className="text-rose-500 hover:text-rose-700"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Direct Purchase Costs Breakdown & Discount */}
              <div className="space-y-2">
                <span className="text-[11px] font-bold text-slate-800 block">
                  Direct Purchase Costs (Landed Cost Allocation)
                </span>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                  <div>
                    <label className="block text-[10px] font-medium text-slate-600 mb-1">{'Discount (৳)'}</label>
                    <input
                      type="number"
                      min="0"
                      value={discount || ''}
                      onChange={(e) => setDiscount(Math.max(0, Number(e.target.value) || 0))}
                      className="w-full p-1.5 border border-slate-200 rounded font-mono-num text-right"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-medium text-slate-600 mb-1">{'Transport Cost (৳)'}</label>
                    <input
                      type="number"
                      min="0"
                      value={transportCost || ''}
                      onChange={(e) => setTransportCost(Math.max(0, Number(e.target.value) || 0))}
                      className="w-full p-1.5 border border-slate-200 rounded font-mono-num text-right"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-medium text-slate-600 mb-1">{'Loading/Unloading (৳)'}</label>
                    <input
                      type="number"
                      min="0"
                      value={loadingCost || ''}
                      onChange={(e) => setLoadingCost(Math.max(0, Number(e.target.value) || 0))}
                      className="w-full p-1.5 border border-slate-200 rounded font-mono-num text-right"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-medium text-slate-600 mb-1">{'Packaging/Tags (৳)'}</label>
                    <input
                      type="number"
                      min="0"
                      value={packagingCost || ''}
                      onChange={(e) => setPackagingCost(Math.max(0, Number(e.target.value) || 0))}
                      className="w-full p-1.5 border border-slate-200 rounded font-mono-num text-right"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-medium text-slate-600 mb-1">{'Other Costs (৳)'}</label>
                    <input
                      type="number"
                      min="0"
                      value={otherCost || ''}
                      onChange={(e) => setOtherCost(Math.max(0, Number(e.target.value) || 0))}
                      className="w-full p-1.5 border border-slate-200 rounded font-mono-num text-right"
                    />
                  </div>
                </div>

                {/* Landed Cost Breakdown Alert Box */}
                <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center justify-between text-xs">
                  <div>
                    <span className="font-bold text-emerald-900 block">
                      Total Landed Batch Cost: {formatCurrency(landedCost, lang)}
                    </span>
                    <span className="text-[10px] text-emerald-700">
                      Base items (৳{subtotal.toLocaleString()}) + Direct costs (৳{totalDirectCosts.toLocaleString()})
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="text-[10px] text-slate-500 uppercase block font-semibold">Landed Cost / Piece</span>
                    <span className="font-mono-num font-bold text-sm text-emerald-800">
                      ৳{landedCostPerUnit.toFixed(2)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Payment Row */}
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                <div className="flex justify-between items-center text-sm font-bold text-slate-900">
                  <span>{'Total Payable:'}</span>
                  <span className="font-mono-num text-emerald-800 text-base">{formatCurrency(total, lang)}</span>
                </div>

                <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-200">
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">{'Paid Amount *'}</label>
                    <input
                      type="number"
                      min="0"
                      value={paidAmount}
                      onChange={(e) => setPaidAmount(e.target.value === '' ? '' : Math.max(0, Number(e.target.value) || 0))}
                      placeholder={total.toString()}
                      className="w-full p-2 border border-slate-200 rounded-lg font-mono-num font-bold bg-white"
                    />
                  </div>

                  <div>
                    <label className="block font-medium text-slate-700 mb-1">{'Payment Method'}</label>
                    <select
                      aria-label={'Payment Method'}
                      value={paymentMethod}
                      onChange={(e) => setPaymentMethod(e.target.value as any)}
                      className="w-full p-2 border border-slate-200 rounded-lg bg-white capitalize"
                    >
                      <option value="cash">Cash</option>
                      <option value="bank">Bank</option>
                      <option value="bkash">bKash</option>
                    </select>
                  </div>
                </div>

                {due > 0 && (
                  <div className="flex justify-between text-xs font-bold text-rose-700 bg-rose-50 p-2 rounded-lg">
                    <span>{'Pending Due:'}</span>
                    <span className="font-mono-num">{formatCurrency(due, lang)}</span>
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t">
                <button
                  type="button"
                  onClick={closeModal}
                  className="px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-lg"
                >
                  {'Cancel'}
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingPurchase}
                  className="px-5 py-2 text-xs font-bold text-white bg-[#4169E1] hover:brightness-110 disabled:opacity-50 rounded-[10px] shadow-xs transition-all cursor-pointer"
                >
                  {isSubmittingPurchase
                    ? 'Saving...'
                    : editingPurchase
                    ? 'Update Purchase'
                    : 'Confirm Purchase'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* View Purchase Modal */}
      {selectedPurchase && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 w-full max-w-lg p-5 space-y-4">
            <div className="flex items-center justify-between border-b pb-2">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-600">
                  <Truck className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-slate-900">
                    {'Purchase Bill Details'}
                  </h3>
                  <span className="text-[11px] text-slate-500 font-mono">
                    {selectedPurchase.invoiceNumber} · {selectedPurchase.supplierName}
                  </span>
                </div>
              </div>
              <button
                onClick={() => setSelectedPurchase(null)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Business Identity Header */}
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl flex items-start gap-3 text-xs">
              {shopLogo && (
                <img
                  src={shopLogo}
                  alt={biz.shopName}
                  className="h-10 max-w-[80px] object-contain shrink-0"
                />
              )}
              <div className="min-w-0">
                <div className="font-bold text-slate-900 text-sm">{biz.shopName}</div>
                {biz.branchName && (
                  <div className="text-[11px] font-semibold text-emerald-700">Branch: {biz.branchName}</div>
                )}
                {biz.address && <div className="text-[11px] text-slate-600">{biz.address}</div>}
                <div className="text-[11px] text-slate-600">
                  Phone: {biz.mobile || '-'}
                  {biz.vatRegistrationNo ? ` · BIN: ${biz.vatRegistrationNo}` : ''}
                </div>
              </div>
            </div>

            <div className="space-y-3 text-xs">
              <div className="flex justify-between text-slate-600">
                <span>{'Date'}:</span>
                <span className="font-medium text-slate-900">{formatDate(selectedPurchase.date, lang)}</span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>{'Payment Method'}:</span>
                <span className="font-medium text-slate-900 capitalize">{selectedPurchase.paymentMethod}</span>
              </div>

              <div className="border rounded-lg overflow-hidden">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 border-b text-slate-600">
                    <tr>
                      <th className="p-2 font-semibold">{'Item'}</th>
                      <th className="p-2 font-semibold text-center">{'Qty'}</th>
                      <th className="p-2 font-semibold text-right">{'Price'}</th>
                      <th className="p-2 font-semibold text-right">{'Total'}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {selectedPurchase.items.map((item, idx) => (
                      <tr key={idx}>
                        <td className="p-2 font-medium text-slate-900">{item.productName}</td>
                        <td className="p-2 text-center font-mono-num">{toBnNumber(item.quantity)}</td>
                        <td className="p-2 text-right font-mono-num">{formatCurrency(item.purchasePrice, lang)}</td>
                        <td className="p-2 text-right font-mono-num font-bold">{formatCurrency(item.total, lang)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {(() => {
                const viewDirectCosts =
                  (selectedPurchase.transportCost || 0) +
                  (selectedPurchase.loadingCost || 0) +
                  (selectedPurchase.packagingCost || 0) +
                  (selectedPurchase.otherCost || 0);
                return (
                  <div className="bg-slate-50 p-3 rounded-xl space-y-1.5 border border-slate-200">
                    <div className="flex justify-between text-slate-600">
                      <span>{'Items Subtotal'}:</span>
                      <span className="font-mono-num">{formatCurrency(selectedPurchase.subtotal, lang)}</span>
                    </div>
                    {selectedPurchase.discount > 0 && (
                      <div className="flex justify-between text-emerald-700">
                        <span>{'Discount'}:</span>
                        <span className="font-mono-num">-{formatCurrency(selectedPurchase.discount, lang)}</span>
                      </div>
                    )}
                    {viewDirectCosts > 0 && (
                      <div className="flex justify-between text-slate-600">
                        <span>{'Direct Costs (Transport/Loading/Packaging)'}:</span>
                        <span className="font-mono-num">+{formatCurrency(viewDirectCosts, lang)}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-slate-900 font-bold pt-1 border-t border-slate-200">
                      <span>{'Total Bill'}:</span>
                      <span className="font-mono-num">{formatCurrency(selectedPurchase.total, lang)}</span>
                    </div>
                    <div className="flex justify-between text-emerald-700">
                      <span>{'Paid'}:</span>
                      <span className="font-mono-num font-bold">{formatCurrency(selectedPurchase.paid, lang)}</span>
                    </div>
                    {selectedPurchase.due > 0 && (
                      <div className="flex justify-between text-rose-700 font-bold">
                        <span>{'Due'}:</span>
                        <span className="font-mono-num">{formatCurrency(selectedPurchase.due, lang)}</span>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t">
              <button
                type="button"
                onClick={() => printPurchaseOrder(selectedPurchase, settings, activeBranch)}
                className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg cursor-pointer"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>{'Print Purchase Order'}</span>
              </button>
              <button
                type="button"
                onClick={() => setSelectedPurchase(null)}
                className="px-4 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg"
              >
                {'Close'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Purchase Confirmation Modal */}
      {purchaseToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl shadow-xl border border-rose-200 w-full max-w-md p-5 space-y-4">
            <div className="flex items-center justify-between border-b pb-2">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-rose-100 flex items-center justify-center text-rose-600">
                  <Trash2 className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-slate-900">
                    {'Delete Purchase?'}
                  </h3>
                  <span className="text-[11px] text-slate-500 font-mono">
                    {purchaseToDelete.invoiceNumber} · {purchaseToDelete.supplierName}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setPurchaseToDelete(null)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-2 text-xs text-slate-700">
              <p className="font-medium text-slate-800">
                {'Are you sure you want to delete this purchase? Related stock, supplier balance and account transactions may be affected.'}
              </p>
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl space-y-1 text-rose-900 text-[11px]">
                <div className="flex justify-between font-semibold">
                  <span>{'Total Amount'}:</span>
                  <span className="font-mono-num">{formatCurrency(purchaseToDelete.total, lang)}</span>
                </div>
                <div className="flex justify-between text-emerald-800">
                  <span>{'Paid to restore to account'}:</span>
                  <span className="font-mono-num">{formatCurrency(purchaseToDelete.paid, lang)}</span>
                </div>
                {purchaseToDelete.due > 0 && (
                  <div className="flex justify-between text-rose-800">
                    <span>{'Supplier due reduced'}:</span>
                    <span className="font-mono-num">{formatCurrency(purchaseToDelete.due, lang)}</span>
                  </div>
                )}
                <p className="pt-1 text-rose-700 text-[10px]">
                  {'⚠ Purchased items will be deducted from product stock inventory.'}
                </p>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t">
              <button
                type="button"
                disabled={isDeletingPurchase}
                onClick={() => setPurchaseToDelete(null)}
                className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded-lg font-medium"
              >
                {'Cancel'}
              </button>
              <button
                type="button"
                disabled={isDeletingPurchase}
                onClick={async () => {
                  setIsDeletingPurchase(true);
                  try {
                    await deletePurchase(purchaseToDelete.id);
                    setPurchaseToDelete(null);
                  } catch (err: any) {
                    alert(`Failed to delete purchase: ${err.message || 'Database error'}`);
                  } finally {
                    setIsDeletingPurchase(false);
                  }
                }}
                className="px-4 py-1.5 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-lg flex items-center gap-1.5 shadow-xs transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{isDeletingPurchase ? ('Deleting...') : ('Delete Purchase')}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
