import React, { useMemo, useRef, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { resolveBusinessProfile } from '../../config/appIdentity';
import { Customer, InstallmentAgreement, InstallmentPaymentRecord, PaymentMethod } from '../../types';
import { formatCurrency, formatDate, toBnNumber } from '../../utils/formatters';
import { getShopLogo, printCustomerStatement } from '../../utils/printEngine';
import {
  compressKycImageFile,
  generateInstallmentReceiptNumber,
  getTodayIsoDate,
  roundMoney,
} from '../../utils/installmentUtils';
import { printInstallmentPaymentReceipt } from '../../utils/installmentSlipExport';
import { InstallmentSlipPreviewModal } from '../installments/InstallmentSlipPreviewModal';
import {
  Users,
  Plus,
  Search,
  MessageSquare,
  FileText,
  X,
  CreditCard,
  History,
  Edit,
  Trash2,
  AlertTriangle,
  Printer,
  CalendarClock,
  ImagePlus,
  ShieldCheck,
  RotateCcw,
  CheckCircle2,
} from 'lucide-react';

interface CustomersViewProps {
  isAddModalOpen?: boolean;
  onCloseAddModal?: () => void;
}

export const CustomersView: React.FC<CustomersViewProps> = ({ isAddModalOpen: propIsAddModalOpen, onCloseAddModal: propOnCloseAddModal }) => {
  const {
    customers,
    customerTransactions,
    addCustomer,
    updateCustomer,
    deleteCustomer,
    isAdmin,
    collectCustomerDue,
    accounts,
    settings,
    branches,
    activeBranchId,
    hasPermission,
    installmentAgreements,
    installmentPayments,
    collectInstallmentPayment,
    reverseInstallmentPayment,
    user,
    currentEmployee,
    currentUserRole,
  } = useApp();
  const canEditCustomer = isAdmin || hasPermission('customer_management', 'edit');
  const canDeleteCustomer = isAdmin || hasPermission('customer_management', 'delete');
  const canCollectInstallment = isAdmin || hasPermission('due_collection', 'create') || hasPermission('due_collection', 'edit');
  const canReverseInstallment = isAdmin || hasPermission('due_collection', 'delete') || hasPermission('sales_history', 'edit');
  const lang = settings.language;
  const activeBranch = branches.find(b => b.id === activeBranchId) || branches[0];
  const biz = resolveBusinessProfile(settings, activeBranch);
  const shopLogo = getShopLogo(settings);

  const staffNameDefault =
    currentEmployee?.name ||
    user?.user_metadata?.full_name ||
    user?.email?.split('@')[0] ||
    (currentUserRole === 'seller' || currentUserRole === 'salesman' ? 'Seller' : 'Admin');

  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'due'>('all');

  // Add / Edit Modal
  const [isModalOpen, setIsModalOpen] = useState(propIsAddModalOpen || false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);

  // Delete Customer State
  const [customerToDelete, setCustomerToDelete] = useState<Customer | null>(null);
  const [deleteCustomerError, setDeleteCustomerError] = useState<string | null>(null);

  // Due Collection Modal
  const [collectingCustomer, setCollectingCustomer] = useState<Customer | null>(null);
  const [collectAmount, setCollectAmount] = useState<number | ''>('');
  const [collectMethod, setCollectMethod] = useState<PaymentMethod>('cash');
  const [collectAccountId, setCollectAccountId] = useState(accounts[0]?.id || '');
  const [collectNote, setCollectNote] = useState('');

  // Customer Ledger Modal
  const [ledgerCustomer, setLedgerCustomer] = useState<Customer | null>(null);

  // Customer Installment Profile Modal & Slip Preview
  const [installmentProfileCustomerId, setInstallmentProfileCustomerId] = useState<string | null>(null);
  const [slipAgreement, setSlipAgreement] = useState<InstallmentAgreement | null>(null);
  const [collectingAgreement, setCollectingAgreement] = useState<InstallmentAgreement | null>(null);
  const [instPayDate, setInstPayDate] = useState(getTodayIsoDate());
  const [instPayAmount, setInstPayAmount] = useState<number | ''>('');
  const [instPayMethod, setInstPayMethod] = useState<PaymentMethod>('cash');
  const [instPayAccountId, setInstPayAccountId] = useState(accounts[0]?.id || '');
  const [instPayReceiptNo, setInstPayReceiptNo] = useState('');
  const [instPayRemarks, setInstPayRemarks] = useState('');
  const [instPayClientTxId, setInstPayClientTxId] = useState('');
  const [isSubmittingInstPay, setIsSubmittingInstPay] = useState(false);
  const [instPayError, setInstPayError] = useState<string | null>(null);
  const [completedInstPayment, setCompletedInstPayment] = useState<{
    payment: InstallmentPaymentRecord;
    agreement: InstallmentAgreement;
  } | null>(null);
  const instPayLockRef = useRef(false);
  const [reversingInstPaymentId, setReversingInstPaymentId] = useState<string | null>(null);
  const [reversalReasonInput, setReversalReasonInput] = useState('');
  const [isReversingInst, setIsReversingInst] = useState(false);

  // Form Fields
  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');
  const [address, setAddress] = useState('');
  const [email, setEmail] = useState('');
  const [customerType, setCustomerType] = useState<'retail' | 'wholesale'>('retail');
  const [openingDue, setOpeningDue] = useState<number | ''>('');
  const [creditLimit, setCreditLimit] = useState<number>(10000);

  // Optional Private KYC Fields
  const [photoUrl, setPhotoUrl] = useState('');
  const [nidNumber, setNidNumber] = useState('');
  const [nidFrontUrl, setNidFrontUrl] = useState('');
  const [nidBackUrl, setNidBackUrl] = useState('');
  const [kycConsent, setKycConsent] = useState(false);

  const [isSubmitting, setIsSubmitting] = useState(false);

  React.useEffect(() => {
    if (propIsAddModalOpen === true) {
      handleOpenAdd();
    } else if (propIsAddModalOpen === false) {
      setIsModalOpen(false);
    }
  }, [propIsAddModalOpen]);

  React.useEffect(() => {
    if (accounts.length > 0 && (!collectAccountId || !accounts.some(a => a.id === collectAccountId))) {
      setCollectAccountId(accounts[0].id);
    }
    if (accounts.length > 0 && (!instPayAccountId || !accounts.some(a => a.id === instPayAccountId))) {
      setInstPayAccountId(accounts[0].id);
    }
  }, [accounts, collectAccountId, instPayAccountId]);

  const installmentSummaryByCustomer = useMemo(() => {
    const map: Record<string, { total: number; active: number; overdue: number }> = {};
    installmentAgreements.forEach(ag => {
      if (!map[ag.customerId]) {
        map[ag.customerId] = { total: 0, active: 0, overdue: 0 };
      }
      map[ag.customerId].total += 1;
      if (ag.status !== 'paid') {
        map[ag.customerId].active += 1;
        if (ag.overdueAmount > 0) map[ag.customerId].overdue += 1;
      }
    });
    return map;
  }, [installmentAgreements]);

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingCustomer(null);
    if (propOnCloseAddModal) propOnCloseAddModal();
  };

  const handleOpenAdd = () => {
    setEditingCustomer(null);
    setName('');
    setMobile('');
    setAddress('');
    setEmail('');
    setCustomerType('retail');
    setOpeningDue('');
    setCreditLimit(10000);
    setPhotoUrl('');
    setNidNumber('');
    setNidFrontUrl('');
    setNidBackUrl('');
    setKycConsent(false);
    setIsModalOpen(true);
  };

  const handleOpenEdit = (c: Customer) => {
    setEditingCustomer(c);
    setName(c.name);
    setMobile(c.mobile);
    setAddress(c.address || '');
    setEmail(c.email || '');
    setCustomerType(c.customerType);
    setOpeningDue('');
    setCreditLimit(c.creditLimit);
    setPhotoUrl(c.photoUrl || '');
    setNidNumber(c.nidNumber || '');
    setNidFrontUrl(c.nidFrontUrl || '');
    setNidBackUrl(c.nidBackUrl || '');
    setKycConsent(Boolean(c.kycConsent));
    setIsModalOpen(true);
  };

  const handlePickKycFile = async (
    file: File | undefined,
    setter: React.Dispatch<React.SetStateAction<string>>
  ) => {
    if (!file) return;
    try {
      const compressed = await compressKycImageFile(file);
      setter(compressed);
    } catch (err: any) {
      alert(err?.message || 'Could not process image file.');
    }
  };

  const handleSubmitCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    if (!name.trim() || !mobile.trim()) {
      alert('Customer name and mobile number are required.');
      return;
    }

    const parsedOpeningDue = openingDue === '' ? 0 : Number(openingDue);
    const parsedCreditLimit = Number.isNaN(Number(creditLimit)) ? 10000 : Number(creditLimit);

    if (parsedOpeningDue < 0 || parsedCreditLimit < 0) {
      alert('Opening due and credit limit cannot be negative.');
      return;
    }

    setIsSubmitting(true);
    try {
      if (editingCustomer) {
        await updateCustomer(editingCustomer.id, {
          name: name.trim(),
          mobile: mobile.trim(),
          address: address.trim() || undefined,
          email: email.trim() || undefined,
          customerType,
          creditLimit: parsedCreditLimit,
          photoUrl: photoUrl || undefined,
          nidNumber: nidNumber.trim() || undefined,
          nidFrontUrl: nidFrontUrl || undefined,
          nidBackUrl: nidBackUrl || undefined,
          kycConsent,
          kycConsentAt: kycConsent ? editingCustomer.kycConsentAt || new Date().toISOString() : undefined,
        });
      } else {
        await addCustomer({
          name: name.trim(),
          mobile: mobile.trim(),
          address: address.trim() || undefined,
          email: email.trim() || undefined,
          customerType,
          openingDue: parsedOpeningDue,
          creditLimit: parsedCreditLimit,
          photoUrl: photoUrl || undefined,
          nidNumber: nidNumber.trim() || undefined,
          nidFrontUrl: nidFrontUrl || undefined,
          nidBackUrl: nidBackUrl || undefined,
          kycConsent,
          kycConsentAt: kycConsent ? new Date().toISOString() : undefined,
        });
      }

      closeModal();
    } catch (err: any) {
      alert(`Customer save failed: ${err.message || 'Database error'}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOpenCollectDue = (c: Customer) => {
    setCollectingCustomer(c);
    setCollectAmount(c.currentDue);
    setCollectMethod('cash');
    setCollectAccountId(accounts[0]?.id || '');
    setCollectNote('Due payment collection');
  };

  const handleSubmitCollect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting || !collectingCustomer) return;

    const amount = Number(collectAmount);
    if (!amount || amount <= 0) {
      alert('Please enter a valid collection amount greater than 0.');
      return;
    }
    if (amount > collectingCustomer.currentDue) {
      alert(`Collection amount cannot exceed customer due balance (৳${collectingCustomer.currentDue}).`);
      return;
    }

    const targetAccountId = collectAccountId || accounts[0]?.id;
    if (!targetAccountId) {
      alert('Please select a valid deposit account.');
      return;
    }

    setIsSubmitting(true);
    try {
      await collectCustomerDue(
        collectingCustomer.id,
        amount,
        collectMethod,
        targetAccountId,
        collectNote
      );

      setCollectingCustomer(null);
    } catch (err: any) {
      alert(`Customer due collection failed: ${err.message || 'Database error'}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const sendWhatsAppReminder = (c: Customer) => {
    const shopLabel = biz.shopName || settings.shopName;
    const contactPhone = biz.mobile || settings.mobile;
    const text = `Dear ${c.name},%0A%0AYour outstanding balance at ${encodeURIComponent(shopLabel)} is ৳${c.currentDue}. Please arrange payment at your earliest convenience.%0A%0AFor any queries, please call: ${contactPhone}. Thank you!`;
    const cleanPhone = c.mobile.replace(/[^0-9]/g, '');
    window.open(`https://api.whatsapp.com/send?phone=${cleanPhone}&text=${text}`, '_blank');
  };

  const totalDueAmount = customers.reduce((sum, c) => sum + c.currentDue, 0);
  const dueCustomersCount = customers.filter(c => c.currentDue > 0).length;

  const filteredCustomers = customers.filter(c => {
    const matchSearch =
      c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.mobile.includes(searchQuery) ||
      (c.address && c.address.toLowerCase().includes(searchQuery.toLowerCase()));

    const matchFilter = filterType === 'all' || (filterType === 'due' && c.currentDue > 0);
    return matchSearch && matchFilter;
  });

  return (
    <div className="space-y-4">
      {/* Top Banner & Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs">
          <span className="text-xs text-slate-500 block">{'Total Customers'}</span>
          <span className="text-xl md:text-2xl font-bold font-mono-num text-slate-900 mt-1 block">
            {toBnNumber(customers.length)}
          </span>
          <span className="text-[11px] text-slate-500 mt-0.5 block">
            {toBnNumber(dueCustomersCount)} {'have pending due'}
          </span>
        </div>

        <div className="bg-white rounded-xl border border-amber-200 bg-amber-50/40 p-4 shadow-xs">
          <span className="text-xs text-amber-800 font-semibold block">
            {'Total Due Outstanding'}
          </span>
          <span className="text-xl md:text-2xl font-bold font-mono-num text-amber-900 mt-1 block">
            {formatCurrency(totalDueAmount, lang)}
          </span>
          <span className="text-[11px] text-amber-700 mt-0.5 block">
            {'Receivable credit balance'}
          </span>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs flex items-center justify-between">
          <div>
            <span className="text-xs text-slate-500 block">{'Quick Actions'}</span>
            <span className="text-xs text-slate-700 mt-1 block font-medium">
              {'Register retail/wholesale'}
            </span>
          </div>
          <button
            onClick={handleOpenAdd}
            className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-[#06B6D4] hover:brightness-110 rounded-[10px] shadow-xs transition-all cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>{'Add'}</span>
          </button>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="bg-white rounded-xl border border-slate-200 p-3 shadow-xs flex flex-col sm:flex-row items-center gap-2 text-xs">
        <div className="relative flex-1 w-full">
          <Search className="w-4 h-4 absolute left-3 top-2 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={'Search by name, phone, address...'}
            className="w-full pl-9 pr-3 py-1.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500 bg-slate-50/50"
          />
        </div>

        <div className="flex items-center gap-1 w-full sm:w-auto">
          <button
            onClick={() => setFilterType('all')}
            className={`flex-1 sm:flex-none px-3 py-1.5 rounded-lg border font-medium ${
              filterType === 'all' ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-700 border-slate-200'
            }`}
          >
            {'All Customers'}
          </button>
          <button
            onClick={() => setFilterType('due')}
            className={`flex-1 sm:flex-none px-3 py-1.5 rounded-lg border font-semibold flex items-center justify-center gap-1 ${
              filterType === 'due' ? 'bg-amber-600 text-white border-amber-600' : 'bg-white text-amber-700 border-amber-200'
            }`}
          >
            <span>{'Due Customers'}</span>
            <span>({toBnNumber(dueCustomersCount)})</span>
          </button>
        </div>
      </div>

      {/* Customers List Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
              <tr>
                <th className="px-4 py-3 font-semibold">{'Customer Name'}</th>
                <th className="px-4 py-3 font-semibold">{'Phone'}</th>
                <th className="px-4 py-3 font-semibold">{'Address'}</th>
                <th className="px-4 py-3 font-semibold text-right">{'Purchases'}</th>
                <th className="px-4 py-3 font-semibold text-right">{'Paid'}</th>
                <th className="px-4 py-3 font-semibold text-right">{'Due'}</th>
                <th className="px-4 py-3 font-semibold text-right">{'Actions'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredCustomers.map(customer => {
                const instInfo = installmentSummaryByCustomer[customer.id];
                return (
                <tr key={customer.id} className="hover:bg-slate-50/80 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      {customer.photoUrl && (
                        <img
                          src={customer.photoUrl}
                          alt={customer.name}
                          className="w-8 h-8 rounded-lg object-cover border border-slate-200 shrink-0"
                        />
                      )}
                      <div>
                        <div className="font-semibold text-slate-900">{customer.name}</div>
                        <span className="text-[10px] text-slate-500 capitalize">{customer.customerType}</span>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 font-mono text-slate-700">
                    {customer.mobile}
                  </td>
                  <td className="px-4 py-3 text-slate-600 truncate max-w-[160px]">
                    {customer.address || '—'}
                  </td>
                  <td className="px-4 py-3 text-right font-mono-num text-slate-700">
                    {formatCurrency(customer.totalPurchase, lang)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono-num text-emerald-700 font-semibold">
                    {formatCurrency(customer.totalPaid, lang)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono-num font-bold">
                    <span className={customer.currentDue > 0 ? 'text-amber-800 text-sm' : 'text-slate-400'}>
                      {customer.currentDue > 0 ? formatCurrency(customer.currentDue, lang) : '0'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={() => setInstallmentProfileCustomerId(customer.id)}
                        className={`flex items-center gap-1 px-2 py-1 rounded border text-[11px] font-semibold transition-colors cursor-pointer ${
                          instInfo?.overdue
                            ? 'bg-rose-50 text-rose-800 border-rose-200 hover:bg-rose-100'
                            : instInfo?.total
                            ? 'bg-blue-50 text-[#0B2A6B] border-blue-200 hover:bg-blue-100'
                            : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                        }`}
                        title="Customer Installment Profile"
                      >
                        <CalendarClock className="w-3.5 h-3.5" />
                        <span>Installments{instInfo?.total ? ` (${instInfo.total})` : ''}</span>
                      </button>
                      {customer.currentDue > 0 && (
                        <>
                          <button
                            onClick={() => handleOpenCollectDue(customer)}
                            className="flex items-center gap-1 px-2.5 py-1 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 rounded font-semibold transition-colors"
                            title={'Collect Due'}
                          >
                            <CreditCard className="w-3.5 h-3.5 text-amber-700" />
                            <span>{'Collect'}</span>
                          </button>
                          <button
                            onClick={() => sendWhatsAppReminder(customer)}
                            className="p-1 text-emerald-600 hover:text-emerald-800 hover:bg-emerald-50 rounded transition-colors"
                            title={'WhatsApp Due Reminder'}
                          >
                            <MessageSquare className="w-4 h-4" />
                          </button>
                        </>
                      )}
                      <button
                        onClick={() => setLedgerCustomer(customer)}
                        className="p-1 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded transition-colors"
                        title={'View Ledger'}
                      >
                        <FileText className="w-4 h-4" />
                      </button>
                      {canEditCustomer && (
                        <button
                          onClick={() => handleOpenEdit(customer)}
                          className="p-1 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded transition-colors"
                          title={'Edit Customer'}
                        >
                          <Edit className="w-4 h-4" />
                        </button>
                      )}
                      {canDeleteCustomer && (
                        <button
                          onClick={() => {
                            setCustomerToDelete(customer);
                            setDeleteCustomerError(null);
                          }}
                          className="p-1 text-rose-500 hover:text-rose-700 hover:bg-rose-50 rounded transition-colors"
                          title={'Delete Customer (Authorized Only)'}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
                );
              })}

              {filteredCustomers.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-400 text-xs">
                    {'No customers found.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Due Collection Modal */}
      {collectingCustomer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <form
            onSubmit={handleSubmitCollect}
            className="bg-white rounded-2xl shadow-xl border border-slate-200 w-full max-w-md p-5 space-y-4"
          >
            <div className="flex items-center justify-between border-b pb-2">
              <div>
                <h3 className="font-bold text-sm text-slate-900 flex items-center gap-1.5">
                  <CreditCard className="w-4 h-4 text-emerald-600" />
                  <span>{'Collect Due Payment'}</span>
                </h3>
                <span className="text-[11px] text-slate-500">
                  {collectingCustomer.name} (Due: ৳{collectingCustomer.currentDue})
                </span>
              </div>
              <button
                type="button"
                onClick={() => setCollectingCustomer(null)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-medium text-slate-700 mb-1">{'Amount *'}</label>
                <input
                  type="number"
                  required
                  min="1"
                  max={collectingCustomer.currentDue}
                  value={collectAmount}
                  onChange={(e) => setCollectAmount(e.target.value === '' ? '' : Number(e.target.value))}
                  placeholder={collectingCustomer.currentDue.toString()}
                  className="w-full p-2 border border-slate-200 rounded-lg font-mono-num font-bold text-base text-emerald-700"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">{'Method'}</label>
                  <select
                    aria-label={'Method'}
                    value={collectMethod}
                    onChange={(e) => setCollectMethod(e.target.value as any)}
                    className="w-full p-2 border border-slate-200 rounded-lg bg-white capitalize"
                  >
                    <option value="cash">Cash</option>
                    <option value="bkash">bKash</option>
                    <option value="nagad">Nagad</option>
                    <option value="bank">Bank</option>
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">{'Deposit To Account'}</label>
                  <select
                    aria-label={'Deposit To Account'}
                    value={collectAccountId}
                    onChange={(e) => setCollectAccountId(e.target.value)}
                    className="w-full p-2 border border-slate-200 rounded-lg bg-white"
                  >
                    {accounts.map(a => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">{'Note'}</label>
                <input
                  type="text"
                  value={collectNote}
                  onChange={(e) => setCollectNote(e.target.value)}
                  placeholder="Due payment received and deposited"
                  className="w-full p-2 border border-slate-200 rounded-lg"
                />
              </div>

              <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded-lg text-emerald-800 text-[11px]">
                {`Remaining due balance will be: ৳${Math.max(0, collectingCustomer.currentDue - (Number(collectAmount) || 0))}`}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t">
              <button
                type="button"
                onClick={() => setCollectingCustomer(null)}
                className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded-lg"
              >
                {'Cancel'}
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="px-4 py-1.5 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 rounded-lg shadow-xs"
              >
                {isSubmitting ? 'Collecting...' : 'Confirm Collection'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Customer Ledger Modal */}
      {ledgerCustomer && (
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
                onClick={() => setLedgerCustomer(null)}
                className="text-slate-400 hover:text-slate-600 shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex items-center justify-between border-b pb-2">
              <div>
                <h3 className="font-bold text-base text-slate-900">{ledgerCustomer.name}</h3>
                <p className="text-xs text-slate-500">{ledgerCustomer.mobile} · {ledgerCustomer.address}</p>
              </div>
              <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
                Customer Statement
              </span>
            </div>

            {/* Quick Balance */}
            <div className="grid grid-cols-3 gap-2 p-3 bg-slate-50 rounded-xl border text-center text-xs">
              <div>
                <span className="text-slate-500 block">Total Purchases</span>
                <span className="font-bold text-slate-900 font-mono-num">{formatCurrency(ledgerCustomer.totalPurchase, lang)}</span>
              </div>
              <div>
                <span className="text-slate-500 block">Total Paid</span>
                <span className="font-bold text-emerald-700 font-mono-num">{formatCurrency(ledgerCustomer.totalPaid, lang)}</span>
              </div>
              <div>
                <span className="text-slate-500 block">Current Due</span>
                <span className="font-bold text-amber-800 font-mono-num">{formatCurrency(ledgerCustomer.currentDue, lang)}</span>
              </div>
            </div>

            {/* Transactions History Table */}
            <div className="space-y-2">
              <span className="font-bold text-xs text-slate-800 block">Transaction History</span>
              <div className="max-h-60 overflow-y-auto border rounded-xl divide-y text-xs">
                {customerTransactions.filter(t => t.customerId === ledgerCustomer.id).map(t => {
                  const isCredit = t.type === 'due_collection' || t.type === 'return_adjustment';
                  const typeLabel =
                    t.type === 'due_collection'
                      ? 'Due Payment'
                      : t.type === 'return_adjustment'
                      ? 'Return Adjustment'
                      : t.type === 'opening'
                      ? 'Opening Due'
                      : 'Due Sale';
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
                {customerTransactions.filter(t => t.customerId === ledgerCustomer.id).length === 0 && (
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
                  printCustomerStatement(
                    ledgerCustomer,
                    customerTransactions.filter(t => t.customerId === ledgerCustomer.id),
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
                onClick={() => setLedgerCustomer(null)}
                className="px-4 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add / Edit Customer Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto">
          <form
            onSubmit={handleSubmitCustomer}
            className="bg-white rounded-2xl shadow-xl border border-slate-200 w-full max-w-lg p-5 space-y-4 my-auto max-h-[92vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between border-b pb-2">
              <h3 className="font-bold text-sm text-slate-900 flex items-center gap-2">
                <Users className="w-4 h-4 text-emerald-600" />
                <span>{editingCustomer ? ('Edit Customer') : ('Add Customer')}</span>
              </h3>
              <button
                type="button"
                onClick={closeModal}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-medium text-slate-700 mb-1">{'Full Name *'}</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Tanvir Ahmed"
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
                  placeholder="01715-112233"
                  className="w-full p-2 border border-slate-200 rounded-lg font-mono"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">{'Type'}</label>
                  <select
                    aria-label={'Type'}
                    value={customerType}
                    onChange={(e) => setCustomerType(e.target.value as any)}
                    className="w-full p-2 border border-slate-200 rounded-lg bg-white"
                  >
                    <option value="retail">Retail</option>
                    <option value="wholesale">Wholesale</option>
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">{'Credit Limit'}</label>
                  <input
                    type="number"
                    value={creditLimit}
                    onChange={(e) => setCreditLimit(Number(e.target.value) || 10000)}
                    className="w-full p-2 border border-slate-200 rounded-lg font-mono-num"
                  />
                </div>
              </div>

              {!editingCustomer && (
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
                  placeholder="House, Road, Area"
                  className="w-full p-2 border border-slate-200 rounded-lg"
                />
              </div>

              {/* Optional Private Photo & NID Verification */}
              <div className="p-3 rounded-xl border border-slate-200 bg-slate-50/70 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-800 flex items-center gap-1.5">
                    <ShieldCheck className="w-3.5 h-3.5 text-[#0B2A6B]" />
                    <span>Photo &amp; NID Verification (Optional &amp; Private)</span>
                  </span>
                </div>

                <div>
                  <label className="block font-medium text-slate-700 mb-1">NID Number (Optional)</label>
                  <input
                    type="text"
                    value={nidNumber}
                    onChange={(e) => setNidNumber(e.target.value)}
                    placeholder="National ID number (masked on printed Customer Slip)"
                    className="w-full p-2 border border-slate-200 rounded-lg bg-white font-mono"
                  />
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <div className="space-y-1">
                    <label className="flex flex-col items-center justify-center p-2 border border-dashed border-slate-300 rounded-lg bg-white hover:bg-slate-50 cursor-pointer text-center min-h-[68px]">
                      {photoUrl ? (
                        <img src={photoUrl} alt="Customer" className="w-12 h-12 rounded object-cover" />
                      ) : (
                        <>
                          <ImagePlus className="w-4 h-4 text-[#0B2A6B] mb-1" />
                          <span className="text-[10px] font-medium text-slate-600">Customer Photo</span>
                        </>
                      )}
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => handlePickKycFile(e.target.files?.[0], setPhotoUrl)}
                      />
                    </label>
                    {photoUrl && (
                      <button type="button" onClick={() => setPhotoUrl('')} className="w-full text-[10px] text-rose-600 hover:underline">
                        Remove
                      </button>
                    )}
                  </div>

                  <div className="space-y-1">
                    <label className="flex flex-col items-center justify-center p-2 border border-dashed border-slate-300 rounded-lg bg-white hover:bg-slate-50 cursor-pointer text-center min-h-[68px]">
                      {nidFrontUrl ? (
                        <img src={nidFrontUrl} alt="NID Front" className="w-full h-12 rounded object-cover" />
                      ) : (
                        <>
                          <ImagePlus className="w-4 h-4 text-[#0B2A6B] mb-1" />
                          <span className="text-[10px] font-medium text-slate-600">NID Front</span>
                        </>
                      )}
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => handlePickKycFile(e.target.files?.[0], setNidFrontUrl)}
                      />
                    </label>
                    {nidFrontUrl && (
                      <button type="button" onClick={() => setNidFrontUrl('')} className="w-full text-[10px] text-rose-600 hover:underline">
                        Remove
                      </button>
                    )}
                  </div>

                  <div className="space-y-1">
                    <label className="flex flex-col items-center justify-center p-2 border border-dashed border-slate-300 rounded-lg bg-white hover:bg-slate-50 cursor-pointer text-center min-h-[68px]">
                      {nidBackUrl ? (
                        <img src={nidBackUrl} alt="NID Back" className="w-full h-12 rounded object-cover" />
                      ) : (
                        <>
                          <ImagePlus className="w-4 h-4 text-[#0B2A6B] mb-1" />
                          <span className="text-[10px] font-medium text-slate-600">NID Back</span>
                        </>
                      )}
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => handlePickKycFile(e.target.files?.[0], setNidBackUrl)}
                      />
                    </label>
                    {nidBackUrl && (
                      <button type="button" onClick={() => setNidBackUrl('')} className="w-full text-[10px] text-rose-600 hover:underline">
                        Remove
                      </button>
                    )}
                  </div>
                </div>

                <label className="flex items-center gap-1.5 text-[11px] text-slate-600 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={kycConsent}
                    onChange={(e) => setKycConsent(e.target.checked)}
                  />
                  <span>Customer consented to private identity verification storage</span>
                </label>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t">
              <button
                type="button"
                onClick={closeModal}
                className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded-lg"
              >
                {'Cancel'}
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="px-4 py-1.5 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 rounded-lg"
              >
                {isSubmitting ? 'Saving...' : 'Save Customer'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Delete Customer Confirmation Modal */}
      {customerToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl shadow-xl border border-rose-200 w-full max-w-md p-5 space-y-4">
            <div className="flex items-center justify-between border-b pb-2">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-rose-100 flex items-center justify-center text-rose-600">
                  <Trash2 className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-slate-900">
                    {'Delete Customer?'}
                  </h3>
                  <span className="text-[11px] text-slate-500 font-mono">
                    {customerToDelete.name} ({customerToDelete.mobile})
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setCustomerToDelete(null)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-2 text-xs text-slate-700">
              <p className="font-medium text-slate-800">
                {'Are you sure you want to permanently delete this customer record?'}
              </p>

              {customerToDelete.currentDue > 0 ? (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl space-y-1 text-amber-900 text-xs">
                  <div className="flex items-center gap-1.5 font-bold text-amber-800">
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                    <span>{'Warning: Outstanding Due Balance!'}</span>
                  </div>
                  <p>
                    {`This customer has an outstanding due balance of ৳${customerToDelete.currentDue}. Please clear or adjust the due balance before deletion.`}
                  </p>
                </div>
              ) : (
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-1 text-slate-700 text-xs">
                  <div className="flex justify-between">
                    <span>{'Total Purchases'}:</span>
                    <span className="font-mono-num font-bold">{formatCurrency(customerToDelete.totalPurchase, lang)}</span>
                  </div>
                  <div className="flex justify-between text-emerald-700">
                    <span>{'Current Due'}:</span>
                    <span className="font-mono-num font-bold">0 (Paid)</span>
                  </div>
                  <p className="pt-1 text-[11px] text-slate-500">
                    {'This action will be recorded in the audit logs.'}
                  </p>
                </div>
              )}

              {deleteCustomerError && (
                <div className="p-2 bg-rose-50 text-rose-700 rounded-lg text-xs font-semibold">
                  {deleteCustomerError}
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t">
              <button
                type="button"
                onClick={() => setCustomerToDelete(null)}
                className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded-lg font-medium"
              >
                {'Cancel'}
              </button>
              <button
                type="button"
                disabled={customerToDelete.currentDue > 0}
                onClick={async () => {
                  try {
                    const res = await deleteCustomer(customerToDelete.id);
                    if (res.success) {
                      setCustomerToDelete(null);
                    } else {
                      setDeleteCustomerError(res.message || 'Error deleting customer');
                    }
                  } catch (err: any) {
                    setDeleteCustomerError(err.message || 'Error deleting customer from database');
                  }
                }}
                className={`px-4 py-1.5 text-xs font-bold text-white rounded-lg flex items-center gap-1.5 shadow-xs transition-colors ${
                  customerToDelete.currentDue > 0
                    ? 'bg-slate-300 cursor-not-allowed'
                    : 'bg-rose-600 hover:bg-rose-700'
                }`}
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{'Delete Customer'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Customer Installment Profile Modal (Supports Multiple Separate Installment Agreements) */}
      {installmentProfileCustomerId && (() => {
        const profileCustomer = customers.find(c => c.id === installmentProfileCustomerId);
        if (!profileCustomer) return null;
        const custAgreements = installmentAgreements.filter(a => a.customerId === profileCustomer.id);
        const totalFinanced = roundMoney(custAgreements.reduce((s, a) => s + a.installmentBalance, 0));
        const totalRemaining = roundMoney(custAgreements.reduce((s, a) => s + a.remainingDue, 0));
        const totalOverdue = roundMoney(custAgreements.reduce((s, a) => s + a.overdueAmount, 0));

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-slate-900/65 backdrop-blur-xs overflow-y-auto">
            <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden my-auto">
              <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50 flex items-center justify-between gap-3 shrink-0">
                <div className="flex items-center gap-3 min-w-0">
                  {profileCustomer.photoUrl ? (
                    <img
                      src={profileCustomer.photoUrl}
                      alt={profileCustomer.name}
                      className="w-11 h-11 rounded-xl object-cover border border-slate-200 shrink-0"
                    />
                  ) : (
                    <div className="w-11 h-11 rounded-xl bg-[#0B2A6B] text-white font-bold flex items-center justify-center shrink-0">
                      {profileCustomer.name.slice(0, 1).toUpperCase()}
                    </div>
                  )}
                  <div className="min-w-0">
                    <h3 className="font-bold text-sm sm:text-base text-slate-900 truncate">
                      {profileCustomer.name} — Installment Profile
                    </h3>
                    <p className="text-[11px] text-slate-500 truncate">
                      {profileCustomer.mobile} · {profileCustomer.address || 'No address'}
                      {profileCustomer.nidNumber && ` · Private NID: ${profileCustomer.nidNumber}`}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setInstallmentProfileCustomerId(null)}
                  className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-5 space-y-4 text-xs">
                {/* Summary Strip + Private KYC Cards */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                    <span className="text-[10px] text-slate-500 block">Total Agreements</span>
                    <span className="text-lg font-bold font-mono-num text-slate-900">{custAgreements.length}</span>
                  </div>
                  <div className="p-3 rounded-xl bg-blue-50 border border-blue-200">
                    <span className="text-[10px] text-blue-700 block">Total Installment Principal</span>
                    <span className="text-lg font-bold font-mono-num text-blue-950">{formatCurrency(totalFinanced, lang)}</span>
                  </div>
                  <div className="p-3 rounded-xl bg-amber-50 border border-amber-200">
                    <span className="text-[10px] text-amber-800 block">Remaining Installment Due</span>
                    <span className="text-lg font-bold font-mono-num text-amber-900">{formatCurrency(totalRemaining, lang)}</span>
                  </div>
                  <div className="p-3 rounded-xl bg-rose-50 border border-rose-200">
                    <span className="text-[10px] text-rose-700 block">Total Overdue</span>
                    <span className="text-lg font-bold font-mono-num text-rose-900">{formatCurrency(totalOverdue, lang)}</span>
                  </div>
                </div>

                {(profileCustomer.nidNumber || profileCustomer.nidFrontUrl || profileCustomer.nidBackUrl) && (
                  <div className="p-3 rounded-xl border border-slate-200 bg-slate-50/70 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-800 flex items-center gap-1.5">
                        <ShieldCheck className="w-4 h-4 text-emerald-600" />
                        <span>Authorized Staff KYC View (Private — Masked/Hidden on Customer Slip)</span>
                      </span>
                      {profileCustomer.nidNumber && (
                        <span className="font-mono font-bold text-[#0B2A6B]">NID: {profileCustomer.nidNumber}</span>
                      )}
                    </div>
                    {(profileCustomer.nidFrontUrl || profileCustomer.nidBackUrl) && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {profileCustomer.nidFrontUrl && (
                          <div className="bg-white p-2 rounded-lg border border-slate-200">
                            <span className="text-[10px] font-semibold text-slate-500 block mb-1">NID Front</span>
                            <img src={profileCustomer.nidFrontUrl} alt="NID Front" className="w-full h-32 object-contain rounded" />
                          </div>
                        )}
                        {profileCustomer.nidBackUrl && (
                          <div className="bg-white p-2 rounded-lg border border-slate-200">
                            <span className="text-[10px] font-semibold text-slate-500 block mb-1">NID Back</span>
                            <img src={profileCustomer.nidBackUrl} alt="NID Back" className="w-full h-32 object-contain rounded" />
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Separate Installment Agreements List */}
                {custAgreements.length === 0 ? (
                  <div className="py-10 text-center text-slate-400 border border-dashed border-slate-200 rounded-xl">
                    <CalendarClock className="w-8 h-8 mx-auto mb-2 opacity-40" />
                    <p>No installment agreements recorded for this customer yet.</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {custAgreements.map(ag => {
                      const agPayments = installmentPayments.filter(p => p.agreementId === ag.id);
                      return (
                        <div key={ag.id} className="border border-slate-200 rounded-xl overflow-hidden shadow-xs">
                          <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-bold text-sm text-[#0B2A6B] font-mono">{ag.agreementCode}</span>
                              {ag.invoiceNumber && (
                                <span className="px-2 py-0.5 rounded bg-white border border-slate-200 font-mono text-[11px] text-slate-700">
                                  Invoice: {ag.invoiceNumber}
                                </span>
                              )}
                              <span
                                className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                                  ag.status === 'paid'
                                    ? 'bg-emerald-100 text-emerald-800'
                                    : ag.overdueAmount > 0
                                    ? 'bg-rose-100 text-rose-800'
                                    : ag.status === 'partial'
                                    ? 'bg-sky-100 text-sky-800'
                                    : 'bg-amber-100 text-amber-800'
                                }`}
                              >
                                {ag.status === 'paid' ? 'Paid' : ag.overdueAmount > 0 ? 'Overdue' : ag.status}
                              </span>
                            </div>

                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => setSlipAgreement(ag)}
                                className="flex items-center gap-1 px-2.5 py-1 bg-white hover:bg-slate-100 text-[#0B2A6B] border border-[#0B2A6B]/30 rounded-lg font-semibold cursor-pointer"
                              >
                                <Printer className="w-3.5 h-3.5" />
                                <span>Slip Preview / PDF</span>
                              </button>
                              {ag.remainingDue > 0 && canCollectInstallment && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setCollectingAgreement(ag);
                                    setCompletedInstPayment(null);
                                    setInstPayDate(getTodayIsoDate());
                                    setInstPayAmount(Math.min(ag.remainingDue, ag.monthlyInstallment || ag.remainingDue));
                                    setInstPayMethod('cash');
                                    setInstPayAccountId(accounts[0]?.id || '');
                                    setInstPayReceiptNo(generateInstallmentReceiptNumber());
                                    setInstPayRemarks(`Installment payment for ${ag.agreementCode}`);
                                    setInstPayClientTxId(`cust-inst-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
                                    setInstPayError(null);
                                  }}
                                  className="flex items-center gap-1 px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-semibold cursor-pointer"
                                >
                                  <CreditCard className="w-3.5 h-3.5" />
                                  <span>Collect</span>
                                </button>
                              )}
                            </div>
                          </div>

                          <div className="p-4 space-y-3 bg-white">
                            {/* All §5 Agreement Fields */}
                            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-2 text-[11px]">
                              <div className="p-2 bg-slate-50 rounded-lg">
                                <span className="text-slate-500 block">Total Purchase</span>
                                <span className="font-bold font-mono-num">{formatCurrency(ag.totalPurchaseAmount, lang)}</span>
                              </div>
                              <div className="p-2 bg-slate-50 rounded-lg">
                                <span className="text-slate-500 block">Down Payment</span>
                                <span className="font-bold font-mono-num text-emerald-700">{formatCurrency(ag.downPayment, lang)}</span>
                              </div>
                              <div className="p-2 bg-slate-50 rounded-lg">
                                <span className="text-slate-500 block">Installment Balance</span>
                                <span className="font-bold font-mono-num text-blue-900">{formatCurrency(ag.installmentBalance, lang)}</span>
                              </div>
                              <div className="p-2 bg-slate-50 rounded-lg">
                                <span className="text-slate-500 block">Duration / Monthly</span>
                                <span className="font-bold font-mono-num">{ag.durationMonths}M × {formatCurrency(ag.monthlyInstallment, lang)}</span>
                              </div>
                              <div className="p-2 bg-emerald-50 rounded-lg">
                                <span className="text-emerald-700 block">Total Paid</span>
                                <span className="font-bold font-mono-num text-emerald-800">{formatCurrency(ag.totalPaidAmount, lang)}</span>
                              </div>
                              <div className="p-2 bg-amber-50 rounded-lg">
                                <span className="text-amber-800 block font-semibold">Remaining Due</span>
                                <span className="font-bold font-mono-num text-amber-950">{formatCurrency(ag.remainingDue, lang)}</span>
                              </div>
                              <div className="p-2 bg-slate-50 rounded-lg">
                                <span className="text-slate-500 block">Last Payment Date</span>
                                <span className="font-bold">{ag.lastPaymentDate ? formatDate(ag.lastPaymentDate, 'en') : '—'}</span>
                              </div>
                              <div className="p-2 bg-slate-50 rounded-lg">
                                <span className="text-slate-500 block">Next Due Date</span>
                                <span className="font-bold">{ag.nextDueDate ? formatDate(ag.nextDueDate, 'en') : 'Settled'}</span>
                              </div>
                              <div className="p-2 bg-rose-50 rounded-lg">
                                <span className="text-rose-700 block">Overdue Amount</span>
                                <span className="font-bold font-mono-num text-rose-900">{formatCurrency(ag.overdueAmount, lang)}</span>
                              </div>
                            </div>

                            {/* Payment History inside Agreement Card */}
                            {agPayments.length > 0 && (
                              <div className="border border-slate-200 rounded-lg divide-y divide-slate-100">
                                <div className="px-3 py-1.5 bg-slate-50 font-semibold text-[11px] text-slate-600 flex items-center gap-1.5">
                                  <History className="w-3.5 h-3.5" />
                                  <span>Installment Payment History</span>
                                </div>
                                {agPayments.map(pmt => (
                                  <div key={pmt.id} className="px-3 py-2 flex flex-wrap items-center justify-between gap-2 text-[11px]">
                                    <div>
                                      <span className="font-mono font-bold text-slate-800">{pmt.receiptNumber}</span>
                                      <span className="text-slate-500 ml-2">
                                        {formatDate(pmt.paymentDate, 'en')} · {pmt.paymentMethod.toUpperCase()} · {pmt.collectedBy}
                                      </span>
                                      {pmt.status === 'reversed' && (
                                        <span className="ml-2 px-1.5 py-0.5 bg-rose-100 text-rose-800 rounded font-bold text-[10px]">
                                          REVERSED ({pmt.reversalReason})
                                        </span>
                                      )}
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <span className={`font-mono-num font-bold ${pmt.status === 'reversed' ? 'line-through text-slate-400' : 'text-emerald-700'}`}>
                                        {formatCurrency(pmt.amount, lang)}
                                      </span>
                                      {pmt.status === 'posted' && (
                                        <>
                                          <button
                                            type="button"
                                            onClick={() =>
                                              printInstallmentPaymentReceipt({
                                                payment: pmt,
                                                agreement: ag,
                                                settings,
                                                activeBranch,
                                              })
                                            }
                                            className="p-1 text-slate-600 hover:bg-slate-100 rounded border border-slate-200 cursor-pointer"
                                            title="Print Receipt"
                                          >
                                            <Printer className="w-3 h-3" />
                                          </button>
                                          {canReverseInstallment && (
                                            <button
                                              type="button"
                                              onClick={() => {
                                                setReversingInstPaymentId(pmt.id);
                                                setReversalReasonInput('');
                                              }}
                                              className="flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded cursor-pointer"
                                            >
                                              <RotateCcw className="w-3 h-3" />
                                              <span>Reverse</span>
                                            </button>
                                          )}
                                        </>
                                      )}
                                    </div>
                                    {reversingInstPaymentId === pmt.id && (
                                      <div className="w-full mt-1.5 p-2 bg-rose-50 border border-rose-200 rounded flex items-center gap-2">
                                        <input
                                          type="text"
                                          value={reversalReasonInput}
                                          onChange={e => setReversalReasonInput(e.target.value)}
                                          placeholder="Reason for reversal..."
                                          className="flex-1 p-1 border border-rose-300 rounded bg-white text-xs"
                                        />
                                        <button
                                          type="button"
                                          onClick={() => setReversingInstPaymentId(null)}
                                          className="px-2 py-1 text-[10px] text-slate-600"
                                        >
                                          Cancel
                                        </button>
                                        <button
                                          type="button"
                                          disabled={isReversingInst}
                                          onClick={async () => {
                                            if (!reversalReasonInput.trim()) return;
                                            setIsReversingInst(true);
                                            try {
                                              await reverseInstallmentPayment(pmt.id, reversalReasonInput.trim());
                                              setReversingInstPaymentId(null);
                                              setReversalReasonInput('');
                                            } finally {
                                              setIsReversingInst(false);
                                            }
                                          }}
                                          className="px-2.5 py-1 text-[10px] font-bold text-white bg-rose-600 rounded cursor-pointer"
                                        >
                                          Confirm
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="px-5 py-3 bg-slate-50 border-t border-slate-200 flex justify-end shrink-0">
                <button
                  type="button"
                  onClick={() => setInstallmentProfileCustomerId(null)}
                  className="px-4 py-2 text-xs font-semibold text-slate-700 bg-slate-200 hover:bg-slate-300 rounded-lg cursor-pointer"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Quick Collect Installment Payment Modal inside CustomersView */}
      {collectingAgreement && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 w-full max-w-md p-5 space-y-4">
            <div className="flex items-center justify-between border-b pb-2">
              <div>
                <h3 className="font-bold text-sm text-slate-900 flex items-center gap-1.5">
                  <CreditCard className="w-4 h-4 text-emerald-600" />
                  <span>Collect Installment ({collectingAgreement.agreementCode})</span>
                </h3>
                <span className="text-[11px] text-slate-500">
                  {collectingAgreement.customerName} · Remaining: {formatCurrency(collectingAgreement.remainingDue, lang)}
                </span>
              </div>
              <button type="button" onClick={() => setCollectingAgreement(null)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            {completedInstPayment ? (
              <div className="space-y-4 text-xs">
                <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-center space-y-1">
                  <CheckCircle2 className="w-7 h-7 text-emerald-600 mx-auto" />
                  <div className="font-bold text-emerald-950">Payment Recorded!</div>
                  <div className="font-mono text-slate-700">
                    Receipt: {completedInstPayment.payment.receiptNumber} · Paid: {formatCurrency(completedInstPayment.payment.amount, lang)}
                  </div>
                </div>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setCollectingAgreement(null)}
                    className="px-3.5 py-2 text-xs font-semibold bg-slate-100 rounded-lg"
                  >
                    Done
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      printInstallmentPaymentReceipt({
                        payment: completedInstPayment.payment,
                        agreement: completedInstPayment.agreement,
                        settings,
                        activeBranch,
                      })
                    }
                    className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-[#0B2A6B] rounded-lg"
                  >
                    <Printer className="w-4 h-4" />
                    <span>Print Receipt</span>
                  </button>
                </div>
              </div>
            ) : (
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (isSubmittingInstPay || instPayLockRef.current) return;
                  setInstPayError(null);
                  const amt = roundMoney(Number(instPayAmount) || 0);
                  if (amt <= 0 || amt > collectingAgreement.remainingDue + 0.01) {
                    setInstPayError(`Enter an amount between ৳1 and ${formatCurrency(collectingAgreement.remainingDue, lang)}.`);
                    return;
                  }
                  instPayLockRef.current = true;
                  setIsSubmittingInstPay(true);
                  try {
                    const pmt = await collectInstallmentPayment({
                      agreementId: collectingAgreement.id,
                      paymentDate: instPayDate,
                      amount: amt,
                      paymentMethod: instPayMethod,
                      accountId: instPayAccountId || accounts[0]?.id || '',
                      receiptNumber: instPayReceiptNo.trim() || undefined,
                      collectedBy: staffNameDefault,
                      remarks: instPayRemarks.trim() || undefined,
                      clientTxId: instPayClientTxId,
                    });
                    const updatedAg = installmentAgreements.find(a => a.id === collectingAgreement.id) || {
                      ...collectingAgreement,
                      remainingDue: roundMoney(Math.max(0, collectingAgreement.remainingDue - amt)),
                    };
                    setCompletedInstPayment({ payment: pmt, agreement: updatedAg });
                  } catch (err: any) {
                    setInstPayError(err?.message || 'Failed to record payment.');
                  } finally {
                    instPayLockRef.current = false;
                    setIsSubmittingInstPay(false);
                  }
                }}
                className="space-y-3 text-xs"
              >
                {instPayError && (
                  <div className="p-2 bg-rose-50 border border-rose-200 text-rose-700 rounded-lg">{instPayError}</div>
                )}
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">Amount *</label>
                    <input
                      type="number"
                      required
                      min="1"
                      step="any"
                      max={collectingAgreement.remainingDue}
                      value={instPayAmount}
                      onChange={e => setInstPayAmount(e.target.value === '' ? '' : Number(e.target.value))}
                      className="w-full p-2 border border-slate-200 rounded-lg font-mono-num font-bold text-emerald-700"
                    />
                  </div>
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">Date *</label>
                    <input
                      type="date"
                      required
                      value={instPayDate}
                      onChange={e => setInstPayDate(e.target.value)}
                      className="w-full p-2 border border-slate-200 rounded-lg"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">Method</label>
                    <select
                      value={instPayMethod}
                      onChange={e => setInstPayMethod(e.target.value as PaymentMethod)}
                      className="w-full p-2 border border-slate-200 rounded-lg bg-white capitalize"
                    >
                      <option value="cash">Cash</option>
                      <option value="bkash">bKash</option>
                      <option value="nagad">Nagad</option>
                      <option value="rocket">Rocket</option>
                      <option value="bank">Bank</option>
                      <option value="card">Card</option>
                    </select>
                  </div>
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">Account *</label>
                    <select
                      value={instPayAccountId}
                      onChange={e => setInstPayAccountId(e.target.value)}
                      className="w-full p-2 border border-slate-200 rounded-lg bg-white"
                    >
                      {accounts.map(a => (
                        <option key={a.id} value={a.id}>{a.name}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">Receipt #</label>
                    <input
                      type="text"
                      value={instPayReceiptNo}
                      onChange={e => setInstPayReceiptNo(e.target.value)}
                      className="w-full p-2 border border-slate-200 rounded-lg font-mono"
                    />
                  </div>
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">Remarks</label>
                    <input
                      type="text"
                      value={instPayRemarks}
                      onChange={e => setInstPayRemarks(e.target.value)}
                      className="w-full p-2 border border-slate-200 rounded-lg"
                    />
                  </div>
                </div>
                <div className="flex justify-end gap-2 pt-2 border-t">
                  <button
                    type="button"
                    onClick={() => setCollectingAgreement(null)}
                    className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded-lg"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmittingInstPay}
                    className="px-4 py-1.5 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg"
                  >
                    {isSubmittingInstPay ? 'Saving...' : 'Confirm Payment'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Installment Slip Preview / Print / A4 PDF Modal */}
      <InstallmentSlipPreviewModal
        isOpen={Boolean(slipAgreement)}
        agreement={slipAgreement}
        customer={slipAgreement ? customers.find(c => c.id === slipAgreement.customerId) || null : null}
        settings={settings}
        activeBranch={activeBranch}
        onClose={() => setSlipAgreement(null)}
      />
    </div>
  );
};
