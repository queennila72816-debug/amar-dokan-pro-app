import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { Sale } from '../../types';
import { formatCurrency, formatDate, toBnNumber } from '../../utils/formatters';
import { InvoiceModal } from '../pos/InvoiceModal';
import { previewInvoice, printInvoice, PrintPreviewPayload } from '../../utils/printEngine';
import { PrintPreviewModal } from '../printing/PrintPreviewModal';
import {
  Receipt,
  Search,
  RotateCcw,
  Printer,
  X,
  FileText,
  Undo2,
  Eye,
  EyeOff,
  AlertTriangle,
  CheckCircle,
  History,
  ShieldCheck,
  Trash2,
} from 'lucide-react';

import { isSalesmanOrCashierRole } from '../../utils/rbacDefaults';

export const SalesHistoryView: React.FC = () => {
  const { sales, recordSaleReturn, quickRefundSale, voidSale, deleteSale, isAdmin, currentUserRole, user, sellers, employees, currentEmployee, branches, auditLogs, settings, hasPermission } = useApp();
  const isBn = false;
  const lang = settings.language;

  const isSeller = isSalesmanOrCashierRole(currentUserRole);
  const canPrintInvoice = hasPermission('invoice_printing', 'print');
  const canEditSale = hasPermission('sales_history', 'edit');
  const canDeleteSale = hasPermission('sales_history', 'delete');
  const sellerDisplayName = currentEmployee?.name || user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'Staff';

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'paid' | 'due' | 'partial' | 'returned' | 'voided'>('all');
  const [sellerFilter, setSellerFilter] = useState<string>('all');
  const [branchFilter, setBranchFilter] = useState<string>('all');
  const [dateFilter, setDateFilter] = useState<'all' | 'today' | 'yesterday' | 'week' | 'month'>('all');
  const [methodFilter, setMethodFilter] = useState<string>('all');
  const [selectedInvoice, setSelectedInvoice] = useState<Sale | null>(null);
  const [previewPayload, setPreviewPayload] = useState<PrintPreviewPayload | null>(null);
  const [printError, setPrintError] = useState<string | null>(null);

  // Delete Invoice Modal State
  const [saleToDelete, setSaleToDelete] = useState<Sale | null>(null);
  const [isDeletingSale, setIsDeletingSale] = useState(false);

  // Toggle to show/hide voided and returned transactions
  const [showVoided, setShowVoided] = useState<boolean>(true);

  // Quick Refund Modal State
  const [quickRefundTarget, setQuickRefundTarget] = useState<Sale | null>(null);
  const [quickRefundReason, setQuickRefundReason] = useState('Full Customer Refund');
  const [isProcessingRefund, setIsProcessingRefund] = useState(false);

  // Partial Sales Return Modal State
  const [returnSale, setReturnSale] = useState<Sale | null>(null);
  const [returnItemIdx, setReturnItemIdx] = useState<number>(0);
  const [returnQty, setReturnQty] = useState<number>(1);
  const [returnCondition, setReturnCondition] = useState<'sellable' | 'damaged'>('sellable');
  const [returnReason, setReturnReason] = useState('Product Exchange / Defective');
  const [refundType, setRefundType] = useState<'cash' | 'adjust_due'>('cash');
  const [actionError, setActionError] = useState<string | null>(null);

  // Audit Logs Modal
  const [showAuditLogsModal, setShowAuditLogsModal] = useState(false);

  // Filter sales based on role, search, status, seller/employee, date, branch, method
  const filteredSales = sales.filter(s => {
    // 1. Salesman/Cashier Role Restriction: See ONLY their own sales
    if (isSeller) {
      const isMine =
        (user?.id && s.sellerId === user.id) ||
        (currentEmployee?.id && s.employeeId === currentEmployee.id) ||
        (currentEmployee?.employeeCode && s.employeeCode === currentEmployee.employeeCode) ||
        s.employeeName === sellerDisplayName ||
        s.sellerName === sellerDisplayName ||
        s.servedBy === sellerDisplayName ||
        (user?.email && s.servedBy === user.email);
      if (!isMine) return false;
    } else {
      // 2. Staff/Employee Filter
      if (sellerFilter !== 'all') {
        const match =
          s.employeeId === sellerFilter ||
          s.employeeCode === sellerFilter ||
          s.employeeName === sellerFilter ||
          s.sellerId === sellerFilter ||
          s.sellerName === sellerFilter ||
          s.servedBy === sellerFilter;
        if (!match) return false;
      }
    }

    // 3. Branch Filter
    if (branchFilter !== 'all' && s.branchId !== branchFilter) {
      return false;
    }

    // 4. Payment Method Filter
    if (methodFilter !== 'all' && s.paymentMethod !== methodFilter) {
      return false;
    }

    // 5. Date Range Filter
    if (dateFilter !== 'all') {
      const saleTime = new Date(s.date).getTime();
      const now = new Date();
      if (dateFilter === 'today') {
        const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
        if (saleTime < start) return false;
      } else if (dateFilter === 'yesterday') {
        const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1).getTime();
        const end = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
        if (saleTime < start || saleTime >= end) return false;
      } else if (dateFilter === 'week') {
        const start = Date.now() - 7 * 86400000;
        if (saleTime < start) return false;
      } else if (dateFilter === 'month') {
        const start = Date.now() - 30 * 86400000;
        if (saleTime < start) return false;
      }
    }

    // 6. Voided & Returned Filter
    if (!showVoided && (s.status === 'returned' || s.status === 'voided')) {
      return false;
    }

    // 7. Text Search
    const matchSearch =
      s.invoiceNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.customerName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (s.customerMobile && s.customerMobile.includes(searchQuery)) ||
      (s.sellerName && s.sellerName.toLowerCase().includes(searchQuery.toLowerCase()));

    const matchStatus = statusFilter === 'all' || s.status === statusFilter;
    return matchSearch && matchStatus;
  });

  // Count voided / returned in current scope
  const voidedCount = filteredSales.filter(s => s.status === 'returned' || s.status === 'voided').length;

  const handleOpenQuickRefund = (sale: Sale) => {
    setActionError(null);
    setQuickRefundTarget(sale);
    setQuickRefundReason('Customer returned items and requested full refund');
  };

  const handleConfirmQuickRefund = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickRefundTarget || isProcessingRefund) return;
    setActionError(null);

    setIsProcessingRefund(true);
    try {
      const success = await quickRefundSale(quickRefundTarget.id, quickRefundReason);
      if (success) {
        setQuickRefundTarget(null);
      } else {
        setActionError('Could not complete refund. Already returned or voided.');
      }
    } catch (err: any) {
      setActionError(`Refund failed: ${err.message || 'Database error'}`);
    } finally {
      setIsProcessingRefund(false);
    }
  };

  const handleOpenReturnModal = (sale: Sale) => {
    setActionError(null);
    setReturnSale(sale);
    setReturnItemIdx(0);
    setReturnQty(1);
    setReturnCondition('sellable');
    setRefundType(sale.due > 0 ? 'adjust_due' : 'cash');
  };

  const handleSubmitReturn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!returnSale || returnQty <= 0 || isProcessingRefund) return;
    setActionError(null);

    const item = returnSale.items[returnItemIdx];
    if (!item) {
      setActionError('Please select a valid item to return.');
      return;
    }
    if (returnQty > item.quantity || returnQty < 1) {
      setActionError('Return quantity must be between 1 and purchased quantity!');
      return;
    }

    const effectiveUnitPrice =
      item.quantity > 0 && Number.isFinite(item.total)
        ? Math.round((item.total / item.quantity) * 100) / 100
        : item.unitPrice;
    const returnTxId = `sh-ret-${returnSale.id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    setIsProcessingRefund(true);
    try {
      await recordSaleReturn(
        returnSale.id,
        [
          {
            productId: item.productId,
            variantId: item.variantId,
            quantity: Number(returnQty),
            unitPrice: effectiveUnitPrice,
            reason: returnReason,
            condition: returnCondition,
          },
        ],
        refundType,
        returnTxId
      );

      setReturnSale(null);
    } catch (err: any) {
      setActionError(`Return failed: ${err.message || 'Database error'}`);
    } finally {
      setIsProcessingRefund(false);
    }
  };

  // Recent sales audit logs
  const salesAuditLogs = auditLogs.filter(l => l.entityType === 'sale');

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <Receipt className="w-5 h-5 text-emerald-600" />
            <span>{'Sales Records & Invoices'}</span>
          </h2>
          <p className="text-xs text-slate-600 mt-0.5">
            {`${sales.length} total sales invoices recorded · Quick Refund restores stock & accounts instantly`}
          </p>
        </div>

        {/* Audit Logs button */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowAuditLogsModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg border border-slate-200 transition-colors"
          >
            <History className="w-4 h-4 text-slate-600" />
            <span>{'Audit Logs'} ({toBnNumber(salesAuditLogs.length)})</span>
          </button>
        </div>
      </div>

      {(printError || actionError) && (
        <div className="bg-rose-50 border border-rose-200 text-rose-800 px-4 py-2.5 rounded-xl text-xs flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{printError || actionError}</span>
          </div>
          <button
            type="button"
            onClick={() => {
              setPrintError(null);
              setActionError(null);
            }}
            className="text-rose-600 hover:text-rose-800 font-bold"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Filter Bar with Multi-Filter Options */}
      <div className="bg-white rounded-xl border border-slate-200 p-3 shadow-xs space-y-2.5 text-xs">
        <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-2.5">
          {/* Search */}
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={'Search invoice #, customer, or seller...'}
              className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/20 bg-slate-50/50"
            />
          </div>

          {/* Toggle to show/hide voided/returned transactions */}
          <div className="flex items-center gap-2 justify-end">
            <button
              type="button"
              onClick={() => setShowVoided(prev => !prev)}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg border font-medium transition-all ${
                showVoided
                  ? 'bg-emerald-50 border-emerald-300 text-emerald-800'
                  : 'bg-slate-100 border-slate-200 text-slate-600 hover:bg-slate-200'
              }`}
              title={'Show or hide voided/refunded transactions'}
            >
              {showVoided ? (
                <Eye className="w-4 h-4 text-emerald-600" />
              ) : (
                <EyeOff className="w-4 h-4 text-slate-500" />
              )}
              <span>
                {showVoided ? 'Showing Voided & Returned' : 'Hiding Voided & Returned'}
              </span>
              {voidedCount > 0 && (
                <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${showVoided ? 'bg-emerald-200 text-emerald-900' : 'bg-slate-300 text-slate-700'}`}>
                  {toBnNumber(voidedCount)}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Filter Dropdowns Row */}
        <div className="flex items-center gap-2 flex-wrap pt-1 border-t border-slate-100">
          {/* Admin Employee / Seller Filter */}
          {!isSeller && (
            <select
              aria-label={'Filter by Staff Member'}
              value={sellerFilter}
              onChange={(e) => setSellerFilter(e.target.value)}
              className="py-1.5 px-2.5 border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-emerald-500 font-medium text-slate-700"
            >
              <option value="all">All Staff / Employees</option>
              {employees.map(emp => (
                <option key={emp.id} value={emp.id}>
                  {emp.employeeCode ? `${emp.employeeCode} · ` : ''}{emp.name}
                </option>
              ))}
              {sellers
                .filter(sl => !employees.some(e => e.userId === sl.id || e.username === sl.username))
                .map(s => (
                  <option key={s.id} value={s.id}>
                    {s.fullName} (@{s.username})
                  </option>
                ))}
            </select>
          )}

          {/* Date Filter */}
          <select
            aria-label={'Filter by Date'}
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value as any)}
            className="py-1.5 px-2.5 border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-emerald-500 font-medium text-slate-700"
          >
            <option value="all">All Dates</option>
            <option value="today">Today</option>
            <option value="yesterday">Yesterday</option>
            <option value="week">This Week</option>
            <option value="month">This Month</option>
          </select>

          {/* Branch Filter */}
          <select
            aria-label={'Filter by Branch'}
            value={branchFilter}
            onChange={(e) => setBranchFilter(e.target.value)}
            className="py-1.5 px-2.5 border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-emerald-500 font-medium text-slate-700"
          >
            <option value="all">All Branches</option>
            {branches.map(b => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>

          {/* Payment Method Filter */}
          <select
            aria-label={'Filter by Payment Method'}
            value={methodFilter}
            onChange={(e) => setMethodFilter(e.target.value)}
            className="py-1.5 px-2.5 border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-emerald-500 font-medium text-slate-700"
          >
            <option value="all">All Payment Methods</option>
            <option value="cash">Cash</option>
            <option value="bkash">bKash</option>
            <option value="nagad">Nagad</option>
            <option value="rocket">Rocket</option>
            <option value="bank">Bank</option>
            <option value="card">Card</option>
            <option value="due">Due</option>
          </select>

          {/* Status Filter */}
          <select
            aria-label={'Filter by status'}
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
            className="py-1.5 px-2.5 border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-emerald-500 font-medium text-slate-700"
          >
            <option value="all">{'All Status'}</option>
            <option value="paid">{'Paid'}</option>
            <option value="partial">{'Partial'}</option>
            <option value="due">{'Full Due'}</option>
            <option value="returned">{'Returned'}</option>
            <option value="voided">{'Voided'}</option>
          </select>

          {/* Reset Filters */}
          {(sellerFilter !== 'all' || branchFilter !== 'all' || dateFilter !== 'all' || methodFilter !== 'all' || statusFilter !== 'all' || searchQuery) && (
            <button
              onClick={() => {
                setSellerFilter('all');
                setBranchFilter('all');
                setDateFilter('all');
                setMethodFilter('all');
                setStatusFilter('all');
                setSearchQuery('');
              }}
              className="py-1.5 px-2.5 text-rose-600 hover:text-rose-700 hover:bg-rose-50 rounded-lg font-medium transition-colors"
            >
              Reset Filters
            </button>
          )}
        </div>
      </div>

      {/* Sales Invoices Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
              <tr>
                <th className="px-4 py-3 font-semibold">{'Invoice #'}</th>
                <th className="px-4 py-3 font-semibold">{'Date'}</th>
                <th className="px-4 py-3 font-semibold">{'Customer'}</th>
                {!isSeller && <th className="px-4 py-3 font-semibold">{'Seller'}</th>}
                <th className="px-4 py-3 font-semibold text-right">{'Total'}</th>
                <th className="px-4 py-3 font-semibold text-right">{'Paid'}</th>
                <th className="px-4 py-3 font-semibold text-right">{'Due'}</th>
                <th className="px-4 py-3 font-semibold">{'Method'}</th>
                <th className="px-4 py-3 font-semibold">{'Status'}</th>
                <th className="px-4 py-3 font-semibold text-right">{'Actions'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredSales.map(sale => {
                const isReturnedOrVoid = sale.status === 'returned' || sale.status === 'voided';

                return (
                  <tr
                    key={sale.id}
                    className={`transition-colors ${
                      isReturnedOrVoid
                        ? 'bg-rose-50/40 opacity-80 hover:bg-rose-50/60'
                        : 'hover:bg-slate-50/80'
                    }`}
                  >
                    <td className="px-4 py-3 font-mono font-bold text-slate-900">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className={isReturnedOrVoid ? 'line-through text-slate-500' : ''}>
                          {sale.invoiceNumber}
                        </span>
                        {((sale.comboPackages && sale.comboPackages.length > 0) || (sale.appliedOffers && sale.appliedOffers.length > 0)) && (
                          <span className="text-[10px] bg-emerald-50 text-emerald-700 border border-emerald-200 font-sans font-semibold px-1.5 py-0.2 rounded">
                            Combo
                          </span>
                        )}
                        {isReturnedOrVoid && (
                          <span className="text-[10px] bg-rose-100 text-rose-800 font-semibold px-1 rounded">
                            {sale.status === 'voided' ? ('Void') : ('Refund')}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-600 whitespace-nowrap">
                      {formatDate(sale.date, lang)}
                    </td>
                    <td className="px-4 py-3 text-slate-800">
                      <span className="font-semibold block">{sale.customerName}</span>
                      {sale.customerMobile && (
                        <span className="text-[10px] text-slate-500 font-mono">{sale.customerMobile}</span>
                      )}
                    </td>
                    {!isSeller && (
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-800 font-medium text-[11px] border border-slate-200">
                          {sale.employeeCode ? `${sale.employeeCode} · ` : ''}
                          {sale.employeeName || sale.sellerName || sale.servedBy || 'Staff'}
                        </span>
                      </td>
                    )}
                    <td className="px-4 py-3 text-right font-mono-num font-bold text-slate-900">
                      <span className={isReturnedOrVoid ? 'line-through text-slate-400' : ''}>
                        {formatCurrency(sale.total, lang)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-mono-num text-emerald-700 font-semibold">
                      {formatCurrency(sale.paid, lang)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono-num font-bold">
                      <span className={sale.due > 0 ? 'text-rose-700' : 'text-slate-400'}>
                        {sale.due > 0 ? formatCurrency(sale.due, lang) : '—'}
                      </span>
                    </td>
                    <td className="px-4 py-3 capitalize text-slate-700">
                      {sale.paymentMethod}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`text-[11px] font-semibold px-2 py-0.5 rounded-md ${
                          sale.status === 'paid'
                            ? 'bg-emerald-50 text-emerald-700'
                            : sale.status === 'due'
                            ? 'bg-rose-50 text-rose-700'
                            : sale.status === 'partial'
                            ? 'bg-amber-50 text-amber-700'
                            : sale.status === 'voided'
                            ? 'bg-slate-200 text-slate-700 line-through'
                            : 'bg-rose-100 text-rose-800'
                        }`}
                      >
                        {sale.status === 'paid'
                          ? ('Paid')
                          : sale.status === 'due'
                          ? ('Due')
                          : sale.status === 'partial'
                          ? ('Partial')
                          : sale.status === 'voided'
                          ? ('Voided')
                          : ('Returned')}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <div className="flex items-center justify-end gap-1.5">
                        {/* View Invoice */}
                        <button
                          onClick={() => setSelectedInvoice(sale)}
                          className="flex items-center gap-1 px-2 py-1 text-slate-700 bg-slate-100 hover:bg-slate-200 rounded font-medium transition-colors cursor-pointer"
                          title={'View Invoice Details'}
                        >
                          <FileText className="w-3.5 h-3.5" />
                          <span>{'View'}</span>
                        </button>

                        {/* Print Preview & Direct Print (guarded by invoice_printing permission) */}
                        {canPrintInvoice && (
                          <>
                            <button
                              onClick={() => {
                                setPrintError(null);
                                setPreviewPayload(previewInvoice(sale, settings));
                              }}
                              className="p-1 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded transition-colors cursor-pointer"
                              title={'Print Preview'}
                            >
                              <Eye className="w-3.5 h-3.5" />
                            </button>

                            <button
                              onClick={() => {
                                setPrintError(null);
                                const res = printInvoice(sale, settings);
                                if (!res.opened) {
                                  setPrintError(res.error || 'Could not open system print dialog.');
                                }
                              }}
                              className="flex items-center gap-1 px-2 py-1 text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded font-medium transition-colors cursor-pointer"
                              title={'Print Invoice Directly'}
                            >
                              <Printer className="w-3.5 h-3.5" />
                              <span>{'Print'}</span>
                            </button>
                          </>
                        )}

                        {/* Quick Refund Button */}
                        {!isReturnedOrVoid && canEditSale && (
                          <button
                            onClick={() => handleOpenQuickRefund(sale)}
                            className="flex items-center gap-1 px-2 py-1 text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded font-semibold transition-colors"
                            title={'Quick Refund Transaction'}
                          >
                            <Undo2 className="w-3.5 h-3.5 text-rose-600" />
                            <span>{'Refund'}</span>
                          </button>
                        )}

                        {/* Partial Return Button */}
                        {!isReturnedOrVoid && canEditSale && (
                          <button
                            onClick={() => handleOpenReturnModal(sale)}
                            className="p-1 text-amber-600 hover:text-amber-800 hover:bg-amber-50 rounded transition-colors"
                            title={'Item Return'}
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                          </button>
                        )}

                        {/* Granular Delete Permission Button */}
                        {(canDeleteSale || isAdmin) && (
                          <button
                            onClick={() => setSaleToDelete(sale)}
                            className="p-1 text-rose-500 hover:text-rose-700 hover:bg-rose-50 rounded transition-colors"
                            title={'Delete Invoice (Authorized Only)'}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}

              {filteredSales.length === 0 && (
                <tr>
                  <td colSpan={!isSeller ? 10 : 9} className="py-12 text-center text-slate-400 text-xs">
                    {'No sales records found.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Invoice Modal */}
      {selectedInvoice && (
        <InvoiceModal
          sale={selectedInvoice}
          onClose={() => setSelectedInvoice(null)}
          settings={settings}
        />
      )}

      {/* Direct Print Preview Modal */}
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

      {/* Quick Refund Confirmation Modal */}
      {quickRefundTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <form
            onSubmit={handleConfirmQuickRefund}
            className="bg-white rounded-2xl shadow-xl border border-slate-200 w-full max-w-md p-5 space-y-4"
          >
            <div className="flex items-center justify-between border-b pb-2">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-rose-100 flex items-center justify-center text-rose-600">
                  <Undo2 className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-slate-900">
                    {'Quick Refund Confirmation'}
                  </h3>
                  <span className="text-[11px] text-slate-500 font-mono">
                    {quickRefundTarget.invoiceNumber} · {quickRefundTarget.customerName}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setQuickRefundTarget(null)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Refund Overview Breakdown */}
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2 text-xs">
              <div className="flex justify-between text-slate-700">
                <span>{'Sale Total'}:</span>
                <span className="font-bold font-mono-num">{formatCurrency(quickRefundTarget.total, lang)}</span>
              </div>
              <div className="flex justify-between text-emerald-700 font-medium">
                <span>{'Cash/Bank to Refund'}:</span>
                <span className="font-bold font-mono-num">{formatCurrency(quickRefundTarget.paid, lang)}</span>
              </div>
              {quickRefundTarget.due > 0 && (
                <div className="flex justify-between text-rose-700 font-medium">
                  <span>{'Customer Due Adjusted'}:</span>
                  <span className="font-bold font-mono-num">-{formatCurrency(quickRefundTarget.due, lang)}</span>
                </div>
              )}
              <div className="border-t pt-2 text-[11px] text-slate-600">
                <span className="font-semibold block mb-1">{'Items to Restock:'}</span>
                <ul className="list-disc list-inside space-y-0.5 text-slate-700">
                  {quickRefundTarget.items.map((it, idx) => (
                    <li key={idx}>
                      {it.productName} — <strong className="font-mono-num">{toBnNumber(it.quantity)}</strong> pcs
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="space-y-1.5 text-xs">
              <label className="block font-medium text-slate-700">
                {'Refund Reason *'}
              </label>
              <input
                type="text"
                required
                value={quickRefundReason}
                onChange={(e) => setQuickRefundReason(e.target.value)}
                placeholder="Enter reason for refund..."
                className="w-full p-2 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-rose-500"
              />
            </div>

            <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-lg text-rose-800 text-[11px] flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 text-rose-600 mt-0.5" />
              <span>
                {'This action will instantly restore product stocks, adjust account balances, and update the audit log.'}
              </span>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t">
              <button
                type="button"
                disabled={isProcessingRefund}
                onClick={() => setQuickRefundTarget(null)}
                className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded-lg font-medium"
              >
                {'Cancel'}
              </button>
              <button
                type="submit"
                disabled={isProcessingRefund}
                className="px-4 py-1.5 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-lg flex items-center gap-1.5 shadow-xs transition-colors"
              >
                <Undo2 className="w-3.5 h-3.5" />
                <span>{isProcessingRefund ? ('Processing...') : ('Confirm Quick Refund')}</span>
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Partial Sales Return Modal */}
      {returnSale && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <form
            onSubmit={handleSubmitReturn}
            className="bg-white rounded-2xl shadow-xl border border-slate-200 w-full max-w-md p-5 space-y-4"
          >
            <div className="flex items-center justify-between border-b pb-2">
              <div>
                <h3 className="font-bold text-sm text-slate-900 flex items-center gap-1.5">
                  <RotateCcw className="w-4 h-4 text-amber-600" />
                  <span>{'Item Return'}</span>
                </h3>
                <span className="text-[11px] text-slate-500 font-mono">
                  {returnSale.invoiceNumber} · {returnSale.customerName}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setReturnSale(null)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-medium text-slate-700 mb-1">
                  {'Select Item *'}
                </label>
                <select
                  aria-label={'Select Item'}
                  value={returnItemIdx}
                  onChange={(e) => setReturnItemIdx(Number(e.target.value))}
                  className="w-full p-2 border border-slate-200 rounded-lg bg-white"
                >
                  {returnSale.items.map((item, idx) => {
                    const effectivePrice =
                      item.quantity > 0 && Number.isFinite(item.total)
                        ? Math.round((item.total / item.quantity) * 100) / 100
                        : item.unitPrice;
                    return (
                      <option key={idx} value={idx}>
                        {item.productName}{item.variantDetails ? ` (${item.variantDetails})` : ''}{item.comboOfferName ? ` [Combo: ${item.comboOfferName}]` : ''} — {item.quantity} pcs @ ৳{effectivePrice}
                      </option>
                    );
                  })}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    {'Return Quantity *'}
                  </label>
                  <input
                    type="number"
                    required
                    min="1"
                    max={returnSale.items[returnItemIdx]?.quantity || 1}
                    value={returnQty}
                    onChange={(e) => setReturnQty(Number(e.target.value) || 1)}
                    className="w-full p-2 border border-slate-200 rounded-lg font-mono-num"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    {'Item Condition *'}
                  </label>
                  <select
                    aria-label={'Item Condition'}
                    value={returnCondition}
                    onChange={(e) => setReturnCondition(e.target.value as 'sellable' | 'damaged')}
                    className="w-full p-2 border border-slate-200 rounded-lg bg-white"
                  >
                    <option value="sellable">Sellable (Restock)</option>
                    <option value="damaged">Damaged (Quarantine)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">
                  {'Refund Type *'}
                </label>
                <select
                  aria-label={'Refund Type'}
                  value={refundType}
                  onChange={(e) => setRefundType(e.target.value as any)}
                  className="w-full p-2 border border-slate-200 rounded-lg bg-white"
                >
                  <option value="cash">{'Cash Refund'}</option>
                  <option value="adjust_due">{'Adjust Customer Due'}</option>
                </select>
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">
                  {'Reason'}
                </label>
                <input
                  type="text"
                  value={returnReason}
                  onChange={(e) => setReturnReason(e.target.value)}
                  placeholder="e.g. Size change or defective item"
                  className="w-full p-2 border border-slate-200 rounded-lg"
                />
              </div>

              <div className="p-2.5 bg-amber-50 border border-amber-200 rounded-lg text-amber-800 text-[11px]">
                {returnCondition === 'sellable'
                  ? 'Confirming return will restore sellable product stock, refund net price, and log in audit trail.'
                  : 'Damaged items will be quarantined without inflating sellable stock, and refund will be issued.'}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t">
              <button
                type="button"
                disabled={isProcessingRefund}
                onClick={() => setReturnSale(null)}
                className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded-lg"
              >
                {'Cancel'}
              </button>
              <button
                type="submit"
                disabled={isProcessingRefund}
                className="px-4 py-1.5 text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-60 rounded-lg cursor-pointer"
              >
                {isProcessingRefund ? 'Processing...' : 'Confirm Return'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Audit Logs Modal */}
      {showAuditLogsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 w-full max-w-2xl p-5 space-y-4 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between border-b pb-2">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-emerald-600" />
                <h3 className="font-bold text-sm text-slate-900">
                  {'Sales & Refund Audit Logs'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowAuditLogsModal(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-2">
              {salesAuditLogs.map(log => (
                <div key={log.id} className="p-2.5 rounded-lg border border-slate-200 bg-slate-50/70 text-xs flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        log.action.includes('REFUND') || log.action.includes('VOID')
                          ? 'bg-rose-100 text-rose-800'
                          : 'bg-emerald-100 text-emerald-800'
                      }`}>
                        {log.action}
                      </span>
                      <span className="text-[10px] text-slate-500 font-mono">
                        {formatDate(log.date, lang)}
                      </span>
                    </div>
                    <p className="text-slate-800 font-medium">{log.details}</p>
                  </div>
                  <span className="text-[10px] bg-slate-200 text-slate-700 px-1.5 py-0.5 rounded font-mono uppercase">
                    {log.userRole}
                  </span>
                </div>
              ))}

              {salesAuditLogs.length === 0 && (
                <div className="py-8 text-center text-slate-400 text-xs">
                  {'No sales audit logs recorded yet.'}
                </div>
              )}
            </div>

            <div className="flex justify-end pt-2 border-t">
              <button
                type="button"
                onClick={() => setShowAuditLogsModal(false)}
                className="px-4 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg"
              >
                {'Close'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Invoice Confirmation Modal */}
      {saleToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl shadow-xl border border-rose-200 w-full max-w-md p-5 space-y-4">
            <div className="flex items-center justify-between border-b pb-2">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-rose-100 flex items-center justify-center text-rose-600">
                  <Trash2 className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-slate-900">
                    {'Delete Invoice?'}
                  </h3>
                  <span className="text-[11px] text-slate-500 font-mono">
                    {saleToDelete.invoiceNumber} · {saleToDelete.customerName}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSaleToDelete(null)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-2 text-xs text-slate-700">
              <p className="font-medium text-slate-800">
                {'Are you sure you want to delete this invoice? This action may affect stock, customer due, payments and reports.'}
              </p>
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl space-y-1 text-rose-900 text-[11px]">
                <div className="flex justify-between font-semibold">
                  <span>{'Total Amount'}:</span>
                  <span className="font-mono-num">{formatCurrency(saleToDelete.total, lang)}</span>
                </div>
                <div className="flex justify-between text-emerald-800">
                  <span>{'Paid amount to reverse'}:</span>
                  <span className="font-mono-num">{formatCurrency(saleToDelete.paid, lang)}</span>
                </div>
                {saleToDelete.due > 0 && (
                  <div className="flex justify-between text-rose-800">
                    <span>{'Due to reverse'}:</span>
                    <span className="font-mono-num">{formatCurrency(saleToDelete.due, lang)}</span>
                  </div>
                )}
                <p className="pt-1 text-rose-700 text-[10px]">
                  {'⚠ Sold items will be restocked to inventory and account balances reversed.'}
                </p>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t">
              <button
                type="button"
                disabled={isDeletingSale}
                onClick={() => setSaleToDelete(null)}
                className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded-lg font-medium"
              >
                {'Cancel'}
              </button>
              <button
                type="button"
                disabled={isDeletingSale}
                onClick={async () => {
                  setIsDeletingSale(true);
                  try {
                    await deleteSale(saleToDelete.id);
                    setSaleToDelete(null);
                  } catch (err: any) {
                    setActionError(`Failed to delete invoice: ${err.message || 'Database error'}`);
                    setSaleToDelete(null);
                  } finally {
                    setIsDeletingSale(false);
                  }
                }}
                className="px-4 py-1.5 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-lg flex items-center gap-1.5 shadow-xs transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{isDeletingSale ? ('Deleting...') : ('Delete Invoice')}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
