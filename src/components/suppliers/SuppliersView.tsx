import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { resolveBusinessProfile } from '../../config/appIdentity';
import { Supplier, PaymentMethod } from '../../types';
import { formatCurrency, formatDate, toBnNumber } from '../../utils/formatters';
import { getShopLogo, printSupplierStatement } from '../../utils/printEngine';
import {
  Building,
  Plus,
  Search,
  CreditCard,
  X,
  FileText,
  Trash2,
  AlertTriangle,
  Printer,
} from 'lucide-react';

export const SuppliersView: React.FC = () => {
  const { suppliers, supplierTransactions, addSupplier, updateSupplier, deleteSupplier, isAdmin, paySupplierDue, accounts, settings, branches, activeBranchId, hasPermission } = useApp();
  const canPaySupplierDue = isAdmin || hasPermission('due_collection', 'create');
  const canEditSupplier = isAdmin || hasPermission('supplier_management', 'edit');
  const canDeleteSupplier = isAdmin || hasPermission('supplier_management', 'delete');
  const lang = settings.language;
  const activeBranch = branches.find(b => b.id === activeBranchId) || branches[0];
  const biz = resolveBusinessProfile(settings, activeBranch);
  const shopLogo = getShopLogo(settings);

  const [searchQuery, setSearchQuery] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [ledgerSupplier, setLedgerSupplier] = useState<Supplier | null>(null);

  // Delete Supplier State
  const [supplierToDelete, setSupplierToDelete] = useState<Supplier | null>(null);
  const [deleteSupplierError, setDeleteSupplierError] = useState<string | null>(null);

  // Pay Due Modal
  const [payingSupplier, setPayingSupplier] = useState<Supplier | null>(null);
  const [payAmount, setPayAmount] = useState<number | ''>('');
  const [payMethod, setPayMethod] = useState<PaymentMethod>('cash');
  const [payAccountId, setPayAccountId] = useState(accounts[0]?.id || '');
  const [payNote, setPayNote] = useState('');

  // Form
  const [name, setName] = useState('');
  const [company, setCompany] = useState('');
  const [mobile, setMobile] = useState('');
  const [address, setAddress] = useState('');
  const [email, setEmail] = useState('');
  const [openingDue, setOpeningDue] = useState<number | ''>('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  React.useEffect(() => {
    if (accounts.length > 0 && (!payAccountId || !accounts.some(a => a.id === payAccountId))) {
      setPayAccountId(accounts[0].id);
    }
  }, [accounts, payAccountId]);

  const totalSupplierDue = suppliers.reduce((sum, s) => sum + s.currentDue, 0);

  const handleOpenAdd = () => {
    setEditingSupplier(null);
    setName('');
    setCompany('');
    setMobile('');
    setAddress('');
    setEmail('');
    setOpeningDue('');
    setIsModalOpen(true);
  };

  const handleOpenEdit = (s: Supplier) => {
    setEditingSupplier(s);
    setName(s.name);
    setCompany(s.company);
    setMobile(s.mobile);
    setAddress(s.address || '');
    setEmail(s.email || '');
    setOpeningDue('');
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    if (!name.trim() || !company.trim() || !mobile.trim()) {
      alert('Company name, contact person, and mobile number are required.');
      return;
    }

    const parsedOpeningDue = openingDue === '' ? 0 : Number(openingDue);
    if (parsedOpeningDue < 0) {
      alert('Opening due cannot be negative.');
      return;
    }

    setIsSubmitting(true);
    try {
      if (editingSupplier) {
        await updateSupplier(editingSupplier.id, {
          name: name.trim(),
          company: company.trim(),
          mobile: mobile.trim(),
          address: address.trim() || undefined,
          email: email.trim() || undefined,
        });
      } else {
        await addSupplier({
          name: name.trim(),
          company: company.trim(),
          mobile: mobile.trim(),
          address: address.trim() || undefined,
          email: email.trim() || undefined,
          openingDue: parsedOpeningDue,
        });
      }

      setIsModalOpen(false);
    } catch (err: any) {
      alert(`Supplier save failed: ${err.message || 'Database error'}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOpenPay = (s: Supplier) => {
    setPayingSupplier(s);
    setPayAmount(s.currentDue);
    setPayMethod('cash');
    setPayAccountId(accounts[0]?.id || '');
    setPayNote('Supplier due payment');
  };

  const handleSubmitPay = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting || !payingSupplier) return;

    const amount = Number(payAmount);
    if (!amount || amount <= 0) {
      alert('Please enter a valid payment amount greater than 0.');
      return;
    }
    if (amount > payingSupplier.currentDue) {
      alert(`Payment amount cannot exceed payable due balance (৳${payingSupplier.currentDue}).`);
      return;
    }

    const targetAccountId = payAccountId || accounts[0]?.id;
    if (!targetAccountId) {
      alert('Please select a valid payment account.');
      return;
    }

    setIsSubmitting(true);
    try {
      await paySupplierDue(
        payingSupplier.id,
        amount,
        payMethod,
        targetAccountId,
        payNote
      );

      setPayingSupplier(null);
    } catch (err: any) {
      alert(`Supplier payment failed: ${err.message || 'Database error'}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const filteredSuppliers = suppliers.filter(s =>
    s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    s.company.toLowerCase().includes(searchQuery.toLowerCase()) ||
    s.mobile.includes(searchQuery)
  );

  return (
    <div className="space-y-4">
      {/* Top Banner */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs">
          <span className="text-xs text-slate-500 block">{'Total Suppliers'}</span>
          <span className="text-xl md:text-2xl font-bold font-mono-num text-slate-900 mt-1 block">
            {toBnNumber(suppliers.length)}
          </span>
          <span className="text-[11px] text-slate-500 mt-0.5 block">
            {'Registered vendors & distributors'}
          </span>
        </div>

        <div className="bg-white rounded-xl border border-rose-200 bg-rose-50/40 p-4 shadow-xs">
          <span className="text-xs text-rose-800 font-semibold block">
            {'Total Payable Due'}
          </span>
          <span className="text-xl md:text-2xl font-bold font-mono-num text-rose-900 mt-1 block">
            {formatCurrency(totalSupplierDue, lang)}
          </span>
          <span className="text-[11px] text-rose-700 mt-0.5 block">
            {'Outstanding payable liability'}
          </span>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs flex items-center justify-between">
          <div>
            <span className="text-xs text-slate-500 block">{'Add Supplier'}</span>
            <span className="text-xs text-slate-700 mt-1 block font-medium">
              {'Save vendor details'}
            </span>
          </div>
          <button
            onClick={handleOpenAdd}
            className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-[#4169E1] hover:brightness-110 rounded-[10px] shadow-xs transition-all cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>{'Add'}</span>
          </button>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="bg-white rounded-xl border border-slate-200 p-3 shadow-xs flex items-center gap-2 text-xs">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-2 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={'Search company, supplier name, phone...'}
            className="w-full pl-9 pr-3 py-1.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500 bg-slate-50/50"
          />
        </div>
      </div>

      {/* Suppliers Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
              <tr>
                <th className="px-4 py-3 font-semibold">{'Company & Supplier'}</th>
                <th className="px-4 py-3 font-semibold">{'Mobile'}</th>
                <th className="px-4 py-3 font-semibold">{'Address'}</th>
                <th className="px-4 py-3 font-semibold text-right">{'Total Purchase'}</th>
                <th className="px-4 py-3 font-semibold text-right">{'Total Paid'}</th>
                <th className="px-4 py-3 font-semibold text-right">{'Current Due'}</th>
                <th className="px-4 py-3 font-semibold text-right">{'Actions'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredSuppliers.map(supplier => (
                <tr key={supplier.id} className="hover:bg-slate-50/80 transition-colors">
                  <td className="px-4 py-3">
                    <div className="font-semibold text-slate-900">{supplier.company}</div>
                    <span className="text-[11px] text-slate-500">{supplier.name}</span>
                  </td>
                  <td className="px-4 py-3 font-mono text-slate-700">
                    {supplier.mobile}
                  </td>
                  <td className="px-4 py-3 text-slate-600 truncate max-w-[160px]">
                    {supplier.address || '—'}
                  </td>
                  <td className="px-4 py-3 text-right font-mono-num text-slate-700">
                    {formatCurrency(supplier.totalPurchase, lang)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono-num text-emerald-700 font-semibold">
                    {formatCurrency(supplier.totalPaid, lang)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono-num font-bold">
                    <span className={supplier.currentDue > 0 ? 'text-rose-700 text-sm' : 'text-slate-400'}>
                      {supplier.currentDue > 0 ? formatCurrency(supplier.currentDue, lang) : '0'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        onClick={() => setLedgerSupplier(supplier)}
                        className="flex items-center gap-1 px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded font-medium transition-colors"
                        title={'View Supplier Statement'}
                      >
                        <FileText className="w-3.5 h-3.5 text-slate-600" />
                        <span>{'Statement'}</span>
                      </button>
                      {canPaySupplierDue && supplier.currentDue > 0 && (
                        <button
                          onClick={() => handleOpenPay(supplier)}
                          className="flex items-center gap-1 px-2.5 py-1 bg-rose-50 hover:bg-rose-100 text-rose-800 border border-rose-200 rounded font-semibold transition-colors"
                          title={'Pay Due'}
                        >
                          <CreditCard className="w-3.5 h-3.5 text-rose-700" />
                          <span>{'Pay Due'}</span>
                        </button>
                      )}
                      {canEditSupplier && (
                        <button
                          onClick={() => handleOpenEdit(supplier)}
                          className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded font-medium transition-colors"
                        >
                          {'Edit'}
                        </button>
                      )}
                      {canDeleteSupplier && (
                        <button
                          onClick={() => {
                            setSupplierToDelete(supplier);
                            setDeleteSupplierError(null);
                          }}
                          className="p-1 text-rose-500 hover:text-rose-700 hover:bg-rose-50 rounded transition-colors"
                          title={'Delete Supplier (Authorized Only)'}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}

              {filteredSuppliers.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-400 text-xs">
                    {'No suppliers found.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pay Supplier Due Modal */}
      {payingSupplier && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <form
            onSubmit={handleSubmitPay}
            className="bg-white rounded-2xl shadow-xl border border-slate-200 w-full max-w-md p-5 space-y-4"
          >
            <div className="flex items-center justify-between border-b pb-2">
              <div>
                <h3 className="font-bold text-sm text-slate-900 flex items-center gap-1.5">
                  <CreditCard className="w-4 h-4 text-emerald-600" />
                  <span>{'Pay Supplier Due'}</span>
                </h3>
                <span className="text-[11px] text-slate-500">
                  {payingSupplier.company} (Due: ৳{payingSupplier.currentDue})
                </span>
              </div>
              <button
                type="button"
                onClick={() => setPayingSupplier(null)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-medium text-slate-700 mb-1">{'Payment Amount *'}</label>
                <input
                  type="number"
                  required
                  min="1"
                  max={payingSupplier.currentDue}
                  value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value === '' ? '' : Number(e.target.value))}
                  placeholder={payingSupplier.currentDue.toString()}
                  className="w-full p-2 border border-slate-200 rounded-lg font-mono-num font-bold text-base text-rose-700"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">{'Method'}</label>
                  <select
                    aria-label={'Method'}
                    value={payMethod}
                    onChange={(e) => setPayMethod(e.target.value as any)}
                    className="w-full p-2 border border-slate-200 rounded-lg bg-white capitalize"
                  >
                    <option value="cash">Cash</option>
                    <option value="bank">Bank</option>
                    <option value="bkash">bKash</option>
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">{'Deduct From'}</label>
                  <select
                    aria-label={'Deduct From Account'}
                    value={payAccountId}
                    onChange={(e) => setPayAccountId(e.target.value)}
                    className="w-full p-2 border border-slate-200 rounded-lg bg-white"
                  >
                    {accounts.map(a => (
                      <option key={a.id} value={a.id}>
                        {a.name} (Balance: ৳{a.balance})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">{'Note'}</label>
                <input
                  type="text"
                  value={payNote}
                  onChange={(e) => setPayNote(e.target.value)}
                  placeholder="Payment for previous dues"
                  className="w-full p-2 border border-slate-200 rounded-lg"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t">
              <button
                type="button"
                onClick={() => setPayingSupplier(null)}
                className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded-lg"
              >
                {'Cancel'}
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="px-4 py-1.5 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-60 rounded-lg shadow-xs"
              >
                {isSubmitting ? 'Processing...' : 'Confirm Payment'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Add / Edit Supplier Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <form
            onSubmit={handleSubmit}
            className="bg-white rounded-2xl shadow-xl border border-slate-200 w-full max-w-md p-5 space-y-4"
          >
            <div className="flex items-center justify-between border-b pb-2">
              <h3 className="font-bold text-sm text-slate-900 flex items-center gap-2">
                <Building className="w-4 h-4 text-emerald-600" />
                <span>{editingSupplier ? ('Edit Supplier') : ('Add Supplier')}</span>
              </h3>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-medium text-slate-700 mb-1">{'Company Name *'}</label>
                <input
                  type="text"
                  required
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                  placeholder="e.g. Beximco Textile Distributors"
                  className="w-full p-2 border border-slate-200 rounded-lg"
                />
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">{'Contact Person *'}</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Md. Rafiqul Islam"
                  className="w-full p-2 border border-slate-200 rounded-lg"
                />
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">{'Phone *'}</label>
                <input
                  type="text"
                  required
                  value={mobile}
                  onChange={(e) => setMobile(e.target.value)}
                  placeholder="01711-334455"
                  className="w-full p-2 border border-slate-200 rounded-lg font-mono"
                />
              </div>

              {!editingSupplier && (
                <div>
                  <label className="block font-medium text-slate-700 mb-1">{'Opening Due'}</label>
                  <input
                    type="number"
                    min="0"
                    value={openingDue}
                    onChange={(e) => setOpeningDue(e.target.value === '' ? '' : Number(e.target.value))}
                    placeholder="0"
                    className="w-full p-2 border border-slate-200 rounded-lg font-mono-num"
                  />
                </div>
              )}

              <div>
                <label className="block font-medium text-slate-700 mb-1">{'Address'}</label>
                <input
                  type="text"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="Shyampur, Dhaka"
                  className="w-full p-2 border border-slate-200 rounded-lg"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t">
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded-lg"
              >
                {'Cancel'}
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="px-4 py-1.5 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 rounded-lg"
              >
                {isSubmitting ? 'Saving...' : 'Save Supplier'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Delete Supplier Confirmation Modal */}
      {supplierToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl shadow-xl border border-rose-200 w-full max-w-md p-5 space-y-4">
            <div className="flex items-center justify-between border-b pb-2">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-rose-100 flex items-center justify-center text-rose-600">
                  <Trash2 className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-slate-900">
                    {'Delete Supplier?'}
                  </h3>
                  <span className="text-[11px] text-slate-500 font-mono">
                    {supplierToDelete.name} ({supplierToDelete.company})
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSupplierToDelete(null)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-2 text-xs text-slate-700">
              <p className="font-medium text-slate-800">
                {'Are you sure you want to permanently delete this supplier record?'}
              </p>

              {supplierToDelete.currentDue > 0 ? (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl space-y-1 text-rose-900 text-xs">
                  <div className="flex items-center gap-1.5 font-bold text-rose-800">
                    <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                    <span>{'Warning: Outstanding Due Balance!'}</span>
                  </div>
                  <p>
                    {`This supplier has an outstanding due balance of ৳${supplierToDelete.currentDue}. Please settle the due balance before deletion.`}
                  </p>
                </div>
              ) : (
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-1 text-slate-700 text-xs">
                  <div className="flex justify-between">
                    <span>{'Total Purchases'}:</span>
                    <span className="font-mono-num font-bold">{formatCurrency(supplierToDelete.totalPurchase, lang)}</span>
                  </div>
                  <div className="flex justify-between text-emerald-700">
                    <span>{'Total Paid'}:</span>
                    <span className="font-mono-num font-bold">{formatCurrency(supplierToDelete.totalPaid, lang)}</span>
                  </div>
                  <p className="pt-1 text-[11px] text-slate-500">
                    {'This action will be recorded in the audit logs.'}
                  </p>
                </div>
              )}

              {deleteSupplierError && (
                <div className="p-2 bg-rose-50 text-rose-700 rounded-lg text-xs font-semibold">
                  {deleteSupplierError}
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t">
              <button
                type="button"
                onClick={() => setSupplierToDelete(null)}
                className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded-lg font-medium"
              >
                {'Cancel'}
              </button>
              <button
                type="button"
                disabled={supplierToDelete.currentDue > 0}
                onClick={async () => {
                  try {
                    const res = await deleteSupplier(supplierToDelete.id);
                    if (res.success) {
                      setSupplierToDelete(null);
                    } else {
                      setDeleteSupplierError(res.message || 'Error deleting supplier');
                    }
                  } catch (err: any) {
                    setDeleteSupplierError(err.message || 'Error deleting supplier from database');
                  }
                }}
                className={`px-4 py-1.5 text-xs font-bold text-white rounded-lg flex items-center gap-1.5 shadow-xs transition-colors ${
                  supplierToDelete.currentDue > 0
                    ? 'bg-slate-300 cursor-not-allowed'
                    : 'bg-rose-600 hover:bg-rose-700'
                }`}
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{'Delete Supplier'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Supplier Ledger / Statement Modal */}
      {ledgerSupplier && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 w-full max-w-xl p-5 space-y-4 my-6">
            {/* Business Identity Header */}
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl flex items-start justify-between gap-3 text-xs">
              <div className="flex items-start gap-2.5 min-w-0">
                {shopLogo && (
                  <img
                    src={shopLogo}
                    alt={biz.shopName}
                    className="h-9 max-w-[72px] object-contain shrink-0"
                  />
                )}
                <div className="min-w-0">
                  <div className="font-bold text-slate-900 text-sm">{biz.shopName}</div>
                  {biz.branchName && (
                    <div className="text-[11px] font-semibold text-emerald-700">Branch: {biz.branchName}</div>
                  )}
                  <div className="text-[11px] text-slate-600 truncate">
                    {[biz.address, biz.mobile ? `Tel: ${biz.mobile}` : '', biz.vatRegistrationNo ? `BIN: ${biz.vatRegistrationNo}` : '']
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                </div>
              </div>
              <button
                onClick={() => setLedgerSupplier(null)}
                className="text-slate-400 hover:text-slate-600 shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex items-center justify-between border-b pb-2">
              <div>
                <h3 className="font-bold text-base text-slate-900">{ledgerSupplier.company}</h3>
                <p className="text-xs text-slate-500">
                  {ledgerSupplier.name} · {ledgerSupplier.mobile}
                  {ledgerSupplier.address ? ` · ${ledgerSupplier.address}` : ''}
                </p>
              </div>
              <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
                Supplier Statement
              </span>
            </div>

            <div className="grid grid-cols-3 gap-2 p-3 bg-slate-50 rounded-xl border text-center text-xs">
              <div>
                <span className="text-slate-500 block">Total Purchases</span>
                <span className="font-bold text-slate-900 font-mono-num">{formatCurrency(ledgerSupplier.totalPurchase, lang)}</span>
              </div>
              <div>
                <span className="text-slate-500 block">Total Paid</span>
                <span className="font-bold text-emerald-700 font-mono-num">{formatCurrency(ledgerSupplier.totalPaid, lang)}</span>
              </div>
              <div>
                <span className="text-slate-500 block">Payable Due</span>
                <span className="font-bold text-rose-700 font-mono-num">{formatCurrency(ledgerSupplier.currentDue, lang)}</span>
              </div>
            </div>

            <div className="space-y-2">
              <span className="font-bold text-xs text-slate-800 block">Transaction History</span>
              <div className="max-h-60 overflow-y-auto border rounded-xl divide-y text-xs">
                {supplierTransactions.filter(t => t.supplierId === ledgerSupplier.id).map(t => {
                  const isCredit = t.type === 'due_payment' || t.type === 'return_adjustment';
                  const typeLabel =
                    t.type === 'due_payment'
                      ? 'Due Payment'
                      : t.type === 'return_adjustment'
                      ? 'Return Adjustment'
                      : t.type === 'opening'
                      ? 'Opening Due'
                      : 'Purchase Due';
                  return (
                    <div key={t.id} className="p-2.5 flex items-center justify-between">
                      <div>
                        <span className="font-medium text-slate-800 block">
                          {typeLabel}
                          {t.referenceId && ` (${t.referenceId})`}
                        </span>
                        <span className="text-[10px] text-slate-500">{formatDate(t.date, lang)} · {t.note}</span>
                      </div>
                      <div className="text-right">
                        <span className={`font-bold font-mono-num ${isCredit ? 'text-emerald-700' : 'text-rose-700'}`}>
                          {isCredit ? `-${formatCurrency(t.amount, lang)}` : `+${formatCurrency(t.amount, lang)}`}
                        </span>
                        <span className="text-[10px] text-slate-500 block">Balance: ৳{t.balanceAfter}</span>
                      </div>
                    </div>
                  );
                })}
                {supplierTransactions.filter(t => t.supplierId === ledgerSupplier.id).length === 0 && (
                  <div className="py-8 text-center text-slate-400 text-xs">
                    No previous transaction records found.
                  </div>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t">
              <button
                type="button"
                onClick={() =>
                  printSupplierStatement(
                    ledgerSupplier,
                    supplierTransactions.filter(t => t.supplierId === ledgerSupplier.id),
                    settings,
                    activeBranch
                  )
                }
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg cursor-pointer"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>Print Statement</span>
              </button>
              <button
                type="button"
                onClick={() => setLedgerSupplier(null)}
                className="px-4 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
