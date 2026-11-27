import React, { useMemo, useRef, useState } from 'react';
import { useApp } from '../../context/AppContext';
import {
  InstallmentAgreement,
  InstallmentDurationMonths,
  InstallmentPaymentRecord,
  InstallmentProductItem,
  PaymentMethod,
  SaleItem,
} from '../../types';
import { formatCurrency, formatDate } from '../../utils/formatters';
import {
  buildInstallmentItemsFromSaleItems,
  calculateInstallmentSchedule,
  compressKycImageFile,
  generateInstallmentReceiptNumber,
  getDefaultFirstDueDate,
  getTodayIsoDate,
  maskNidNumber,
  roundMoney,
} from '../../utils/installmentUtils';
import { printInstallmentPaymentReceipt } from '../../utils/installmentSlipExport';
import { InstallmentSlipPreviewModal } from './InstallmentSlipPreviewModal';
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  CreditCard,
  Eye,
  FileText,
  History,
  ImagePlus,
  Plus,
  Printer,
  RotateCcw,
  Search,
  ShieldCheck,
  ShoppingBag,
  Trash2,
  UserPlus,
  Users,
  X,
} from 'lucide-react';

type StatusFilter = 'all' | 'unpaid' | 'partial' | 'paid' | 'overdue';

interface DraftCartRow {
  rowKey: string;
  productId: string;
  variantId?: string;
  productName: string;
  size: string;
  color: string;
  variantDetails?: string;
  sku?: string;
  quantity: number;
  unitPrice: number;
  purchasePrice: number;
  availableStock: number;
}

export const InstallmentsView: React.FC = () => {
  const {
    installmentAgreements,
    installmentPayments,
    createInstallmentAgreement,
    collectInstallmentPayment,
    reverseInstallmentPayment,
    customers,
    products,
    sales,
    accounts,
    branches,
    activeBranchId,
    settings,
    recordSale,
    addCustomer,
    user,
    currentEmployee,
    currentUserRole,
    isAdmin,
    hasPermission,
  } = useApp();

  const lang = settings.language;
  const activeBranch = branches.find(b => b.id === activeBranchId) || branches[0];
  const canCreate = isAdmin || hasPermission('pos_new_sale', 'create') || hasPermission('customer_management', 'edit');
  const canCollect = isAdmin || hasPermission('due_collection', 'create') || hasPermission('due_collection', 'edit');
  const canReverse = isAdmin || hasPermission('due_collection', 'delete') || hasPermission('sales_history', 'edit');

  // Filters & Search
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  // Preview Slip Modal
  const [slipAgreement, setSlipAgreement] = useState<InstallmentAgreement | null>(null);

  // Agreement Detail & History Modal
  const [detailAgreementId, setDetailAgreementId] = useState<string | null>(null);
  const [reversingPaymentId, setReversingPaymentId] = useState<string | null>(null);
  const [reversalReason, setReversalReason] = useState('');
  const [isReversing, setIsReversing] = useState(false);

  // Payment Collection Modal
  const [collectingAgreement, setCollectingAgreement] = useState<InstallmentAgreement | null>(null);
  const [payDate, setPayDate] = useState(getTodayIsoDate());
  const [payAmount, setPayAmount] = useState<number | ''>('');
  const [payMethod, setPayMethod] = useState<PaymentMethod>('cash');
  const [payAccountId, setPayAccountId] = useState(accounts[0]?.id || '');
  const [payReceiptNo, setPayReceiptNo] = useState(generateInstallmentReceiptNumber());
  const [payCollectedBy, setPayCollectedBy] = useState('');
  const [payRemarks, setPayRemarks] = useState('');
  const [payClientTxId, setPayClientTxId] = useState('');
  const [isSubmittingPay, setIsSubmittingPay] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  const [lastCompletedPayment, setLastCompletedPayment] = useState<{
    payment: InstallmentPaymentRecord;
    agreement: InstallmentAgreement;
  } | null>(null);
  const payLockRef = useRef(false);

  // New Installment Agreement / Sale Modal
  const [isNewModalOpen, setIsNewModalOpen] = useState(false);
  const [newMode, setNewMode] = useState<'new_sale' | 'from_due_sale'>('new_sale');
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [selectedExistingSaleId, setSelectedExistingSaleId] = useState('');
  const [draftItems, setDraftItems] = useState<DraftCartRow[]>([]);
  const [pickerProductId, setPickerProductId] = useState('');
  const [pickerVariantId, setPickerVariantId] = useState('');
  const [pickerQty, setPickerQty] = useState(1);
  const [downPayment, setDownPayment] = useState<number | ''>(0);
  const [downPayMethod, setDownPayMethod] = useState<PaymentMethod>('cash');
  const [downAccountId, setDownAccountId] = useState(accounts[0]?.id || '');
  const [durationMonths, setDurationMonths] = useState<InstallmentDurationMonths>(6);
  const [firstDueDate, setFirstDueDate] = useState(getDefaultFirstDueDate());
  const [agreementNote, setAgreementNote] = useState('');
  const [isCreatingAgreement, setIsCreatingAgreement] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const createLockRef = useRef(false);

  // Inline Quick-Add Customer (with optional KYC photo/NID)
  const [showQuickCustomer, setShowQuickCustomer] = useState(false);
  const [qcName, setQcName] = useState('');
  const [qcMobile, setQcMobile] = useState('');
  const [qcAddress, setQcAddress] = useState('');
  const [qcPhotoUrl, setQcPhotoUrl] = useState('');
  const [qcNidNumber, setQcNidNumber] = useState('');
  const [qcNidFrontUrl, setQcNidFrontUrl] = useState('');
  const [qcNidBackUrl, setQcNidBackUrl] = useState('');
  const [qcConsent, setQcConsent] = useState(false);

  const staffNameDefault =
    currentEmployee?.name ||
    user?.user_metadata?.full_name ||
    user?.email?.split('@')[0] ||
    (currentUserRole === 'seller' || currentUserRole === 'salesman' ? 'Seller' : 'Admin');

  // Always pick live agreement from state so updates show immediately
  const detailAgreement = useMemo(
    () => installmentAgreements.find(a => a.id === detailAgreementId) || null,
    [installmentAgreements, detailAgreementId]
  );

  // KPIs
  const metrics = useMemo(() => {
    const active = installmentAgreements.filter(a => a.status !== 'paid');
    const overdue = active.filter(a => a.overdueAmount > 0);
    return {
      activeCount: active.length,
      totalBalance: roundMoney(
        installmentAgreements.reduce((s, a) => s + a.installmentBalance, 0)
      ),
      totalRemainingDue: roundMoney(
        active.reduce((s, a) => s + a.remainingDue, 0)
      ),
      overdueCount: overdue.length,
      totalOverdueAmount: roundMoney(
        overdue.reduce((s, a) => s + a.overdueAmount, 0)
      ),
    };
  }, [installmentAgreements]);

  const filteredAgreements = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return installmentAgreements.filter(a => {
      const matchesStatus =
        statusFilter === 'all'
          ? true
          : statusFilter === 'overdue'
          ? a.overdueAmount > 0 && a.status !== 'paid'
          : a.status === statusFilter;

      if (!matchesStatus) return false;
      if (!q) return true;
      return (
        a.customerName.toLowerCase().includes(q) ||
        a.customerMobile.toLowerCase().includes(q) ||
        a.agreementCode.toLowerCase().includes(q) ||
        (a.invoiceNumber || '').toLowerCase().includes(q)
      );
    });
  }, [installmentAgreements, searchQuery, statusFilter]);

  // Existing due sales that do not yet have an installment agreement
  const eligibleDueSales = useMemo(() => {
    const linkedSaleIds = new Set(
      installmentAgreements.map(a => a.saleId).filter(Boolean) as string[]
    );
    return sales.filter(
      s =>
        s.due > 0 &&
        s.status !== 'returned' &&
        s.customerId &&
        !linkedSaleIds.has(s.id) &&
        (!selectedCustomerId || s.customerId === selectedCustomerId)
    );
  }, [sales, installmentAgreements, selectedCustomerId]);

  const activeProducts = useMemo(
    () => products.filter(p => p.isActive !== false),
    [products]
  );

  const selectedPickerProduct = useMemo(
    () => activeProducts.find(p => p.id === pickerProductId) || null,
    [activeProducts, pickerProductId]
  );

  // Live Schedule Preview for New Installment Modal
  const draftTotals = useMemo(() => {
    if (newMode === 'from_due_sale') {
      const sale = eligibleDueSales.find(s => s.id === selectedExistingSaleId);
      if (!sale) {
        return {
          totalPurchase: 0,
          downPaymentAmt: 0,
          balance: 0,
          monthlyInstallment: 0,
          schedule: [],
          sale: null,
        };
      }
      const calc = calculateInstallmentSchedule(sale.due, durationMonths, firstDueDate);
      return {
        totalPurchase: sale.total,
        downPaymentAmt: sale.paid,
        balance: calc.installmentBalance,
        monthlyInstallment: calc.monthlyInstallment,
        schedule: calc.schedule,
        sale,
      };
    }

    const totalPurchase = roundMoney(
      draftItems.reduce((sum, it) => sum + it.unitPrice * it.quantity, 0)
    );
    const downAmt = Math.min(totalPurchase, Math.max(0, Number(downPayment) || 0));
    const balance = roundMoney(Math.max(0, totalPurchase - downAmt));
    const calc = calculateInstallmentSchedule(balance, durationMonths, firstDueDate);
    return {
      totalPurchase,
      downPaymentAmt: downAmt,
      balance: calc.installmentBalance,
      monthlyInstallment: calc.monthlyInstallment,
      schedule: calc.schedule,
      sale: null,
    };
  }, [newMode, eligibleDueSales, selectedExistingSaleId, draftItems, downPayment, durationMonths, firstDueDate]);

  // Helpers
  const getBranchStockForProduct = (productId: string, variantId?: string): number => {
    const prod = activeProducts.find(p => p.id === productId);
    if (!prod) return 0;
    if (variantId && prod.variants?.length) {
      const v = prod.variants.find(vr => vr.id === variantId);
      if (v) return v.stock ?? 0;
    }
    return prod.currentStock ?? 0;
  };

  const handleOpenNewModal = () => {
    setCreateError(null);
    setNewMode('new_sale');
    setSelectedCustomerId('');
    setSelectedExistingSaleId('');
    setDraftItems([]);
    setPickerProductId('');
    setPickerVariantId('');
    setPickerQty(1);
    setDownPayment(0);
    setDownPayMethod('cash');
    setDownAccountId(accounts[0]?.id || '');
    setDurationMonths(6);
    setFirstDueDate(getDefaultFirstDueDate());
    setAgreementNote('');
    setShowQuickCustomer(false);
    setIsNewModalOpen(true);
  };

  const handleAddDraftItem = () => {
    if (!selectedPickerProduct) return;
    const variant = selectedPickerProduct.variants?.find(v => v.id === pickerVariantId);
    const stock = getBranchStockForProduct(selectedPickerProduct.id, variant?.id);
    const qty = Math.max(1, Math.floor(Number(pickerQty) || 1));

    if (stock < qty) {
      setCreateError(
        `Insufficient stock for ${selectedPickerProduct.name}${variant ? ` (${variant.color}/${variant.size})` : ''}. Available: ${stock}`
      );
      return;
    }

    const unitPrice = roundMoney(
      variant?.salePrice ?? selectedPickerProduct.salePrice
    );
    const purchasePrice = roundMoney(
      variant?.purchasePrice ??
        selectedPickerProduct.totalUnitCost ??
        selectedPickerProduct.purchasePrice
    );

    const rowKey = `${selectedPickerProduct.id}::${variant?.id || 'base'}`;
    setCreateError(null);
    setDraftItems(prev => {
      const existing = prev.find(r => r.rowKey === rowKey);
      if (existing) {
        const nextQty = existing.quantity + qty;
        if (nextQty > stock) {
          setCreateError(`Total quantity (${nextQty}) exceeds available stock (${stock}).`);
          return prev;
        }
        return prev.map(r => (r.rowKey === rowKey ? { ...r, quantity: nextQty } : r));
      }
      return [
        ...prev,
        {
          rowKey,
          productId: selectedPickerProduct.id,
          variantId: variant?.id,
          productName: selectedPickerProduct.name,
          size: variant?.size || '—',
          color: variant?.color || '—',
          variantDetails: variant ? `${variant.color} / ${variant.size}` : undefined,
          sku: variant?.sku || selectedPickerProduct.code || selectedPickerProduct.barcode || '',
          quantity: qty,
          unitPrice,
          purchasePrice,
          availableStock: stock,
        },
      ];
    });
    setPickerQty(1);
  };

  const handleSaveQuickCustomer = async () => {
    if (!qcName.trim() || !qcMobile.trim()) {
      setCreateError('Customer name and mobile number are required.');
      return;
    }
    try {
      const created = await addCustomer({
        name: qcName.trim(),
        mobile: qcMobile.trim(),
        address: qcAddress.trim() || undefined,
        customerType: 'retail',
        creditLimit: 50000,
        photoUrl: qcPhotoUrl || undefined,
        nidNumber: qcNidNumber.trim() || undefined,
        nidFrontUrl: qcNidFrontUrl || undefined,
        nidBackUrl: qcNidBackUrl || undefined,
        kycConsent: qcConsent,
        kycConsentAt: qcConsent ? new Date().toISOString() : undefined,
      });
      setSelectedCustomerId(created.id);
      setShowQuickCustomer(false);
      setQcName('');
      setQcMobile('');
      setQcAddress('');
      setQcPhotoUrl('');
      setQcNidNumber('');
      setQcNidFrontUrl('');
      setQcNidBackUrl('');
      setQcConsent(false);
      setCreateError(null);
    } catch (err: any) {
      setCreateError(err?.message || 'Failed to save customer.');
    }
  };

  const handleKycImagePick = async (
    file: File | undefined,
    setter: React.Dispatch<React.SetStateAction<string>>
  ) => {
    if (!file) return;
    try {
      const compressed = await compressKycImageFile(file);
      setter(compressed);
      setCreateError(null);
    } catch (err: any) {
      setCreateError(err?.message || 'Invalid image file.');
    }
  };

  const handleSubmitNewAgreement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isCreatingAgreement || createLockRef.current) return;
    setCreateError(null);

    if (newMode === 'from_due_sale') {
      const sale = draftTotals.sale;
      if (!sale || !sale.customerId) {
        setCreateError('Please select a due invoice with a registered customer.');
        return;
      }
      createLockRef.current = true;
      setIsCreatingAgreement(true);
      try {
        const items: InstallmentProductItem[] = buildInstallmentItemsFromSaleItems(sale.items);
        const created = await createInstallmentAgreement({
          customerId: sale.customerId,
          saleId: sale.id,
          invoiceNumber: sale.invoiceNumber,
          items,
          totalPurchaseAmount: sale.total,
          downPayment: sale.paid,
          durationMonths,
          firstDueDate,
          agreementDate: sale.date.slice(0, 10),
          notes: agreementNote.trim() || undefined,
        });
        setIsNewModalOpen(false);
        setSlipAgreement(created);
      } catch (err: any) {
        setCreateError(err?.message || 'Failed to create installment agreement.');
      } finally {
        createLockRef.current = false;
        setIsCreatingAgreement(false);
      }
      return;
    }

    // Mode: Brand-new Installment Sale
    if (!selectedCustomerId) {
      setCreateError('Please select or register a customer for installment sales.');
      return;
    }
    if (draftItems.length === 0) {
      setCreateError('Please add at least one product to the installment sale.');
      return;
    }
    if (draftTotals.balance <= 0) {
      setCreateError('Installment balance must be greater than ৳0 (Down payment cannot equal full price).');
      return;
    }

    const customer = customers.find(c => c.id === selectedCustomerId);
    if (!customer) {
      setCreateError('Selected customer not found.');
      return;
    }

    const downAmt = draftTotals.downPaymentAmt;
    const depositAcc = accounts.find(a => a.id === downAccountId) || accounts[0];
    if (downAmt > 0 && !depositAcc) {
      setCreateError('Please select a valid deposit account for the down payment.');
      return;
    }

    createLockRef.current = true;
    setIsCreatingAgreement(true);
    try {
      const saleItems: SaleItem[] = draftItems.map(row => ({
        productId: row.productId,
        variantId: row.variantId,
        productName: row.productName,
        variantDetails: row.variantDetails,
        colorName: row.color !== '—' ? row.color : undefined,
        sku: row.sku || '',
        quantity: row.quantity,
        unitPrice: row.unitPrice,
        purchasePrice: row.purchasePrice,
        discount: 0,
        total: roundMoney(row.unitPrice * row.quantity),
      }));

      const totalPurchase = draftTotals.totalPurchase;
      const clientTxId = `inst-sale-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

      // Record ONE authoritative Sale (deducts stock once, credits down payment once, records profit once, adds balance to customer.currentDue once)
      const saleRecord = await recordSale({
        clientTxId,
        customerId: customer.id,
        customerName: customer.name,
        customerMobile: customer.mobile,
        items: saleItems,
        subtotal: totalPurchase,
        discount: 0,
        vatTaxRate: 0,
        vatTaxAmount: 0,
        total: totalPurchase,
        paid: downAmt,
        due: draftTotals.balance,
        paymentMethod: downAmt > 0 ? downPayMethod : 'due',
        payments:
          downAmt > 0 && depositAcc
            ? [
                {
                  method: downPayMethod,
                  amount: downAmt,
                  accountId: depositAcc.id,
                  accountName: depositAcc.name,
                },
              ]
            : [],
        servedBy: staffNameDefault,
        sellerId: user?.id,
        sellerName: staffNameDefault,
        employeeId: currentEmployee?.id,
        employeeCode: currentEmployee?.employeeCode,
        employeeName: staffNameDefault,
        branchId: activeBranchId,
        notes: `Installment Sale (${durationMonths}M)${agreementNote.trim() ? ` · ${agreementNote.trim()}` : ''}`,
      });

      const agreementItems: InstallmentProductItem[] = draftItems.map(r => ({
        productId: r.productId,
        productName: r.productName,
        size: r.size,
        color: r.color,
        quantity: r.quantity,
        unitPrice: r.unitPrice,
        totalPrice: roundMoney(r.unitPrice * r.quantity),
      }));

      const createdAgreement = await createInstallmentAgreement({
        customerId: customer.id,
        saleId: saleRecord.id,
        invoiceNumber: saleRecord.invoiceNumber,
        items: agreementItems,
        totalPurchaseAmount: totalPurchase,
        downPayment: downAmt,
        durationMonths,
        firstDueDate,
        agreementDate: getTodayIsoDate(),
        notes: agreementNote.trim() || undefined,
      });

      setIsNewModalOpen(false);
      setSlipAgreement(createdAgreement);
    } catch (err: any) {
      setCreateError(err?.message || 'Failed to record installment sale.');
    } finally {
      createLockRef.current = false;
      setIsCreatingAgreement(false);
    }
  };

  // Payment Collection Handlers
  const handleOpenCollectPayment = (ag: InstallmentAgreement) => {
    setCollectingAgreement(ag);
    setLastCompletedPayment(null);
    setPayDate(getTodayIsoDate());
    const suggested = Math.min(ag.remainingDue, ag.monthlyInstallment || ag.remainingDue);
    setPayAmount(suggested);
    setPayMethod('cash');
    setPayAccountId(accounts[0]?.id || '');
    setPayReceiptNo(generateInstallmentReceiptNumber());
    setPayCollectedBy(staffNameDefault);
    setPayRemarks(`Installment payment for ${ag.agreementCode}`);
    setPayClientTxId(`inst-pay-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    setPayError(null);
  };

  const handleSubmitPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!collectingAgreement || isSubmittingPay || payLockRef.current) return;
    setPayError(null);

    const amountNum = roundMoney(Number(payAmount) || 0);
    if (amountNum <= 0) {
      setPayError('Payment amount must be greater than ৳0.');
      return;
    }
    if (amountNum > collectingAgreement.remainingDue + 0.01) {
      setPayError(
        `Amount cannot exceed remaining balance (${formatCurrency(collectingAgreement.remainingDue, lang)}).`
      );
      return;
    }
    if (!payAccountId) {
      setPayError('Please select a deposit account.');
      return;
    }

    payLockRef.current = true;
    setIsSubmittingPay(true);
    try {
      const payment = await collectInstallmentPayment({
        agreementId: collectingAgreement.id,
        paymentDate: payDate,
        amount: amountNum,
        paymentMethod: payMethod,
        accountId: payAccountId,
        receiptNumber: payReceiptNo.trim() || undefined,
        collectedBy: payCollectedBy.trim() || staffNameDefault,
        remarks: payRemarks.trim() || undefined,
        clientTxId: payClientTxId,
      });

      const refreshedAg =
        installmentAgreements.find(a => a.id === collectingAgreement.id) || {
          ...collectingAgreement,
          remainingDue: roundMoney(Math.max(0, collectingAgreement.remainingDue - amountNum)),
        };

      setLastCompletedPayment({ payment, agreement: refreshedAg });
    } catch (err: any) {
      setPayError(err?.message || 'Failed to record installment payment.');
    } finally {
      payLockRef.current = false;
      setIsSubmittingPay(false);
    }
  };

  const handleConfirmReverse = async (paymentId: string) => {
    if (!reversalReason.trim()) {
      alert('Please enter a reason for reversing this installment payment.');
      return;
    }
    if (isReversing) return;
    setIsReversing(true);
    try {
      await reverseInstallmentPayment(paymentId, reversalReason.trim());
      setReversingPaymentId(null);
      setReversalReason('');
    } catch (err: any) {
      alert(err?.message || 'Failed to reverse payment.');
    } finally {
      setIsReversing(false);
    }
  };

  const statusBadge = (ag: InstallmentAgreement) => {
    if (ag.status === 'paid') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
          <CheckCircle2 className="w-3 h-3" />
          Paid
        </span>
      );
    }
    if (ag.overdueAmount > 0) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800 border border-rose-200">
          <AlertTriangle className="w-3 h-3" />
          Overdue ({formatCurrency(ag.overdueAmount, lang)})
        </span>
      );
    }
    if (ag.status === 'partial') {
      const paidCount = ag.schedule.filter(r => r.status === 'paid').length;
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-sky-100 text-sky-800 border border-sky-200">
          Partial ({paidCount}/{ag.durationMonths})
        </span>
      );
    }
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-200">
        Unpaid
      </span>
    );
  };

  const detailPayments = useMemo(
    () =>
      detailAgreement
        ? installmentPayments.filter(p => p.agreementId === detailAgreement.id)
        : [],
    [installmentPayments, detailAgreement]
  );

  return (
    <div className="space-y-4">
      {/* KPI Overview */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs">
          <span className="text-xs text-slate-500 block">Active Installments</span>
          <span className="text-2xl font-bold font-mono-num text-slate-900 mt-1 block">
            {metrics.activeCount}
          </span>
          <span className="text-[11px] text-slate-500 mt-0.5 block">
            Out of {installmentAgreements.length} total agreements
          </span>
        </div>

        <div className="bg-white rounded-xl border border-blue-200 bg-blue-50/30 p-4 shadow-xs">
          <span className="text-xs text-blue-800 font-semibold block">Total Financed Balance</span>
          <span className="text-2xl font-bold font-mono-num text-blue-950 mt-1 block">
            {formatCurrency(metrics.totalBalance, lang)}
          </span>
          <span className="text-[11px] text-blue-700 mt-0.5 block">
            Original installment principal
          </span>
        </div>

        <div className="bg-white rounded-xl border border-amber-200 bg-amber-50/40 p-4 shadow-xs">
          <span className="text-xs text-amber-800 font-semibold block">Remaining Due</span>
          <span className="text-2xl font-bold font-mono-num text-amber-900 mt-1 block">
            {formatCurrency(metrics.totalRemainingDue, lang)}
          </span>
          <span className="text-[11px] text-amber-700 mt-0.5 block">
            Uncollected receivable installments
          </span>
        </div>

        <div className="bg-white rounded-xl border border-rose-200 bg-rose-50/40 p-4 shadow-xs flex items-center justify-between gap-2">
          <div>
            <span className="text-xs text-rose-800 font-semibold block">Overdue Installments</span>
            <span className="text-2xl font-bold font-mono-num text-rose-900 mt-1 block">
              {formatCurrency(metrics.totalOverdueAmount, lang)}
            </span>
            <span className="text-[11px] text-rose-700 mt-0.5 block">
              {metrics.overdueCount} customer agreement(s) overdue
            </span>
          </div>
          {canCreate && (
            <button
              type="button"
              onClick={handleOpenNewModal}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-white bg-[#0B2A6B] hover:brightness-110 rounded-xl shadow-xs transition-all cursor-pointer shrink-0"
            >
              <Plus className="w-4 h-4" />
              <span>New Installment</span>
            </button>
          )}
        </div>
      </div>

      {/* Search & Status Filter Toolbar */}
      <div className="bg-white rounded-xl border border-slate-200 p-3 shadow-xs flex flex-col md:flex-row items-stretch md:items-center gap-2 text-xs">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search by customer name, phone, Agreement ID (INS-...), or Invoice #..."
            className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0B2A6B]/20 bg-slate-50/60"
          />
        </div>

        <div className="flex flex-wrap items-center gap-1">
          {(
            [
              { id: 'all', label: 'All' },
              { id: 'unpaid', label: 'Unpaid' },
              { id: 'partial', label: 'Partial' },
              { id: 'overdue', label: `Overdue (${metrics.overdueCount})` },
              { id: 'paid', label: 'Paid' },
            ] as { id: StatusFilter; label: string }[]
          ).map(tab => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setStatusFilter(tab.id)}
              className={`px-3 py-1.5 rounded-lg border font-semibold transition-colors cursor-pointer ${
                statusFilter === tab.id
                  ? tab.id === 'overdue'
                    ? 'bg-rose-600 text-white border-rose-600'
                    : 'bg-[#0B2A6B] text-white border-[#0B2A6B]'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Agreements Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
              <tr>
                <th className="px-4 py-3 font-semibold">Customer</th>
                <th className="px-4 py-3 font-semibold">Agreement &amp; Invoice</th>
                <th className="px-4 py-3 font-semibold text-right">Purchase / Down</th>
                <th className="px-4 py-3 font-semibold text-right">Monthly ({'1-6M'})</th>
                <th className="px-4 py-3 font-semibold text-right">Paid / Remaining Due</th>
                <th className="px-4 py-3 font-semibold">Next / Last Date</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredAgreements.map(ag => {
                const cust = customers.find(c => c.id === ag.customerId);
                const photo = ag.customerPhotoUrl || cust?.photoUrl;
                const maskedNid = maskNidNumber(ag.customerNidNumber || cust?.nidNumber);
                return (
                  <tr key={ag.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        {photo ? (
                          <img
                            src={photo}
                            alt={ag.customerName}
                            className="w-9 h-9 rounded-lg object-cover border border-slate-200 shrink-0"
                          />
                        ) : (
                          <div className="w-9 h-9 rounded-lg bg-[#0B2A6B]/10 text-[#0B2A6B] font-bold flex items-center justify-center shrink-0">
                            {ag.customerName.slice(0, 1).toUpperCase()}
                          </div>
                        )}
                        <div className="min-w-0">
                          <div className="font-bold text-slate-900 truncate max-w-[160px]">
                            {ag.customerName}
                          </div>
                          <div className="text-[11px] font-mono text-slate-500">
                            {ag.customerMobile}
                          </div>
                          {maskedNid && (
                            <span className="inline-flex items-center gap-0.5 text-[10px] text-emerald-700 font-mono">
                              <ShieldCheck className="w-3 h-3" /> NID: {maskedNid}
                            </span>
                          )}
                        </div>
                      </div>
                    </td>

                    <td className="px-4 py-3">
                      <div className="font-bold text-[#0B2A6B] font-mono">
                        {ag.agreementCode}
                      </div>
                      <div className="text-[11px] text-slate-500 font-mono">
                        {ag.invoiceNumber ? `Inv: ${ag.invoiceNumber}` : 'Direct Agreement'}
                      </div>
                      <div className="text-[10px] text-slate-400">
                        {formatDate(ag.agreementDate, 'en')}
                      </div>
                    </td>

                    <td className="px-4 py-3 text-right font-mono-num">
                      <div className="font-semibold text-slate-900">
                        {formatCurrency(ag.totalPurchaseAmount, lang)}
                      </div>
                      <div className="text-[11px] text-emerald-700">
                        Down: {formatCurrency(ag.downPayment, lang)}
                      </div>
                    </td>

                    <td className="px-4 py-3 text-right font-mono-num">
                      <div className="font-bold text-slate-900">
                        {formatCurrency(ag.monthlyInstallment, lang)}
                      </div>
                      <div className="text-[10px] text-purple-700 font-semibold">
                        {ag.durationMonths} Month{ag.durationMonths > 1 ? 's' : ''}
                      </div>
                    </td>

                    <td className="px-4 py-3 text-right font-mono-num">
                      <div className="text-[11px] text-emerald-700 font-semibold">
                        Paid: {formatCurrency(ag.totalPaidAmount, lang)}
                      </div>
                      <div
                        className={`font-bold text-sm ${
                          ag.remainingDue > 0 ? 'text-amber-800' : 'text-slate-400'
                        }`}
                      >
                        Due: {formatCurrency(ag.remainingDue, lang)}
                      </div>
                    </td>

                    <td className="px-4 py-3 text-[11px]">
                      {ag.nextDueDate ? (
                        <div className="font-medium text-slate-800">
                          Next: {formatDate(ag.nextDueDate, 'en')}
                        </div>
                      ) : (
                        <div className="text-emerald-700 font-semibold">Completed</div>
                      )}
                      <div className="text-[10px] text-slate-500">
                        Last Paid: {ag.lastPaymentDate ? formatDate(ag.lastPaymentDate, 'en') : '—'}
                      </div>
                    </td>

                    <td className="px-4 py-3 whitespace-nowrap">{statusBadge(ag)}</td>

                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => setSlipAgreement(ag)}
                          title="Preview / Print / Download Customer Slip"
                          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#0B2A6B]/10 hover:bg-[#0B2A6B]/15 text-[#0B2A6B] font-semibold transition-colors cursor-pointer"
                        >
                          <Printer className="w-3.5 h-3.5" />
                          <span>Slip</span>
                        </button>

                        {ag.remainingDue > 0 && canCollect && (
                          <button
                            type="button"
                            onClick={() => handleOpenCollectPayment(ag)}
                            title="Collect Installment Payment"
                            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold transition-colors cursor-pointer"
                          >
                            <CreditCard className="w-3.5 h-3.5" />
                            <span>Collect</span>
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() => setDetailAgreementId(ag.id)}
                          title="View Schedule & Payment History"
                          className="p-1.5 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-100 border border-slate-200 transition-colors cursor-pointer"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}

              {filteredAgreements.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-400">
                    <CalendarClock className="w-8 h-8 mx-auto mb-2 opacity-40" />
                    <p className="text-xs font-medium">No installment agreements found.</p>
                    {canCreate && (
                      <button
                        type="button"
                        onClick={handleOpenNewModal}
                        className="mt-3 inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-[#0B2A6B] text-white text-xs font-semibold cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        Create First Installment Sale
                      </button>
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Customer Installment Slip Preview / Print / PDF Modal */}
      <InstallmentSlipPreviewModal
        isOpen={Boolean(slipAgreement)}
        agreement={slipAgreement}
        customer={
          slipAgreement
            ? customers.find(c => c.id === slipAgreement.customerId) || null
            : null
        }
        settings={settings}
        activeBranch={activeBranch}
        onClose={() => setSlipAgreement(null)}
      />

      {/* Payment Collection Modal */}
      {collectingAgreement && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 w-full max-w-md p-5 space-y-4">
            <div className="flex items-center justify-between border-b pb-2.5">
              <div>
                <h3 className="font-bold text-sm text-slate-900 flex items-center gap-1.5">
                  <CreditCard className="w-4 h-4 text-emerald-600" />
                  <span>Collect Installment Payment</span>
                </h3>
                <p className="text-[11px] text-slate-500">
                  {collectingAgreement.customerName} · {collectingAgreement.agreementCode}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCollectingAgreement(null)}
                className="text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {lastCompletedPayment ? (
              <div className="space-y-4 text-xs">
                <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-center space-y-1.5">
                  <CheckCircle2 className="w-8 h-8 text-emerald-600 mx-auto" />
                  <div className="font-bold text-emerald-950 text-sm">
                    Installment Payment Recorded!
                  </div>
                  <div className="text-slate-700 font-mono-num">
                    Receipt: <strong>{lastCompletedPayment.payment.receiptNumber}</strong> · Paid:{' '}
                    <strong>{formatCurrency(lastCompletedPayment.payment.amount, lang)}</strong>
                  </div>
                  <div className="text-[11px] text-emerald-800">
                    Remaining Agreement Balance:{' '}
                    <strong className="font-mono-num">
                      {formatCurrency(lastCompletedPayment.agreement.remainingDue, lang)}
                    </strong>
                  </div>
                </div>

                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setCollectingAgreement(null)}
                    className="px-3.5 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer"
                  >
                    Done
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      printInstallmentPaymentReceipt({
                        payment: lastCompletedPayment.payment,
                        agreement: lastCompletedPayment.agreement,
                        settings,
                        activeBranch,
                      })
                    }
                    className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-[#0B2A6B] hover:brightness-110 rounded-lg cursor-pointer"
                  >
                    <Printer className="w-4 h-4" />
                    <span>Print Payment Receipt</span>
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleSubmitPayment} className="space-y-3 text-xs">
                <div className="grid grid-cols-2 gap-2 p-2.5 bg-slate-50 rounded-xl border border-slate-200">
                  <div>
                    <span className="text-[10px] text-slate-500 block">Remaining Balance</span>
                    <span className="font-bold text-sm font-mono-num text-amber-800">
                      {formatCurrency(collectingAgreement.remainingDue, lang)}
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="text-[10px] text-slate-500 block">Monthly Installment</span>
                    <span className="font-bold text-sm font-mono-num text-slate-900">
                      {formatCurrency(collectingAgreement.monthlyInstallment, lang)}
                    </span>
                  </div>
                </div>

                {payError && (
                  <div className="p-2 bg-rose-50 border border-rose-200 text-rose-700 rounded-lg font-medium">
                    {payError}
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      Payment Amount *
                    </label>
                    <input
                      type="number"
                      required
                      min="1"
                      step="any"
                      max={collectingAgreement.remainingDue}
                      value={payAmount}
                      onChange={e =>
                        setPayAmount(e.target.value === '' ? '' : Number(e.target.value))
                      }
                      className="w-full p-2 border border-slate-200 rounded-lg font-mono-num font-bold text-emerald-700 text-sm"
                    />
                    <div className="flex gap-1 mt-1">
                      <button
                        type="button"
                        onClick={() =>
                          setPayAmount(
                            Math.min(
                              collectingAgreement.remainingDue,
                              collectingAgreement.monthlyInstallment
                            )
                          )
                        }
                        className="px-1.5 py-0.5 bg-slate-100 hover:bg-slate-200 rounded text-[10px] font-semibold text-slate-700 cursor-pointer"
                      >
                        1 Month
                      </button>
                      <button
                        type="button"
                        onClick={() => setPayAmount(collectingAgreement.remainingDue)}
                        className="px-1.5 py-0.5 bg-emerald-50 hover:bg-emerald-100 rounded text-[10px] font-semibold text-emerald-800 cursor-pointer"
                      >
                        Full Due
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      Payment Date *
                    </label>
                    <input
                      type="date"
                      required
                      value={payDate}
                      onChange={e => setPayDate(e.target.value)}
                      className="w-full p-2 border border-slate-200 rounded-lg"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Method</label>
                    <select
                      value={payMethod}
                      onChange={e => setPayMethod(e.target.value as PaymentMethod)}
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
                    <label className="block font-semibold text-slate-700 mb-1">
                      Deposit Account *
                    </label>
                    <select
                      required
                      value={payAccountId}
                      onChange={e => setPayAccountId(e.target.value)}
                      className="w-full p-2 border border-slate-200 rounded-lg bg-white"
                    >
                      {accounts.map(acc => (
                        <option key={acc.id} value={acc.id}>
                          {acc.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      Receipt Number
                    </label>
                    <input
                      type="text"
                      value={payReceiptNo}
                      onChange={e => setPayReceiptNo(e.target.value)}
                      className="w-full p-2 border border-slate-200 rounded-lg font-mono"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      Collected By
                    </label>
                    <input
                      type="text"
                      value={payCollectedBy}
                      onChange={e => setPayCollectedBy(e.target.value)}
                      className="w-full p-2 border border-slate-200 rounded-lg"
                    />
                  </div>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Remarks</label>
                  <input
                    type="text"
                    value={payRemarks}
                    onChange={e => setPayRemarks(e.target.value)}
                    placeholder="Optional note or installment month reference"
                    className="w-full p-2 border border-slate-200 rounded-lg"
                  />
                </div>

                <div className="flex justify-end gap-2 pt-2 border-t">
                  <button
                    type="button"
                    onClick={() => setCollectingAgreement(null)}
                    className="px-3.5 py-2 text-xs text-slate-600 hover:bg-slate-100 rounded-lg cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmittingPay}
                    className="px-4 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 rounded-lg shadow-xs cursor-pointer"
                  >
                    {isSubmittingPay ? 'Recording...' : 'Confirm Payment'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Agreement Full Profile, Schedule & Payment History / Reversal Modal */}
      {detailAgreement && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-slate-900/65 backdrop-blur-xs overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-3xl max-h-[92vh] flex flex-col overflow-hidden my-auto">
            <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50 flex items-center justify-between gap-3 shrink-0">
              <div>
                <h3 className="font-bold text-sm sm:text-base text-slate-900 flex items-center gap-2">
                  <FileText className="w-4 h-4 text-[#0B2A6B]" />
                  <span>Installment Agreement · {detailAgreement.agreementCode}</span>
                  {statusBadge(detailAgreement)}
                </h3>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Customer: <strong>{detailAgreement.customerName}</strong> ({detailAgreement.customerMobile})
                  {detailAgreement.invoiceNumber && ` · Invoice: ${detailAgreement.invoiceNumber}`}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setDetailAgreementId(null);
                  setReversingPaymentId(null);
                }}
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-5 text-xs">
              {/* Complete §5 Metrics Grid (Shown ONLY inside app UI, never Last Payment Date / Remaining Due on Customer Copy) */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                  <span className="text-[10px] text-slate-500 block">Total Purchase</span>
                  <span className="font-bold text-sm font-mono-num text-slate-900">
                    {formatCurrency(detailAgreement.totalPurchaseAmount, lang)}
                  </span>
                </div>
                <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200">
                  <span className="text-[10px] text-emerald-700 block">Down Payment</span>
                  <span className="font-bold text-sm font-mono-num text-emerald-900">
                    {formatCurrency(detailAgreement.downPayment, lang)}
                  </span>
                </div>
                <div className="p-3 rounded-xl bg-blue-50 border border-blue-200">
                  <span className="text-[10px] text-blue-700 block">Installment Balance</span>
                  <span className="font-bold text-sm font-mono-num text-blue-950">
                    {formatCurrency(detailAgreement.installmentBalance, lang)}
                  </span>
                </div>
                <div className="p-3 rounded-xl bg-purple-50 border border-purple-200">
                  <span className="text-[10px] text-purple-700 block">Duration &amp; Monthly</span>
                  <span className="font-bold text-sm font-mono-num text-purple-950">
                    {detailAgreement.durationMonths}M × {formatCurrency(detailAgreement.monthlyInstallment, lang)}
                  </span>
                </div>
                <div className="p-3 rounded-xl bg-emerald-50/70 border border-emerald-200">
                  <span className="text-[10px] text-emerald-700 block">Total Installments Paid</span>
                  <span className="font-bold text-sm font-mono-num text-emerald-800">
                    {formatCurrency(detailAgreement.totalPaidAmount, lang)}
                  </span>
                </div>
                <div className="p-3 rounded-xl bg-amber-50 border border-amber-300">
                  <span className="text-[10px] text-amber-800 font-semibold block">Remaining Due</span>
                  <span className="font-bold text-sm font-mono-num text-amber-950">
                    {formatCurrency(detailAgreement.remainingDue, lang)}
                  </span>
                </div>
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                  <span className="text-[10px] text-slate-500 block">Last Payment Date</span>
                  <span className="font-bold text-slate-900">
                    {detailAgreement.lastPaymentDate
                      ? formatDate(detailAgreement.lastPaymentDate, 'en')
                      : 'No payment yet'}
                  </span>
                </div>
                <div className="p-3 rounded-xl bg-rose-50/70 border border-rose-200">
                  <span className="text-[10px] text-rose-700 block">Next Due / Overdue</span>
                  <span className="font-bold text-rose-900 block">
                    {detailAgreement.nextDueDate
                      ? formatDate(detailAgreement.nextDueDate, 'en')
                      : 'Settled'}
                  </span>
                  {detailAgreement.overdueAmount > 0 && (
                    <span className="text-[10px] font-bold font-mono-num text-rose-700">
                      Overdue: {formatCurrency(detailAgreement.overdueAmount, lang)}
                    </span>
                  )}
                </div>
              </div>

              {/* Installment Schedule Table */}
              <div className="space-y-2">
                <h4 className="font-bold text-slate-800 flex items-center gap-1.5">
                  <CalendarClock className="w-4 h-4 text-[#0B2A6B]" />
                  <span>Installment Schedule ({detailAgreement.durationMonths} Months)</span>
                </h4>
                <div className="border border-slate-200 rounded-xl overflow-hidden">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                      <tr>
                        <th className="px-3 py-2">#</th>
                        <th className="px-3 py-2">Installment</th>
                        <th className="px-3 py-2">Due Date</th>
                        <th className="px-3 py-2 text-right">Amount</th>
                        <th className="px-3 py-2 text-right">Paid</th>
                        <th className="px-3 py-2 text-center">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {detailAgreement.schedule.map(row => (
                        <tr key={row.installmentNumber}>
                          <td className="px-3 py-2 font-mono">{row.installmentNumber}</td>
                          <td className="px-3 py-2 font-medium">{row.labelEn}</td>
                          <td className="px-3 py-2 font-mono">{formatDate(row.dueDate, 'en')}</td>
                          <td className="px-3 py-2 text-right font-mono-num font-bold">
                            {formatCurrency(row.amount, lang)}
                          </td>
                          <td className="px-3 py-2 text-right font-mono-num text-emerald-700">
                            {formatCurrency(row.paidAmount, lang)}
                          </td>
                          <td className="px-3 py-2 text-center">
                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                                row.status === 'paid'
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : row.status === 'overdue'
                                  ? 'bg-rose-100 text-rose-800'
                                  : row.status === 'partial'
                                  ? 'bg-sky-100 text-sky-800'
                                  : 'bg-amber-100 text-amber-800'
                              }`}
                            >
                              {row.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Payment Collection History & Immutable Reversal */}
              <div className="space-y-2">
                <h4 className="font-bold text-slate-800 flex items-center gap-1.5">
                  <History className="w-4 h-4 text-emerald-600" />
                  <span>Payment History ({detailPayments.length})</span>
                </h4>
                <div className="border border-slate-200 rounded-xl divide-y divide-slate-100">
                  {detailPayments.map(pmt => (
                    <div key={pmt.id} className="p-3 space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-bold font-mono text-slate-900">
                              {pmt.receiptNumber}
                            </span>
                            <span className="text-[11px] uppercase px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 font-semibold">
                              {pmt.paymentMethod}
                            </span>
                            {pmt.status === 'reversed' ? (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800">
                                REVERSED
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
                                POSTED
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-slate-500 mt-0.5">
                            Date: {formatDate(pmt.paymentDate, 'en')} · By: {pmt.collectedBy}
                            {pmt.accountName && ` · Account: ${pmt.accountName}`}
                          </div>
                          {pmt.remarks && (
                            <div className="text-[11px] text-slate-600 italic mt-0.5">
                              {pmt.remarks}
                            </div>
                          )}
                          {pmt.status === 'reversed' && pmt.reversalReason && (
                            <div className="text-[11px] text-rose-700 mt-0.5">
                              Reversed reason: {pmt.reversalReason}
                            </div>
                          )}
                        </div>

                        <div className="flex items-center gap-2">
                          <span
                            className={`font-bold font-mono-num text-sm ${
                              pmt.status === 'reversed'
                                ? 'line-through text-slate-400'
                                : 'text-emerald-700'
                            }`}
                          >
                            {formatCurrency(pmt.amount, lang)}
                          </span>

                          {pmt.status === 'posted' && (
                            <>
                              <button
                                type="button"
                                onClick={() =>
                                  printInstallmentPaymentReceipt({
                                    payment: pmt,
                                    agreement: detailAgreement,
                                    settings,
                                    activeBranch,
                                  })
                                }
                                title="Print Payment Receipt"
                                className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded border border-slate-200 cursor-pointer"
                              >
                                <Printer className="w-3.5 h-3.5" />
                              </button>
                              {canReverse && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setReversingPaymentId(pmt.id);
                                    setReversalReason('');
                                  }}
                                  title="Reverse / Correct Payment (Immutable Audit)"
                                  className="flex items-center gap-1 px-2 py-1 text-[11px] font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded cursor-pointer"
                                >
                                  <RotateCcw className="w-3 h-3" />
                                  <span>Reverse</span>
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      </div>

                      {reversingPaymentId === pmt.id && (
                        <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-lg flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                          <input
                            type="text"
                            value={reversalReason}
                            onChange={e => setReversalReason(e.target.value)}
                            placeholder="Reason for reversing this payment (required)..."
                            className="flex-1 p-1.5 border border-rose-300 rounded bg-white text-xs"
                          />
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => setReversingPaymentId(null)}
                              className="px-2.5 py-1 text-[11px] text-slate-600 hover:bg-white rounded cursor-pointer"
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              disabled={isReversing}
                              onClick={() => handleConfirmReverse(pmt.id)}
                              className="px-3 py-1 text-[11px] font-bold text-white bg-rose-600 hover:bg-rose-700 rounded cursor-pointer"
                            >
                              {isReversing ? 'Reversing...' : 'Confirm Reverse'}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}

                  {detailPayments.length === 0 && (
                    <div className="py-6 text-center text-slate-400 text-xs">
                      No installment payments collected yet.
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="px-5 py-3 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setSlipAgreement(detailAgreement)}
                className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-[#0B2A6B] bg-white border border-[#0B2A6B]/30 hover:bg-slate-100 rounded-lg cursor-pointer"
              >
                <Printer className="w-4 h-4" />
                <span>Customer Slip Preview / PDF</span>
              </button>

              <div className="flex items-center gap-2">
                {detailAgreement.remainingDue > 0 && canCollect && (
                  <button
                    type="button"
                    onClick={() => {
                      const ag = detailAgreement;
                      setDetailAgreementId(null);
                      handleOpenCollectPayment(ag);
                    }}
                    className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg cursor-pointer"
                  >
                    <CreditCard className="w-4 h-4" />
                    <span>Collect Payment</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setDetailAgreementId(null)}
                  className="px-4 py-2 text-xs font-semibold text-slate-700 bg-slate-200 hover:bg-slate-300 rounded-lg cursor-pointer"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* New Installment Sale / Convert Existing Due Modal */}
      {isNewModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/65 backdrop-blur-xs overflow-y-auto">
          <form
            onSubmit={handleSubmitNewAgreement}
            className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-3xl max-h-[94vh] flex flex-col overflow-hidden my-auto"
          >
            <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <CalendarClock className="w-5 h-5 text-[#0B2A6B]" />
                <div>
                  <h3 className="font-bold text-sm text-slate-900">
                    Create Installment Agreement (1–6 Months)
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    Record a new installment sale or attach a schedule to an existing due invoice.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsNewModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-4 text-xs">
              {/* Mode Switcher */}
              <div className="grid grid-cols-2 gap-2 p-1 bg-slate-100 rounded-xl">
                <button
                  type="button"
                  onClick={() => {
                    setNewMode('new_sale');
                    setCreateError(null);
                  }}
                  className={`py-2 px-3 rounded-lg font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                    newMode === 'new_sale'
                      ? 'bg-[#0B2A6B] text-white shadow-xs'
                      : 'text-slate-700 hover:text-slate-900'
                  }`}
                >
                  <ShoppingBag className="w-3.5 h-3.5" />
                  <span>New Installment Sale</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setNewMode('from_due_sale');
                    setCreateError(null);
                  }}
                  className={`py-2 px-3 rounded-lg font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                    newMode === 'from_due_sale'
                      ? 'bg-[#0B2A6B] text-white shadow-xs'
                      : 'text-slate-700 hover:text-slate-900'
                  }`}
                >
                  <FileText className="w-3.5 h-3.5" />
                  <span>Existing Due Invoice ({eligibleDueSales.length})</span>
                </button>
              </div>

              {createError && (
                <div className="p-2.5 bg-rose-50 border border-rose-200 text-rose-800 rounded-lg font-medium">
                  {createError}
                </div>
              )}

              {/* Customer Selection */}
              <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/60 space-y-2.5">
                <div className="flex items-center justify-between">
                  <label className="font-bold text-slate-800 flex items-center gap-1.5">
                    <Users className="w-3.5 h-3.5 text-[#0B2A6B]" />
                    <span>Customer *</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => setShowQuickCustomer(v => !v)}
                    className="flex items-center gap-1 text-[11px] font-bold text-[#0B2A6B] hover:underline cursor-pointer"
                  >
                    <UserPlus className="w-3.5 h-3.5" />
                    <span>{showQuickCustomer ? 'Cancel Quick Add' : '+ Quick Add Customer & KYC'}</span>
                  </button>
                </div>

                {showQuickCustomer ? (
                  <div className="p-3 bg-white border border-slate-200 rounded-xl space-y-2.5">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <input
                        type="text"
                        value={qcName}
                        onChange={e => setQcName(e.target.value)}
                        placeholder="Customer Full Name *"
                        className="p-2 border border-slate-200 rounded-lg"
                      />
                      <input
                        type="text"
                        value={qcMobile}
                        onChange={e => setQcMobile(e.target.value)}
                        placeholder="Mobile Number *"
                        className="p-2 border border-slate-200 rounded-lg font-mono"
                      />
                      <input
                        type="text"
                        value={qcAddress}
                        onChange={e => setQcAddress(e.target.value)}
                        placeholder="Address (Optional)"
                        className="p-2 border border-slate-200 rounded-lg"
                      />
                      <input
                        type="text"
                        value={qcNidNumber}
                        onChange={e => setQcNidNumber(e.target.value)}
                        placeholder="NID Number (Optional)"
                        className="p-2 border border-slate-200 rounded-lg font-mono"
                      />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1">
                      <label className="flex items-center gap-1.5 px-2.5 py-1.5 border border-dashed border-slate-300 rounded-lg cursor-pointer hover:bg-slate-50">
                        <ImagePlus className="w-3.5 h-3.5 text-[#0B2A6B]" />
                        <span className="truncate">{qcPhotoUrl ? 'Photo Attached ✓' : 'Customer Photo (Opt)'}</span>
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={e => handleKycImagePick(e.target.files?.[0], setQcPhotoUrl)}
                        />
                      </label>
                      <label className="flex items-center gap-1.5 px-2.5 py-1.5 border border-dashed border-slate-300 rounded-lg cursor-pointer hover:bg-slate-50">
                        <ImagePlus className="w-3.5 h-3.5 text-[#0B2A6B]" />
                        <span className="truncate">{qcNidFrontUrl ? 'NID Front ✓' : 'NID Front (Opt)'}</span>
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={e => handleKycImagePick(e.target.files?.[0], setQcNidFrontUrl)}
                        />
                      </label>
                      <label className="flex items-center gap-1.5 px-2.5 py-1.5 border border-dashed border-slate-300 rounded-lg cursor-pointer hover:bg-slate-50">
                        <ImagePlus className="w-3.5 h-3.5 text-[#0B2A6B]" />
                        <span className="truncate">{qcNidBackUrl ? 'NID Back ✓' : 'NID Back (Opt)'}</span>
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={e => handleKycImagePick(e.target.files?.[0], setQcNidBackUrl)}
                        />
                      </label>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                      <label className="flex items-center gap-1.5 text-[11px] text-slate-600 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={qcConsent}
                          onChange={e => setQcConsent(e.target.checked)}
                        />
                        <span>Customer consented to private KYC verification storage</span>
                      </label>
                      <button
                        type="button"
                        onClick={handleSaveQuickCustomer}
                        className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg cursor-pointer"
                      >
                        Save &amp; Select Customer
                      </button>
                    </div>
                  </div>
                ) : (
                  <select
                    value={selectedCustomerId}
                    onChange={e => {
                      setSelectedCustomerId(e.target.value);
                      setSelectedExistingSaleId('');
                    }}
                    className="w-full p-2 border border-slate-200 rounded-lg bg-white font-medium"
                  >
                    <option value="">-- Select Customer --</option>
                    {customers.map(c => (
                      <option key={c.id} value={c.id}>
                        {c.name} ({c.mobile}) {c.currentDue > 0 ? `· Existing Due ৳${c.currentDue}` : ''}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {newMode === 'from_due_sale' ? (
                <div className="p-3.5 rounded-xl border border-slate-200 space-y-2">
                  <label className="font-bold text-slate-800 block">
                    Select Unlinked Due Invoice *
                  </label>
                  <select
                    value={selectedExistingSaleId}
                    onChange={e => setSelectedExistingSaleId(e.target.value)}
                    className="w-full p-2 border border-slate-200 rounded-lg bg-white"
                  >
                    <option value="">-- Select Due Invoice --</option>
                    {eligibleDueSales.map(s => (
                      <option key={s.id} value={s.id}>
                        {s.invoiceNumber} · {s.customerName} · Total ৳{s.total} · Paid ৳{s.paid} · Due ৳{s.due}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                /* Product Picker & Cart Rows */
                <div className="p-3.5 rounded-xl border border-slate-200 space-y-3">
                  <label className="font-bold text-slate-800 block">
                    Select Products for Installment Sale *
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                    <select
                      value={pickerProductId}
                      onChange={e => {
                        setPickerProductId(e.target.value);
                        const prod = activeProducts.find(p => p.id === e.target.value);
                        setPickerVariantId(prod?.variants?.[0]?.id || '');
                      }}
                      className="sm:col-span-5 p-2 border border-slate-200 rounded-lg bg-white"
                    >
                      <option value="">-- Choose Product --</option>
                      {activeProducts.map(p => (
                        <option key={p.id} value={p.id}>
                          {p.name} (৳{p.salePrice} · Stock {getBranchStockForProduct(p.id)})
                        </option>
                      ))}
                    </select>

                    <select
                      value={pickerVariantId}
                      disabled={!selectedPickerProduct?.variants?.length}
                      onChange={e => setPickerVariantId(e.target.value)}
                      className="sm:col-span-4 p-2 border border-slate-200 rounded-lg bg-white disabled:bg-slate-100"
                    >
                      {!selectedPickerProduct?.variants?.length ? (
                        <option value="">Standard / No Variant</option>
                      ) : (
                        selectedPickerProduct.variants.map(v => (
                          <option key={v.id} value={v.id}>
                            {v.color} / {v.size} (৳{v.salePrice ?? selectedPickerProduct.salePrice} · Stock{' '}
                            {getBranchStockForProduct(selectedPickerProduct.id, v.id)})
                          </option>
                        ))
                      )}
                    </select>

                    <input
                      type="number"
                      min="1"
                      value={pickerQty}
                      onChange={e => setPickerQty(Math.max(1, Number(e.target.value) || 1))}
                      className="sm:col-span-1 p-2 border border-slate-200 rounded-lg text-center font-mono"
                    />

                    <button
                      type="button"
                      onClick={handleAddDraftItem}
                      disabled={!pickerProductId}
                      className="sm:col-span-2 px-3 py-2 bg-[#0B2A6B] hover:brightness-110 disabled:opacity-40 text-white font-bold rounded-lg cursor-pointer"
                    >
                      + Add
                    </button>
                  </div>

                  {draftItems.length > 0 && (
                    <div className="border border-slate-200 rounded-lg overflow-hidden">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-slate-50 border-b border-slate-200">
                          <tr>
                            <th className="px-2.5 py-1.5">Product</th>
                            <th className="px-2.5 py-1.5 text-center">Size/Color</th>
                            <th className="px-2.5 py-1.5 text-center">Qty</th>
                            <th className="px-2.5 py-1.5 text-right">Price</th>
                            <th className="px-2.5 py-1.5 text-right">Total</th>
                            <th className="px-2.5 py-1.5" />
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {draftItems.map(item => (
                            <tr key={item.rowKey}>
                              <td className="px-2.5 py-1.5 font-semibold">{item.productName}</td>
                              <td className="px-2.5 py-1.5 text-center text-slate-600">
                                {item.size} / {item.color}
                              </td>
                              <td className="px-2.5 py-1.5 text-center font-mono">{item.quantity}</td>
                              <td className="px-2.5 py-1.5 text-right font-mono-num">
                                ৳{item.unitPrice}
                              </td>
                              <td className="px-2.5 py-1.5 text-right font-mono-num font-bold">
                                ৳{roundMoney(item.unitPrice * item.quantity)}
                              </td>
                              <td className="px-2.5 py-1.5 text-right">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setDraftItems(prev => prev.filter(r => r.rowKey !== item.rowKey))
                                  }
                                  className="text-rose-500 hover:text-rose-700 cursor-pointer"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {/* Down Payment + 1-6 Months Duration + First Due Date */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
                {newMode === 'new_sale' && (
                  <>
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">
                        Down Payment (৳)
                      </label>
                      <input
                        type="number"
                        min="0"
                        max={draftTotals.totalPurchase || undefined}
                        value={downPayment}
                        onChange={e =>
                          setDownPayment(e.target.value === '' ? '' : Math.max(0, Number(e.target.value)))
                        }
                        className="w-full p-2 border border-slate-200 rounded-lg font-mono-num font-bold text-emerald-700"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">
                        Down Payment Account
                      </label>
                      <div className="flex gap-1">
                        <select
                          value={downPayMethod}
                          onChange={e => setDownPayMethod(e.target.value as PaymentMethod)}
                          className="w-24 p-2 border border-slate-200 rounded-lg bg-white capitalize"
                        >
                          <option value="cash">Cash</option>
                          <option value="bkash">bKash</option>
                          <option value="nagad">Nagad</option>
                          <option value="bank">Bank</option>
                        </select>
                        <select
                          value={downAccountId}
                          onChange={e => setDownAccountId(e.target.value)}
                          className="flex-1 p-2 border border-slate-200 rounded-lg bg-white"
                        >
                          {accounts.map(a => (
                            <option key={a.id} value={a.id}>
                              {a.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </>
                )}

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Duration (Max 6 Months) *
                  </label>
                  <select
                    value={durationMonths}
                    onChange={e =>
                      setDurationMonths(Number(e.target.value) as InstallmentDurationMonths)
                    }
                    className="w-full p-2 border border-slate-200 rounded-lg bg-white font-bold text-[#0B2A6B]"
                  >
                    {[1, 2, 3, 4, 5, 6].map(m => (
                      <option key={m} value={m}>
                        {m} Month{m > 1 ? 's' : ''}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    First Due Date *
                  </label>
                  <input
                    type="date"
                    required
                    value={firstDueDate}
                    onChange={e => setFirstDueDate(e.target.value)}
                    className="w-full p-2 border border-slate-200 rounded-lg"
                  />
                </div>
              </div>

              {/* Live Calculation Summary & Schedule Preview */}
              {draftTotals.balance > 0 && (
                <div className="p-3.5 rounded-xl bg-blue-50/70 border border-blue-200 space-y-2.5">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
                    <div className="bg-white p-2 rounded-lg border border-blue-100">
                      <span className="text-[10px] text-slate-500 block">Total Purchase</span>
                      <span className="font-bold font-mono-num text-slate-900">
                        {formatCurrency(draftTotals.totalPurchase, lang)}
                      </span>
                    </div>
                    <div className="bg-white p-2 rounded-lg border border-emerald-100">
                      <span className="text-[10px] text-emerald-700 block">Down Payment</span>
                      <span className="font-bold font-mono-num text-emerald-800">
                        {formatCurrency(draftTotals.downPaymentAmt, lang)}
                      </span>
                    </div>
                    <div className="bg-white p-2 rounded-lg border border-blue-200">
                      <span className="text-[10px] text-blue-700 block">Installment Balance</span>
                      <span className="font-bold font-mono-num text-blue-950">
                        {formatCurrency(draftTotals.balance, lang)}
                      </span>
                    </div>
                    <div className="bg-white p-2 rounded-lg border border-purple-200">
                      <span className="text-[10px] text-purple-700 block">Monthly Installment</span>
                      <span className="font-bold font-mono-num text-purple-900">
                        {formatCurrency(draftTotals.monthlyInstallment, lang)}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-1.5">
                    {draftTotals.schedule.map(row => (
                      <div
                        key={row.installmentNumber}
                        className="bg-white border border-blue-100 rounded-lg p-1.5 text-center"
                      >
                        <div className="text-[10px] font-bold text-[#0B2A6B]">{row.labelEn}</div>
                        <div className="text-[10px] text-slate-500">{formatDate(row.dueDate, 'en')}</div>
                        <div className="font-bold font-mono-num text-slate-900 mt-0.5">
                          ৳{row.amount}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Agreement Notes</label>
                <input
                  type="text"
                  value={agreementNote}
                  onChange={e => setAgreementNote(e.target.value)}
                  placeholder="Optional guarantor or special notes..."
                  className="w-full p-2 border border-slate-200 rounded-lg"
                />
              </div>
            </div>

            <div className="px-5 py-3 bg-slate-50 border-t border-slate-200 flex justify-end gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setIsNewModalOpen(false)}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-200 rounded-lg cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isCreatingAgreement || draftTotals.balance <= 0}
                className="px-5 py-2 text-xs font-bold text-white bg-[#0B2A6B] hover:brightness-110 disabled:opacity-50 rounded-lg shadow-xs cursor-pointer"
              >
                {isCreatingAgreement
                  ? 'Saving Agreement...'
                  : 'Create Agreement & Open Slip'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
