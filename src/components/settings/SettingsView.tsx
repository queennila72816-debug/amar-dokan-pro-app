import React, { useEffect, useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { APP_IDENTITY } from '../../config/appIdentity';
import { isSupabaseConfigured } from '../../lib/supabase';
import {
  BusinessType,
  ExpenseAllocationMethod,
  InventoryCostingMethod,
  InvoicePaperSize,
  LabelTemplateId,
  PrinterSettings,
  UserRole,
} from '../../types';
import {
  getPrinterSettings,
  getShopLogo,
  savePrinterSettings,
  saveShopLogo,
} from '../../utils/printEngine';
import { isSalesmanOrCashierRole, normalizeRoleKey, roleKeyToLegacyUserRole } from '../../utils/rbacDefaults';
import {
  Settings,
  Save,
  Download,
  Upload,
  RotateCcw,
  Shield,
  CheckCircle2,
  Database,
  CloudUpload,
  Printer,
  Image as ImageIcon,
  Trash2,
  Info,
  Lock,
  Store,
  Plus,
  Edit3,
  ArrowRightLeft,
  RefreshCw,
  Wifi,
  WifiOff,
  SlidersHorizontal,
  AlertTriangle,
  X,
  Clock,
  Cloud,
  HardDrive,
} from 'lucide-react';

type SettingsSectionTab = 'all' | 'stores' | 'profile' | 'advanced' | 'sync';

interface EditStoreModalState {
  businessId: string;
  name: string;
  ownerName: string;
  tagline: string;
  address: string;
  phone: string;
  email: string;
  businessType: BusinessType;
  currency: string;
  vatTaxRate: number;
  vatRegistrationNo: string;
  invoiceFormat: InvoicePaperSize;
}

export const SettingsView: React.FC = () => {
  const {
    settings,
    updateSettings,
    backupData,
    restoreData,
    resetToDemoData,
    user,
    activeBusinessId,
    migrateLegacyData,
    isMigrated,
    isAdmin,
    isAuthenticatedAdmin,
    isPlatformAdmin,
    currentUserRole,
    setCurrentUserRole,
    roles,
    hasPermission,
    userBusinesses,
    activeMembership,
    switchBusiness,
    setCreateNewBusinessModalOpen,
    fetchBusinessRecord,
    updateBusinessStore,
    deleteBusinessStore,
    branches,
    products,
    customers,
    sales,
    activeSubscription,
    isSyncing,
    lastSyncAt,
    lastSyncError,
    autoSyncEnabled,
    setAutoSyncEnabled,
    isOnline,
    syncNow,
  } = useApp();

  const canEditSettings =
    (isAdmin || hasPermission('application_settings', 'edit')) &&
    !isSalesmanOrCashierRole(currentUserRole);

  const canManageStores =
    isAuthenticatedAdmin ||
    isPlatformAdmin ||
    activeMembership?.roleLevel === 'OWNER' ||
    activeMembership?.roleLevel === 'ADMIN';

  const [activeSection, setActiveSection] = useState<SettingsSectionTab>('all');

  // Active Store Profile & Invoice Form State
  const [shopName, setShopName] = useState(settings.shopName);
  const [ownerName, setOwnerName] = useState(settings.ownerName || '');
  const [tagline, setTagline] = useState(settings.tagline);
  const [address, setAddress] = useState(settings.address);
  const [mobile, setMobile] = useState(settings.mobile);
  const [email, setEmail] = useState(settings.email);
  const [logoUrl, setLogoUrl] = useState<string>(() => getShopLogo(settings, activeBusinessId));
  const [vatTaxRate, setVatTaxRate] = useState<number>(settings.vatTaxRate);
  const [vatRegistrationNo, setVatRegistrationNo] = useState<string>(settings.vatRegistrationNo || '');
  const [invoiceFormat, setInvoiceFormat] = useState<InvoicePaperSize>(settings.invoiceFormat || 'thermal');
  const [businessType, setBusinessType] = useState<BusinessType>(settings.businessType);
  const [currency, setCurrency] = useState<string>(settings.currency || 'BDT (৳)');
  const [financialYear, setFinancialYear] = useState<string>(
    settings.financialYear || `${new Date().getFullYear()}-${new Date().getFullYear() + 1}`
  );
  const [inventoryCostingMethod, setInventoryCostingMethod] = useState<InventoryCostingMethod>(
    settings.inventoryCostingMethod || 'fifo'
  );
  const [expenseAllocationMethod, setExpenseAllocationMethod] = useState<ExpenseAllocationMethod>(
    settings.expenseAllocationMethod || 'units_sold'
  );
  const [defaultExpectedMonthlyUnits, setDefaultExpectedMonthlyUnits] = useState<number>(
    settings.defaultExpectedMonthlyUnits ?? 300
  );
  const [defaultTargetMarginPercent, setDefaultTargetMarginPercent] = useState<number>(
    settings.defaultTargetMarginPercent ?? 25
  );
  const [strictDiscountProtection, setStrictDiscountProtection] = useState<boolean>(
    Boolean(settings.strictDiscountProtection)
  );
  const [adminAuthorizationPin, setAdminAuthorizationPin] = useState<string>(
    settings.adminAuthorizationPin || ''
  );

  const [printerSettings, setPrinterSettings] = useState<PrinterSettings>(() =>
    getPrinterSettings(settings)
  );

  // Feedback & Modal States
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [syncNotice, setSyncNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [editingStore, setEditingStore] = useState<EditStoreModalState | null>(null);
  const [loadingStoreEdit, setLoadingStoreEdit] = useState<string | null>(null);
  const [savingStoreEdit, setSavingStoreEdit] = useState(false);
  const [deleteTargetStore, setDeleteTargetStore] = useState<{
    businessId: string;
    businessName: string;
  } | null>(null);
  const [deleteConfirmInput, setDeleteConfirmInput] = useState('');
  const [deletingStore, setDeletingStore] = useState(false);
  const [confirmDemoResetOpen, setConfirmDemoResetOpen] = useState(false);

  const showFeedback = (tone: 'success' | 'error', text: string) => {
    setFeedback({ tone, text });
    setTimeout(() => {
      setFeedback(prev => (prev?.text === text ? null : prev));
    }, 4500);
  };

  useEffect(() => {
    setShopName(settings.shopName);
    setOwnerName(settings.ownerName || '');
    setTagline(settings.tagline);
    setAddress(settings.address);
    setMobile(settings.mobile);
    setEmail(settings.email);
    setLogoUrl(getShopLogo(settings, activeBusinessId));
    setVatTaxRate(settings.vatTaxRate);
    setVatRegistrationNo(settings.vatRegistrationNo || '');
    setInvoiceFormat(settings.invoiceFormat || 'thermal');
    setBusinessType(settings.businessType);
    setCurrency(settings.currency || 'BDT (৳)');
    setFinancialYear(
      settings.financialYear || `${new Date().getFullYear()}-${new Date().getFullYear() + 1}`
    );
    setInventoryCostingMethod(settings.inventoryCostingMethod || 'fifo');
    setExpenseAllocationMethod(settings.expenseAllocationMethod || 'units_sold');
    setDefaultExpectedMonthlyUnits(settings.defaultExpectedMonthlyUnits ?? 300);
    setDefaultTargetMarginPercent(settings.defaultTargetMarginPercent ?? 25);
    setStrictDiscountProtection(Boolean(settings.strictDiscountProtection));
    setAdminAuthorizationPin(settings.adminAuthorizationPin || '');
    setPrinterSettings(getPrinterSettings(settings));
  }, [settings, activeBusinessId]);

  const storesList = useMemo(() => {
    if (userBusinesses.length > 0) return userBusinesses;
    if (!activeBusinessId && !settings.shopName) return [];
    return [
      {
        businessId: activeBusinessId || 'local-store',
        businessName: settings.shopName || 'Current Store',
        businessType: settings.businessType || 'general',
        businessStatus: 'active',
        isActive: true,
        role: currentUserRole || 'owner',
        roleLevel: 'OWNER' as const,
        membershipStatus: 'active',
        planCode: activeSubscription?.planCode || 'free_trial',
        planName: activeSubscription?.plan?.name || 'Free Trial',
        subscriptionStatus: activeSubscription?.status || ('trialing' as const),
      },
    ];
  }, [userBusinesses, activeBusinessId, settings.shopName, settings.businessType, currentUserRole, activeSubscription]);

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!shopName.trim() || !mobile.trim() || !address.trim()) {
      showFeedback('error', 'Shop name, business phone, and address are required.');
      return;
    }
    const cleanVat = Number(vatTaxRate);
    if (!Number.isFinite(cleanVat) || cleanVat < 0 || cleanVat > 100) {
      showFeedback('error', 'VAT / Tax rate must be between 0% and 100%.');
      return;
    }

    const syncedPrinter: PrinterSettings = {
      ...printerSettings,
      invoicePaperSize: invoiceFormat,
    };
    savePrinterSettings(syncedPrinter);
    saveShopLogo(logoUrl, activeBusinessId);

    try {
      await updateSettings({
        shopName: shopName.trim(),
        ownerName: ownerName.trim(),
        tagline: tagline.trim(),
        address: address.trim(),
        mobile: mobile.trim(),
        email: email.trim(),
        logoUrl,
        vatTaxRate: cleanVat,
        vatRegistrationNo: vatRegistrationNo.trim(),
        invoiceFormat,
        businessType,
        currency: currency.trim() || 'BDT (৳)',
        financialYear: financialYear.trim(),
        inventoryCostingMethod,
        expenseAllocationMethod,
        defaultExpectedMonthlyUnits: Math.max(1, Number(defaultExpectedMonthlyUnits) || 300),
        defaultTargetMarginPercent: Math.max(0, Number(defaultTargetMarginPercent) || 0),
        strictDiscountProtection,
        adminAuthorizationPin: adminAuthorizationPin.trim(),
        printerSettings: syncedPrinter,
      });
      setPrinterSettings(syncedPrinter);
      showFeedback('success', 'Settings saved and synchronized.');
    } catch (err: any) {
      showFeedback('error', err?.message || 'Failed to save settings to database.');
    }
  };

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 1024 * 1024 * 2) {
      showFeedback('error', 'Please select a logo image smaller than 2MB.');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const maxDim = 240;
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          setLogoUrl(canvas.toDataURL('image/png', 0.9));
        } else if (typeof reader.result === 'string') {
          setLogoUrl(reader.result);
        }
      };
      if (typeof reader.result === 'string') {
        img.src = reader.result;
      }
    };
    reader.readAsDataURL(file);
  };

  const handleOpenEditStore = async (businessId: string) => {
    setLoadingStoreEdit(businessId);
    try {
      const record = await fetchBusinessRecord(businessId);
      setEditingStore({
        businessId,
        name: String(record?.name || ''),
        ownerName: String(record?.owner_name || ''),
        tagline: String(record?.tagline || ''),
        address: String(record?.address || ''),
        phone: String(record?.phone || ''),
        email: String(record?.email || ''),
        businessType: (record?.business_type as BusinessType) || 'general',
        currency: String(record?.currency || 'BDT (৳)'),
        vatTaxRate: Number(record?.vat_tax_rate || 0),
        vatRegistrationNo: String(record?.vat_registration_no || ''),
        invoiceFormat: (record?.invoice_format as InvoicePaperSize) || 'thermal',
      });
    } catch (err: any) {
      showFeedback('error', err?.message || 'Unable to load store details for editing.');
    } finally {
      setLoadingStoreEdit(null);
    }
  };

  const handleSaveEditedStore = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingStore) return;
    setSavingStoreEdit(true);
    try {
      await updateBusinessStore(editingStore.businessId, {
        name: editingStore.name,
        ownerName: editingStore.ownerName,
        tagline: editingStore.tagline,
        address: editingStore.address,
        phone: editingStore.phone,
        email: editingStore.email,
        businessType: editingStore.businessType,
        currency: editingStore.currency,
        vatTaxRate: editingStore.vatTaxRate,
        vatRegistrationNo: editingStore.vatRegistrationNo,
        invoiceFormat: editingStore.invoiceFormat,
      });
      setEditingStore(null);
      showFeedback('success', `Store "${editingStore.name.trim()}" updated successfully.`);
    } catch (err: any) {
      showFeedback('error', err?.message || 'Failed to update store.');
    } finally {
      setSavingStoreEdit(false);
    }
  };

  const handleConfirmDeleteStore = async () => {
    if (!deleteTargetStore) return;
    if (deleteConfirmInput.trim() !== deleteTargetStore.businessName.trim()) {
      showFeedback('error', 'Store name did not match. Deletion cancelled.');
      return;
    }
    setDeletingStore(true);
    try {
      const removedName = deleteTargetStore.businessName;
      await deleteBusinessStore(deleteTargetStore.businessId);
      setDeleteTargetStore(null);
      setDeleteConfirmInput('');
      showFeedback('success', `Store "${removedName}" has been removed.`);
    } catch (err: any) {
      showFeedback('error', err?.message || 'Unable to delete store.');
    } finally {
      setDeletingStore(false);
    }
  };

  const handleDownloadBackup = () => {
    const jsonStr = backupData();
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `amar-dokan-backup-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showFeedback('success', 'JSON backup downloaded.');
  };

  const handleRestoreFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (content) {
        const success = restoreData(content);
        if (success) {
          showFeedback('success', 'Backup restored successfully.');
        } else {
          showFeedback('error', 'Invalid backup JSON file.');
        }
      }
    };
    reader.readAsText(file);
  };

  const handleSyncNow = async () => {
    setSyncNotice(null);
    const res = await syncNow();
    setSyncNotice({
      tone: res.success ? 'success' : 'error',
      text: res.message,
    });
  };

  const formattedLastSync = useMemo(() => {
    if (!lastSyncAt) return 'Not synced yet in this session';
    try {
      return new Date(lastSyncAt).toLocaleString();
    } catch {
      return lastSyncAt;
    }
  }, [lastSyncAt]);

  const showStoresSection = activeSection === 'all' || activeSection === 'stores';
  const showProfileSection = activeSection === 'all' || activeSection === 'profile';
  const showAdvancedSection = activeSection === 'all' || activeSection === 'advanced';
  const showSyncSection = activeSection === 'all' || activeSection === 'sync';

  const normalizedRole = normalizeRoleKey(currentUserRole);

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Header & Section Filter Tabs */}
      <div className="bg-white dark:bg-[#101B35] rounded-xl border border-slate-200 dark:border-[#1F3158] p-4 sm:p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-white tracking-tight flex items-center gap-2.5">
              <span className="p-1.5 rounded-[8px] bg-[#087F8C]/15 text-[#087F8C]">
                <Settings className="w-5 h-5" />
              </span>
              <span>Settings &amp; Store Control Center</span>
            </h2>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
              Manage multi-store accounts, shop profile &amp; invoice headers, advanced operations, and cloud sync &amp; backups.
            </p>
          </div>

          {feedback && (
            <div
              className={`flex items-center gap-2 text-xs font-semibold px-3 py-2 rounded-lg border shrink-0 ${
                feedback.tone === 'success'
                  ? 'text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/30'
                  : 'text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-500/10 border-rose-200 dark:border-rose-500/30'
              }`}
            >
              {feedback.tone === 'success' ? (
                <CheckCircle2 className="w-4 h-4 shrink-0" />
              ) : (
                <AlertTriangle className="w-4 h-4 shrink-0" />
              )}
              <span>{feedback.text}</span>
            </div>
          )}
        </div>

        {/* Segmented Navigation Bar */}
        <div className="flex flex-wrap items-center gap-1.5 p-1 bg-slate-100 dark:bg-[#0B1428] rounded-xl border border-slate-200 dark:border-[#1F3158]">
          {[
            { id: 'all' as const, label: 'All Settings' },
            { id: 'stores' as const, label: 'Business & Stores' },
            { id: 'profile' as const, label: 'Store Profile & Invoice' },
            { id: 'advanced' as const, label: 'Advanced Settings' },
            { id: 'sync' as const, label: 'Cloud Sync & Backup' },
          ].map(tab => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveSection(tab.id)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
                activeSection === tab.id
                  ? 'bg-white dark:bg-[#162344] text-slate-900 dark:text-[#D6AD60] border border-slate-200 dark:border-[#D6AD60]/35'
                  : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* SECTION A: BUSINESS & STORE MANAGEMENT */}
      {showStoresSection && (
        <section className="bg-white dark:bg-[#101B35] rounded-xl border border-slate-200 dark:border-[#1F3158] p-5 space-y-5 text-xs">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-200 dark:border-[#1F3158]">
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Store className="w-4 h-4 text-[#D6AD60]" />
                <span>A. Business &amp; Store Management</span>
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                Switch active store, create additional shops, edit store details, or remove unused stores.
              </p>
            </div>

            {canManageStores && (
              <button
                type="button"
                onClick={() => setCreateNewBusinessModalOpen(true)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#087F8C] hover:bg-[#066974] text-white font-bold text-xs transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>Add New Store</span>
              </button>
            )}
          </div>

          {/* Active Store Information Summary */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 py-3 border-b border-slate-200 dark:border-[#1F3158]">
            <div>
              <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Active Store</div>
              <div className="text-sm font-bold text-slate-900 dark:text-white mt-0.5 truncate">
                {settings.shopName || 'Unconfigured Store'}
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 capitalize">
                {settings.businessType} · {branches.length} branch{branches.length === 1 ? '' : 'es'}
              </div>
            </div>

            <div>
              <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Owner &amp; Contact</div>
              <div className="text-sm font-semibold text-slate-900 dark:text-white mt-0.5 truncate">
                {settings.ownerName || user?.user_metadata?.full_name || 'Store Owner'}
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 font-mono-num truncate">
                {settings.mobile || 'No phone'}
              </div>
            </div>

            <div>
              <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Store Location &amp; Currency</div>
              <div className="text-xs font-semibold text-slate-800 dark:text-slate-200 mt-0.5 truncate">
                {settings.address || 'No address set'}
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 font-mono-num">
                {settings.currency || 'BDT (৳)'} · FY {settings.financialYear || `${new Date().getFullYear()}-${new Date().getFullYear() + 1}`}
              </div>
            </div>

            <div>
              <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Plan &amp; Business ID</div>
              <div className="text-sm font-bold text-[#087F8C] dark:text-[#D6AD60] mt-0.5">
                {activeSubscription?.plan?.name || activeMembership?.planName || 'Free Trial'}
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 font-mono truncate">
                {activeBusinessId || 'local-session'}
              </div>
            </div>
          </div>

          {/* Manage Stores Table */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200">
                Manage Stores ({storesList.length})
              </h4>
              <span className="text-[11px] text-slate-500 dark:text-slate-400">
                Active store switches workspace data immediately
              </span>
            </div>

            {storesList.length === 0 ? (
              <div className="py-8 text-center text-slate-500 dark:text-slate-400 border border-dashed border-slate-200 dark:border-[#1F3158] rounded-xl">
                <p className="font-semibold">No stores found in this account yet.</p>
                {canManageStores && (
                  <button
                    type="button"
                    onClick={() => setCreateNewBusinessModalOpen(true)}
                    className="mt-3 inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#087F8C] text-white font-semibold cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Create Your First Store</span>
                  </button>
                )}
              </div>
            ) : (
              <div className="overflow-x-auto border border-slate-200 dark:border-[#1F3158] rounded-xl">
                <table className="w-full text-left border-collapse min-w-[640px]">
                  <thead>
                    <tr className="bg-slate-50 dark:bg-[#0B1428] border-b border-slate-200 dark:border-[#1F3158] text-[11px] font-semibold text-slate-600 dark:text-slate-400">
                      <th className="py-2.5 px-3.5">Store Name</th>
                      <th className="py-2.5 px-3.5">Category &amp; Role</th>
                      <th className="py-2.5 px-3.5">Subscription &amp; Status</th>
                      <th className="py-2.5 px-3.5 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-[#1F3158]">
                    {storesList.map(store => {
                      const isCurrent = store.businessId === activeBusinessId || (!activeBusinessId && storesList.length === 1);
                      const ownerOrAdmin =
                        isPlatformAdmin ||
                        store.roleLevel === 'OWNER' ||
                        store.roleLevel === 'ADMIN' ||
                        store.role.toLowerCase() === 'owner' ||
                        store.role.toLowerCase() === 'admin';
                      const canDeleteThis = isSupabaseConfigured && ownerOrAdmin && storesList.length > 1;

                      return (
                        <tr
                          key={store.businessId}
                          className={`transition-colors ${
                            isCurrent
                              ? 'bg-[#087F8C]/5 dark:bg-[#087F8C]/10'
                              : 'hover:bg-slate-50 dark:hover:bg-[#162344]/60'
                          }`}
                        >
                          <td className="py-3 px-3.5">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-slate-900 dark:text-white">
                                {store.businessName}
                              </span>
                              {isCurrent && (
                                <span className="text-[11px] font-bold text-[#087F8C] dark:text-[#5EEAD4]">
                                  · Active
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 mt-0.5 truncate max-w-[230px]">
                              {store.businessId}
                            </div>
                          </td>

                          <td className="py-3 px-3.5 text-slate-700 dark:text-slate-300">
                            <span className="capitalize font-medium">{store.businessType}</span>
                            <span className="mx-1.5 text-slate-400">·</span>
                            <span className="font-semibold">{store.roleLevel || store.role}</span>
                          </td>

                          <td className="py-3 px-3.5 text-slate-700 dark:text-slate-300">
                            <span className="font-semibold">{store.planName || store.planCode || 'Free Trial'}</span>
                            <span className="mx-1.5 text-slate-400">·</span>
                            <span
                              className={`capitalize font-semibold ${
                                store.businessStatus === 'suspended'
                                  ? 'text-rose-600 dark:text-rose-400'
                                  : 'text-emerald-600 dark:text-emerald-400'
                              }`}
                            >
                              {store.businessStatus || 'active'}
                            </span>
                          </td>

                          <td className="py-3 px-3.5">
                            <div className="flex items-center justify-end gap-2">
                              {isCurrent ? (
                                <span className="px-2.5 py-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-500/30 font-semibold text-[11px] whitespace-nowrap">
                                  Active Store
                                </span>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => switchBusiness(store.businessId)}
                                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#101B35] hover:bg-[#1B2C52] text-white border border-slate-700 font-semibold text-[11px] transition-colors whitespace-nowrap cursor-pointer"
                                >
                                  <ArrowRightLeft className="w-3 h-3 text-[#D6AD60]" />
                                  <span>Switch Active Store</span>
                                </button>
                              )}

                              {ownerOrAdmin && (
                                <button
                                  type="button"
                                  onClick={() => handleOpenEditStore(store.businessId)}
                                  disabled={loadingStoreEdit === store.businessId}
                                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-100 dark:bg-[#162344] hover:bg-slate-200 dark:hover:bg-[#1F3158] text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-[#2A3F6D] font-semibold text-[11px] transition-colors whitespace-nowrap cursor-pointer disabled:opacity-60"
                                >
                                  <Edit3 className="w-3 h-3" />
                                  <span>{loadingStoreEdit === store.businessId ? 'Loading...' : 'Edit Store'}</span>
                                </button>
                              )}

                              {ownerOrAdmin && (
                                <button
                                  type="button"
                                  disabled={!canDeleteThis}
                                  title={
                                    !isSupabaseConfigured
                                      ? 'Store deletion requires Supabase cloud mode'
                                      : storesList.length <= 1
                                      ? 'At least one store must remain active'
                                      : `Delete ${store.businessName}`
                                  }
                                  onClick={() => {
                                    setDeleteTargetStore({
                                      businessId: store.businessId,
                                      businessName: store.businessName,
                                    });
                                    setDeleteConfirmInput('');
                                  }}
                                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-rose-50 dark:bg-rose-500/10 hover:bg-rose-100 dark:hover:bg-rose-500/20 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-500/30 font-semibold text-[11px] transition-colors whitespace-nowrap cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed"
                                >
                                  <Trash2 className="w-3 h-3" />
                                  <span>Delete</span>
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      )}

      {/* STORE PROFILE + ADVANCED CONFIGURATION FORM */}
      {(showProfileSection || showAdvancedSection) && (
        <form
          onSubmit={handleSaveSettings}
          className="bg-white dark:bg-[#101B35] rounded-xl border border-slate-200 dark:border-[#1F3158] p-5 space-y-6 text-xs"
        >
          {showProfileSection && (
            <div className="space-y-4">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white pb-2 border-b border-slate-200 dark:border-[#1F3158]">
                1. Active Store Profile &amp; Invoice Header
              </h3>

              {/* Fixed Software / Application Identity (Read-Only) */}
              <div className="p-3 bg-slate-50 dark:bg-[#0B1428] border border-slate-200 dark:border-[#1F3158] rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="flex items-start gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 flex items-center justify-center shrink-0 mt-0.5">
                    <Lock className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                        Application Identity (Fixed Software Brand · Read-Only)
                      </span>
                    </div>
                    <div className="text-sm font-bold text-slate-900 dark:text-white mt-0.5">
                      {APP_IDENTITY.name}
                      <span className="text-xs font-medium text-slate-500 dark:text-slate-400 ml-2">
                        · {APP_IDENTITY.subtitle}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                      Software branding stays permanently fixed and independent from your editable shop profile below.
                    </p>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Shop / Business Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={shopName}
                    onChange={(e) => setShopName(e.target.value)}
                    placeholder="e.g. Style Zone & Accessories"
                    className="w-full p-2.5 border border-slate-200 dark:border-[#1F3158] bg-white dark:bg-[#0B1428] text-slate-900 dark:text-white rounded-lg font-medium"
                  />
                </div>

                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Owner / Contact Person
                  </label>
                  <input
                    type="text"
                    value={ownerName}
                    onChange={(e) => setOwnerName(e.target.value)}
                    placeholder="e.g. Md. Rahman"
                    className="w-full p-2.5 border border-slate-200 dark:border-[#1F3158] bg-white dark:bg-[#0B1428] text-slate-900 dark:text-white rounded-lg"
                  />
                </div>

                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Business Tagline
                  </label>
                  <input
                    type="text"
                    value={tagline}
                    onChange={(e) => setTagline(e.target.value)}
                    placeholder="e.g. Quality Fashion & Lifestyle Store"
                    className="w-full p-2.5 border border-slate-200 dark:border-[#1F3158] bg-white dark:bg-[#0B1428] text-slate-900 dark:text-white rounded-lg"
                  />
                </div>

                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Business Phone *
                  </label>
                  <input
                    type="text"
                    required
                    value={mobile}
                    onChange={(e) => setMobile(e.target.value)}
                    className="w-full p-2.5 border border-slate-200 dark:border-[#1F3158] bg-white dark:bg-[#0B1428] text-slate-900 dark:text-white rounded-lg font-mono"
                  />
                </div>

                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Business Email
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full p-2.5 border border-slate-200 dark:border-[#1F3158] bg-white dark:bg-[#0B1428] text-slate-900 dark:text-white rounded-lg"
                  />
                </div>

                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Business Address *
                  </label>
                  <input
                    type="text"
                    required
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    className="w-full p-2.5 border border-slate-200 dark:border-[#1F3158] bg-white dark:bg-[#0B1428] text-slate-900 dark:text-white rounded-lg"
                  />
                </div>

                {/* Business Logo Upload / URL */}
                <div className="md:col-span-2 p-3.5 bg-slate-50 dark:bg-[#0B1428] border border-slate-200 dark:border-[#1F3158] rounded-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="w-14 h-14 rounded-lg bg-white dark:bg-[#101B35] border border-slate-200 dark:border-[#1F3158] flex items-center justify-center overflow-hidden shrink-0">
                      {logoUrl ? (
                        <img src={logoUrl} alt="Business Logo" className="max-w-full max-h-full object-contain" />
                      ) : (
                        <ImageIcon className="w-6 h-6 text-slate-300 dark:text-slate-600" />
                      )}
                    </div>
                    <div>
                      <div className="font-bold text-slate-800 dark:text-slate-100">
                        Business Logo (Dashboard, Invoices, Statements &amp; Labels)
                      </div>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        Upload your shop logo (PNG/JPG/WEBP) or clear for text-only business headers.
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="px-3 py-1.5 bg-white dark:bg-[#162344] hover:bg-slate-100 dark:hover:bg-[#1F3158] border border-slate-300 dark:border-[#2A3F6D] rounded-lg font-semibold text-slate-700 dark:text-slate-200 cursor-pointer">
                      Upload Logo
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/svg+xml"
                        onChange={handleLogoUpload}
                        className="hidden"
                      />
                    </label>
                    {logoUrl && (
                      <button
                        type="button"
                        onClick={() => setLogoUrl('')}
                        className="p-1.5 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-500/10 border border-rose-200 dark:border-rose-500/30 rounded-lg cursor-pointer"
                        title="Remove Logo"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* SECTION B: ADVANCED SETTINGS */}
          {showAdvancedSection && (
            <div className="space-y-5 pt-2">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-slate-200 dark:border-[#1F3158]">
                <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <SlidersHorizontal className="w-4 h-4 text-[#D6AD60]" />
                  <span>B. Advanced Settings &amp; Operational Controls</span>
                </h3>
                <span className="text-[11px] text-slate-500 dark:text-slate-400">
                  Interface mode, VAT, inventory costing, discount guardrails &amp; print calibration
                </span>
              </div>

              {/* Relocated Interface Mode Toggle (Easy Mode vs Advanced) */}
              <div className="p-4 rounded-xl bg-slate-50 dark:bg-[#0B1428] border border-slate-200 dark:border-[#1F3158] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <div className="font-bold text-slate-900 dark:text-white text-xs">
                    Workspace Interface Mode
                  </div>
                  <p className="text-[11px] text-slate-600 dark:text-slate-400 mt-0.5 max-w-xl">
                    Switch between <strong>Easy Mode</strong> (streamlined daily billing, stock &amp; customer dues) and <strong>Advanced</strong> (full inventory costing, multi-branch transfers, pricing calculator, combos &amp; audit analytics).
                  </p>
                </div>

                <div className="inline-flex items-center gap-1 p-1 rounded-xl bg-white dark:bg-[#101B35] border border-slate-200 dark:border-[#1F3158] shrink-0">
                  <button
                    type="button"
                    onClick={() => updateSettings({ uiMode: 'easy' })}
                    className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-colors whitespace-nowrap cursor-pointer ${
                      settings.uiMode === 'easy'
                        ? 'bg-[#D6AD60] text-[#0B1428]'
                        : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    Easy Mode
                  </button>
                  <button
                    type="button"
                    onClick={() => updateSettings({ uiMode: 'advanced' })}
                    className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-colors whitespace-nowrap cursor-pointer ${
                      settings.uiMode !== 'easy'
                        ? 'bg-[#087F8C] text-white'
                        : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    Advanced
                  </button>
                </div>
              </div>

              {/* POS, Tax & Category Configuration */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    VAT / Tax Rate (%)
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    value={vatTaxRate}
                    onChange={(e) => setVatTaxRate(Number(e.target.value) || 0)}
                    className="w-full p-2.5 border border-slate-200 dark:border-[#1F3158] bg-white dark:bg-[#0B1428] text-slate-900 dark:text-white rounded-lg font-mono-num"
                  />
                </div>

                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    VAT / Tax / BIN No.
                  </label>
                  <input
                    type="text"
                    value={vatRegistrationNo}
                    onChange={(e) => setVatRegistrationNo(e.target.value)}
                    placeholder="e.g. BIN-001234567-0101"
                    className="w-full p-2.5 border border-slate-200 dark:border-[#1F3158] bg-white dark:bg-[#0B1428] text-slate-900 dark:text-white rounded-lg font-mono"
                  />
                </div>

                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Default Invoice Paper Size
                  </label>
                  <select
                    aria-label="Invoice Format"
                    value={invoiceFormat}
                    onChange={(e) => {
                      const nextFmt = e.target.value as InvoicePaperSize;
                      setInvoiceFormat(nextFmt);
                      setPrinterSettings(prev => ({ ...prev, invoicePaperSize: nextFmt }));
                    }}
                    className="w-full p-2.5 border border-slate-200 dark:border-[#1F3158] bg-white dark:bg-[#0B1428] text-slate-900 dark:text-white rounded-lg"
                  >
                    <option value="thermal">Thermal Receipt (80mm)</option>
                    <option value="a5">A5 Half Page</option>
                    <option value="a4">A4 Full Invoice</option>
                  </select>
                </div>

                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Business Category
                  </label>
                  <select
                    aria-label="Business Category"
                    value={businessType}
                    onChange={(e) => setBusinessType(e.target.value as BusinessType)}
                    className="w-full p-2.5 border border-slate-200 dark:border-[#1F3158] bg-white dark:bg-[#0B1428] text-slate-900 dark:text-white rounded-lg"
                  >
                    <option value="clothing">Clothing</option>
                    <option value="grocery">Grocery</option>
                    <option value="electronics">Electronics</option>
                    <option value="pharmacy">Pharmacy</option>
                    <option value="restaurant">Food &amp; Restaurant</option>
                    <option value="general">General</option>
                  </select>
                </div>
              </div>

              {/* Costing, Margin & Authorization Rules */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Currency Format
                  </label>
                  <input
                    type="text"
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value)}
                    placeholder="BDT (৳)"
                    className="w-full p-2.5 border border-slate-200 dark:border-[#1F3158] bg-white dark:bg-[#0B1428] text-slate-900 dark:text-white rounded-lg"
                  />
                </div>

                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Financial Year
                  </label>
                  <input
                    type="text"
                    value={financialYear}
                    onChange={(e) => setFinancialYear(e.target.value)}
                    placeholder="2026-2027"
                    className="w-full p-2.5 border border-slate-200 dark:border-[#1F3158] bg-white dark:bg-[#0B1428] text-slate-900 dark:text-white rounded-lg font-mono-num"
                  />
                </div>

                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Inventory Costing Method
                  </label>
                  <select
                    value={inventoryCostingMethod}
                    onChange={(e) => setInventoryCostingMethod(e.target.value as InventoryCostingMethod)}
                    className="w-full p-2.5 border border-slate-200 dark:border-[#1F3158] bg-white dark:bg-[#0B1428] text-slate-900 dark:text-white rounded-lg"
                  >
                    <option value="fifo">FIFO (First-In, First-Out)</option>
                    <option value="weighted_average">Weighted Average Cost</option>
                  </select>
                </div>

                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Expense Allocation Rule
                  </label>
                  <select
                    value={expenseAllocationMethod}
                    onChange={(e) => setExpenseAllocationMethod(e.target.value as ExpenseAllocationMethod)}
                    className="w-full p-2.5 border border-slate-200 dark:border-[#1F3158] bg-white dark:bg-[#0B1428] text-slate-900 dark:text-white rounded-lg"
                  >
                    <option value="units_sold">By Units Sold</option>
                    <option value="revenue_percent">By Revenue Percentage</option>
                    <option value="category">By Category</option>
                    <option value="manual">Manual Allocation</option>
                  </select>
                </div>

                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Expected Monthly Units
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={defaultExpectedMonthlyUnits}
                    onChange={(e) => setDefaultExpectedMonthlyUnits(Math.max(1, Number(e.target.value) || 1))}
                    className="w-full p-2.5 border border-slate-200 dark:border-[#1F3158] bg-white dark:bg-[#0B1428] text-slate-900 dark:text-white rounded-lg font-mono-num"
                  />
                </div>

                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Default Target Margin (%)
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="200"
                    value={defaultTargetMarginPercent}
                    onChange={(e) => setDefaultTargetMarginPercent(Math.max(0, Number(e.target.value) || 0))}
                    className="w-full p-2.5 border border-slate-200 dark:border-[#1F3158] bg-white dark:bg-[#0B1428] text-slate-900 dark:text-white rounded-lg font-mono-num"
                  />
                </div>

                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Admin Authorization PIN (POS)
                  </label>
                  <input
                    type="password"
                    value={adminAuthorizationPin}
                    onChange={(e) => setAdminAuthorizationPin(e.target.value)}
                    placeholder="Default: 1234"
                    className="w-full p-2.5 border border-slate-200 dark:border-[#1F3158] bg-white dark:bg-[#0B1428] text-slate-900 dark:text-white rounded-lg font-mono"
                  />
                </div>

                <div className="flex items-end pb-1">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={strictDiscountProtection}
                      onChange={(e) => setStrictDiscountProtection(e.target.checked)}
                      className="w-4 h-4 rounded text-[#087F8C]"
                    />
                    <span className="font-medium text-slate-700 dark:text-slate-300">
                      Strict Below-Cost Discount Guard
                    </span>
                  </label>
                </div>
              </div>

              {/* Printer & Barcode Label Layout Settings */}
              <div className="pt-3 space-y-4">
                <div className="flex items-center justify-between pb-2 border-b border-slate-200 dark:border-[#1F3158]">
                  <h4 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                    <Printer className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                    <span>Printer &amp; Barcode Label Layout Settings</span>
                  </h4>
                  {!canEditSettings && (
                    <span className="text-[11px] text-amber-700 dark:text-amber-300 font-semibold">
                      Admin Only
                    </span>
                  )}
                </div>

                <fieldset disabled={!canEditSettings} className="space-y-4 disabled:opacity-60">
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
                    <div>
                      <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                        Invoice Orientation
                      </label>
                      <select
                        value={printerSettings.invoiceOrientation}
                        onChange={(e) =>
                          setPrinterSettings({
                            ...printerSettings,
                            invoiceOrientation: e.target.value as 'portrait' | 'landscape',
                          })
                        }
                        className="w-full p-2.5 border border-slate-200 dark:border-[#1F3158] bg-white dark:bg-[#0B1428] text-slate-900 dark:text-white rounded-lg"
                      >
                        <option value="portrait">Portrait</option>
                        <option value="landscape">Landscape</option>
                      </select>
                    </div>

                    <div>
                      <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                        Invoice Margin (mm)
                      </label>
                      <input
                        type="number"
                        min="0"
                        max="25"
                        value={printerSettings.invoiceMarginMm}
                        onChange={(e) =>
                          setPrinterSettings({
                            ...printerSettings,
                            invoiceMarginMm: Math.max(0, Math.min(25, Number(e.target.value) || 0)),
                          })
                        }
                        className="w-full p-2.5 border border-slate-200 dark:border-[#1F3158] bg-white dark:bg-[#0B1428] text-slate-900 dark:text-white rounded-lg font-mono-num"
                      />
                    </div>

                    <div>
                      <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                        Invoice Font Size
                      </label>
                      <select
                        value={printerSettings.invoiceFontSize}
                        onChange={(e) =>
                          setPrinterSettings({
                            ...printerSettings,
                            invoiceFontSize: e.target.value as 'small' | 'medium' | 'large',
                          })
                        }
                        className="w-full p-2.5 border border-slate-200 dark:border-[#1F3158] bg-white dark:bg-[#0B1428] text-slate-900 dark:text-white rounded-lg"
                      >
                        <option value="small">Small (Compact)</option>
                        <option value="medium">Medium (Standard)</option>
                        <option value="large">Large (Readable)</option>
                      </select>
                    </div>

                    <div>
                      <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                        Default Label Template
                      </label>
                      <select
                        value={printerSettings.labelTemplate}
                        onChange={(e) =>
                          setPrinterSettings({
                            ...printerSettings,
                            labelTemplate: e.target.value as LabelTemplateId,
                          })
                        }
                        className="w-full p-2.5 border border-slate-200 dark:border-[#1F3158] bg-white dark:bg-[#0B1428] text-slate-900 dark:text-white rounded-lg"
                      >
                        <option value="30x20">30 × 20 mm Roll</option>
                        <option value="40x30">40 × 30 mm Roll</option>
                        <option value="50x25">50 × 25 mm Roll</option>
                        <option value="50x30">50 × 30 mm Roll</option>
                        <option value="a4_sheet">A4 Multi-Label Sheet</option>
                        <option value="custom">Custom Size</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
                    <div>
                      <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                        Custom Label Width (mm)
                      </label>
                      <input
                        type="number"
                        min="20"
                        max="120"
                        value={printerSettings.labelWidthMm}
                        onChange={(e) =>
                          setPrinterSettings({
                            ...printerSettings,
                            labelWidthMm: Math.max(20, Math.min(120, Number(e.target.value) || 40)),
                          })
                        }
                        className="w-full p-2.5 border border-slate-200 dark:border-[#1F3158] bg-white dark:bg-[#0B1428] text-slate-900 dark:text-white rounded-lg font-mono-num"
                      />
                    </div>

                    <div>
                      <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                        Custom Label Height (mm)
                      </label>
                      <input
                        type="number"
                        min="15"
                        max="120"
                        value={printerSettings.labelHeightMm}
                        onChange={(e) =>
                          setPrinterSettings({
                            ...printerSettings,
                            labelHeightMm: Math.max(15, Math.min(120, Number(e.target.value) || 30)),
                          })
                        }
                        className="w-full p-2.5 border border-slate-200 dark:border-[#1F3158] bg-white dark:bg-[#0B1428] text-slate-900 dark:text-white rounded-lg font-mono-num"
                      />
                    </div>

                    <div>
                      <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                        Label Orientation
                      </label>
                      <select
                        value={printerSettings.labelOrientation}
                        onChange={(e) =>
                          setPrinterSettings({
                            ...printerSettings,
                            labelOrientation: e.target.value as 'portrait' | 'landscape',
                          })
                        }
                        className="w-full p-2.5 border border-slate-200 dark:border-[#1F3158] bg-white dark:bg-[#0B1428] text-slate-900 dark:text-white rounded-lg"
                      >
                        <option value="portrait">Portrait (Standard Roll)</option>
                        <option value="landscape">Landscape</option>
                      </select>
                    </div>

                    <div>
                      <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                        Label Margin (mm)
                      </label>
                      <input
                        type="number"
                        min="0"
                        max="20"
                        step="0.5"
                        value={printerSettings.labelMarginMm}
                        onChange={(e) =>
                          setPrinterSettings({
                            ...printerSettings,
                            labelMarginMm: Math.max(0, Math.min(20, Number(e.target.value) || 0)),
                          })
                        }
                        className="w-full p-2.5 border border-slate-200 dark:border-[#1F3158] bg-white dark:bg-[#0B1428] text-slate-900 dark:text-white rounded-lg font-mono-num"
                      />
                    </div>

                    <div>
                      <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                        A4 Labels Per Row
                      </label>
                      <input
                        type="number"
                        min="1"
                        max="6"
                        value={printerSettings.labelsPerRow}
                        onChange={(e) =>
                          setPrinterSettings({
                            ...printerSettings,
                            labelsPerRow: Math.max(1, Math.min(6, Number(e.target.value) || 3)),
                          })
                        }
                        className="w-full p-2.5 border border-slate-200 dark:border-[#1F3158] bg-white dark:bg-[#0B1428] text-slate-900 dark:text-white rounded-lg font-mono-num"
                      />
                    </div>

                    <div>
                      <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                        Gap Horizontal / Vertical (mm)
                      </label>
                      <div className="flex gap-1.5">
                        <input
                          type="number"
                          min="0"
                          max="15"
                          value={printerSettings.labelGapXMm}
                          onChange={(e) =>
                            setPrinterSettings({
                              ...printerSettings,
                              labelGapXMm: Number(e.target.value) || 0,
                            })
                          }
                          className="w-1/2 p-2.5 border border-slate-200 dark:border-[#1F3158] bg-white dark:bg-[#0B1428] text-slate-900 dark:text-white rounded-lg font-mono-num"
                          title="Horizontal gap (mm)"
                        />
                        <input
                          type="number"
                          min="0"
                          max="15"
                          value={printerSettings.labelGapYMm}
                          onChange={(e) =>
                            setPrinterSettings({
                              ...printerSettings,
                              labelGapYMm: Number(e.target.value) || 0,
                            })
                          }
                          className="w-1/2 p-2.5 border border-slate-200 dark:border-[#1F3158] bg-white dark:bg-[#0B1428] text-slate-900 dark:text-white rounded-lg font-mono-num"
                          title="Vertical gap (mm)"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                        Barcode Height (px)
                      </label>
                      <input
                        type="number"
                        min="14"
                        max="55"
                        value={printerSettings.barcodeHeightPx}
                        onChange={(e) =>
                          setPrinterSettings({
                            ...printerSettings,
                            barcodeHeightPx: Math.max(14, Math.min(55, Number(e.target.value) || 28)),
                          })
                        }
                        className="w-full p-2.5 border border-slate-200 dark:border-[#1F3158] bg-white dark:bg-[#0B1428] text-slate-900 dark:text-white rounded-lg font-mono-num"
                      />
                    </div>

                    <div>
                      <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                        Label Font Size
                      </label>
                      <select
                        value={printerSettings.labelFontSize}
                        onChange={(e) =>
                          setPrinterSettings({
                            ...printerSettings,
                            labelFontSize: e.target.value as 'small' | 'medium' | 'large',
                          })
                        }
                        className="w-full p-2.5 border border-slate-200 dark:border-[#1F3158] bg-white dark:bg-[#0B1428] text-slate-900 dark:text-white rounded-lg"
                      >
                        <option value="small">Small</option>
                        <option value="medium">Medium</option>
                        <option value="large">Large</option>
                      </select>
                    </div>
                  </div>

                  <label className="flex items-center gap-2 cursor-pointer pt-1">
                    <input
                      type="checkbox"
                      checked={printerSettings.showScaleGuidance}
                      onChange={(e) =>
                        setPrinterSettings({ ...printerSettings, showScaleGuidance: e.target.checked })
                      }
                      className="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500"
                    />
                    <span className="font-medium text-slate-700 dark:text-slate-300">
                      Show 100% Actual-Size / Margins: None / Save-as-PDF calibration guidance in Print Preview
                    </span>
                  </label>

                  <div className="p-3 bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/30 rounded-xl text-blue-900 dark:text-blue-200 text-[11px] flex items-start gap-2">
                    <Info className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
                    <span>
                      Thermal printers (80mm POS receipt or 30×20 / 40×30 / 50×25 / 50×30mm label printers) require matching paper dimensions configured in your OS printer driver preferences and <strong>Scale: 100%</strong> in the browser print dialog.
                    </span>
                  </div>
                </fieldset>
              </div>
            </div>
          )}

          <div className="flex justify-end pt-3 border-t border-slate-200 dark:border-[#1F3158]">
            <button
              type="submit"
              className="flex items-center gap-2 px-5 py-2.5 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors cursor-pointer"
            >
              <Save className="w-4 h-4" />
              <span>Save Changes</span>
            </button>
          </div>
        </form>
      )}

      {/* SECTION C: CLOUD SYNC & BACKUP */}
      {showSyncSection && (
        <section className="bg-white dark:bg-[#101B35] rounded-xl border border-slate-200 dark:border-[#1F3158] p-5 space-y-5 text-xs">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-200 dark:border-[#1F3158]">
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Database className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                <span>C. Cloud Sync &amp; Backup</span>
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                Monitor Supabase connection status, run manual cloud synchronization, toggle automatic sync, and manage JSON backups.
              </p>
            </div>

            {isSupabaseConfigured && (
              <button
                type="button"
                onClick={handleSyncNow}
                disabled={isSyncing || !isOnline}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#087F8C] hover:bg-[#066974] text-white font-bold text-xs transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
                <span>{isSyncing ? 'Syncing Cloud...' : 'Sync Now'}</span>
              </button>
            )}
          </div>

          {syncNotice && (
            <div
              className={`p-3 rounded-xl border text-xs font-semibold flex items-center gap-2 ${
                syncNotice.tone === 'success'
                  ? 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/30 text-emerald-800 dark:text-emerald-200'
                  : 'bg-rose-50 dark:bg-rose-500/10 border-rose-200 dark:border-rose-500/30 text-rose-800 dark:text-rose-200'
              }`}
            >
              {syncNotice.tone === 'success' ? (
                <CheckCircle2 className="w-4 h-4 shrink-0" />
              ) : (
                <AlertTriangle className="w-4 h-4 shrink-0" />
              )}
              <span>{syncNotice.text}</span>
            </div>
          )}

          {/* Connection, Sync Status & Last Sync Info */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 py-3 border-b border-slate-200 dark:border-[#1F3158]">
            <div>
              <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Connection Status</div>
              <div className="flex items-center gap-1.5 font-bold text-sm mt-1">
                {isOnline ? (
                  <>
                    <Wifi className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                    <span className="text-emerald-700 dark:text-emerald-300">Online</span>
                  </>
                ) : (
                  <>
                    <WifiOff className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0" />
                    <span className="text-rose-700 dark:text-rose-300">Offline</span>
                  </>
                )}
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                {isSupabaseConfigured ? 'Supabase Cloud Connected' : 'Local Browser Storage'}
              </div>
            </div>

            <div>
              <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Cloud Sync Status</div>
              <div className="flex items-center gap-1.5 font-bold text-sm mt-1">
                {isSupabaseConfigured ? (
                  <>
                    <Cloud className="w-4 h-4 text-[#087F8C] dark:text-[#5EEAD4] shrink-0" />
                    <span className="text-slate-900 dark:text-white">
                      {isSyncing ? 'Syncing Now...' : lastSyncError ? 'Sync Warning' : 'Cloud Synced'}
                    </span>
                  </>
                ) : (
                  <>
                    <HardDrive className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                    <span className="text-amber-700 dark:text-amber-300">Local Mode Only</span>
                  </>
                )}
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                {lastSyncError ? lastSyncError : user ? user.email : 'Local Browser Session'}
              </div>
            </div>

            <div>
              <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Last Sync Information</div>
              <div className="flex items-center gap-1.5 font-semibold text-slate-900 dark:text-white mt-1 font-mono-num">
                <Clock className="w-3.5 h-3.5 text-[#D6AD60] shrink-0" />
                <span className="truncate">{formattedLastSync}</span>
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 font-mono-num">
                {products.length} products · {sales.length} sales · {customers.length} customers
              </div>
            </div>

            <div>
              <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Automatic Sync</div>
              <div className="flex items-center justify-between gap-2 mt-1">
                <span className="font-bold text-slate-900 dark:text-white">
                  {autoSyncEnabled ? 'Enabled (Every 5m)' : 'Manual Only'}
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={autoSyncEnabled}
                  aria-label="Toggle automatic cloud sync"
                  onClick={() => setAutoSyncEnabled(!autoSyncEnabled)}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                    autoSyncEnabled ? 'bg-emerald-600' : 'bg-slate-300 dark:bg-slate-700'
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${
                      autoSyncEnabled ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                Auto-refresh multi-device changes
              </div>
            </div>
          </div>

          {!isSupabaseConfigured && (
            <div className="p-3 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-xl text-amber-900 dark:text-amber-200 space-y-1">
              <div className="font-bold">Temporary Local Browser Storage Mode Active</div>
              <p className="text-[11px] leading-relaxed">
                Supabase environment variables (<code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code>) are not configured. Data entered now is saved temporarily in this browser&apos;s localStorage until Supabase is connected.
              </p>
            </div>
          )}

          {/* Cloud Migration + Backup & Restore Actions */}
          <div className="space-y-3">
            <div>
              <h4 className="text-xs font-bold text-slate-900 dark:text-white">Backup, Restore &amp; Cloud Migration</h4>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                Download a full JSON backup of products, stock, sales, and accounts, restore from JSON, or migrate local records into Supabase.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3 pt-1">
              <button
                type="button"
                onClick={handleDownloadBackup}
                className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-900 dark:bg-[#162344] dark:hover:bg-[#1F3158] text-white rounded-lg font-semibold transition-colors cursor-pointer"
              >
                <Download className="w-4 h-4" />
                <span>Download Backup</span>
              </button>

              <label className="flex items-center gap-2 px-4 py-2 bg-slate-100 dark:bg-[#0B1428] hover:bg-slate-200 dark:hover:bg-[#162344] text-slate-800 dark:text-slate-200 rounded-lg font-semibold transition-colors border border-slate-200 dark:border-[#1F3158] cursor-pointer">
                <Upload className="w-4 h-4" />
                <span>Restore from JSON</span>
                <input
                  type="file"
                  accept=".json"
                  onChange={handleRestoreFile}
                  className="hidden"
                />
              </label>

              <button
                type="button"
                onClick={() => migrateLegacyData()}
                disabled={!isSupabaseConfigured || isMigrated}
                className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-semibold transition-colors disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
              >
                <CloudUpload className="w-4 h-4" />
                <span>
                  {!isSupabaseConfigured
                    ? 'Connect Supabase to Enable Cloud Sync'
                    : isMigrated
                    ? 'Local Store Migrated'
                    : 'Sync Local Store to Cloud Database'}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setConfirmDemoResetOpen(true)}
                className="flex items-center gap-2 px-4 py-2 bg-rose-50 dark:bg-rose-500/10 hover:bg-rose-100 dark:hover:bg-rose-500/20 text-rose-700 dark:text-rose-300 rounded-lg font-semibold transition-colors border border-rose-200 dark:border-rose-500/30 sm:ml-auto cursor-pointer"
              >
                <RotateCcw className="w-4 h-4" />
                <span>Reset to Demo Data</span>
              </button>
            </div>
          </div>
        </section>
      )}

      {/* Role & Permissions Guide */}
      {(activeSection === 'all' || activeSection === 'advanced') && (
        <div className="bg-white dark:bg-[#101B35] rounded-xl border border-slate-200 dark:border-[#1F3158] p-5 space-y-4 text-xs">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-slate-200 dark:border-[#1F3158]">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Shield className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              <span>Role &amp; Permissions Guide</span>
            </h3>
            {isAuthenticatedAdmin && (
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-slate-500 dark:text-slate-400">Preview Role:</span>
                <select
                  aria-label="Preview Role in Settings"
                  value={normalizedRole}
                  onChange={(e) => setCurrentUserRole(roleKeyToLegacyUserRole(e.target.value) as UserRole)}
                  className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-[#1F3158] bg-white dark:bg-[#0B1428] text-slate-900 dark:text-white font-semibold"
                >
                  {roles.map(r => (
                    <option key={r.id} value={r.roleKey}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="p-3.5 bg-slate-50 dark:bg-[#0B1428] rounded-lg border border-slate-200 dark:border-[#1F3158]">
              <span className="font-bold text-slate-900 dark:text-white block">Owner / Admin</span>
              <p className="text-slate-600 dark:text-slate-400 mt-1">
                Full access to all modules (Dashboard, Sales, Purchases, Profits, Store Management &amp; Backup).
              </p>
            </div>
            <div className="p-3.5 bg-slate-50 dark:bg-[#0B1428] rounded-lg border border-slate-200 dark:border-[#1F3158]">
              <span className="font-bold text-slate-900 dark:text-white block">Salesman / Cashier</span>
              <p className="text-slate-600 dark:text-slate-400 mt-1">
                Access to POS, Customers, and Invoices. Sensitive financial and report data is hidden.
              </p>
            </div>
            <div className="p-3.5 bg-slate-50 dark:bg-[#0B1428] rounded-lg border border-slate-200 dark:border-[#1F3158]">
              <span className="font-bold text-slate-900 dark:text-white block">Storekeeper / Inventory</span>
              <p className="text-slate-600 dark:text-slate-400 mt-1">
                Manage product catalog, stock adjustments, and inter-branch inventory transfers.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* EDIT STORE MODAL */}
      {editingStore && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#101B35] border border-slate-200 dark:border-[#1F3158] rounded-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto shadow-2xl">
            <div className="px-5 py-4 border-b border-slate-200 dark:border-[#1F3158] flex items-center justify-between">
              <div>
                <h4 className="text-sm font-bold text-slate-900 dark:text-white">Edit Store Information</h4>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 font-mono mt-0.5">
                  {editingStore.businessId}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditingStore(null)}
                className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-[#162344] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveEditedStore} className="p-5 space-y-3.5 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Store Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={editingStore.name}
                    onChange={(e) => setEditingStore({ ...editingStore, name: e.target.value })}
                    className="w-full p-2.5 rounded-lg border border-slate-200 dark:border-[#1F3158] bg-white dark:bg-[#0B1428] text-slate-900 dark:text-white"
                  />
                </div>

                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Owner Name
                  </label>
                  <input
                    type="text"
                    value={editingStore.ownerName}
                    onChange={(e) => setEditingStore({ ...editingStore, ownerName: e.target.value })}
                    className="w-full p-2.5 rounded-lg border border-slate-200 dark:border-[#1F3158] bg-white dark:bg-[#0B1428] text-slate-900 dark:text-white"
                  />
                </div>

                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Store Phone *
                  </label>
                  <input
                    type="text"
                    required
                    value={editingStore.phone}
                    onChange={(e) => setEditingStore({ ...editingStore, phone: e.target.value })}
                    className="w-full p-2.5 rounded-lg border border-slate-200 dark:border-[#1F3158] bg-white dark:bg-[#0B1428] text-slate-900 dark:text-white font-mono"
                  />
                </div>

                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Store Email
                  </label>
                  <input
                    type="email"
                    value={editingStore.email}
                    onChange={(e) => setEditingStore({ ...editingStore, email: e.target.value })}
                    className="w-full p-2.5 rounded-lg border border-slate-200 dark:border-[#1F3158] bg-white dark:bg-[#0B1428] text-slate-900 dark:text-white"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Store Address *
                  </label>
                  <input
                    type="text"
                    required
                    value={editingStore.address}
                    onChange={(e) => setEditingStore({ ...editingStore, address: e.target.value })}
                    className="w-full p-2.5 rounded-lg border border-slate-200 dark:border-[#1F3158] bg-white dark:bg-[#0B1428] text-slate-900 dark:text-white"
                  />
                </div>

                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Business Category
                  </label>
                  <select
                    value={editingStore.businessType}
                    onChange={(e) =>
                      setEditingStore({ ...editingStore, businessType: e.target.value as BusinessType })
                    }
                    className="w-full p-2.5 rounded-lg border border-slate-200 dark:border-[#1F3158] bg-white dark:bg-[#0B1428] text-slate-900 dark:text-white"
                  >
                    <option value="clothing">Clothing</option>
                    <option value="grocery">Grocery</option>
                    <option value="electronics">Electronics</option>
                    <option value="pharmacy">Pharmacy</option>
                    <option value="restaurant">Food &amp; Restaurant</option>
                    <option value="general">General</option>
                  </select>
                </div>

                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Currency
                  </label>
                  <input
                    type="text"
                    value={editingStore.currency}
                    onChange={(e) => setEditingStore({ ...editingStore, currency: e.target.value })}
                    className="w-full p-2.5 rounded-lg border border-slate-200 dark:border-[#1F3158] bg-white dark:bg-[#0B1428] text-slate-900 dark:text-white"
                  />
                </div>

                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    VAT Rate (%)
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    value={editingStore.vatTaxRate}
                    onChange={(e) =>
                      setEditingStore({ ...editingStore, vatTaxRate: Number(e.target.value) || 0 })
                    }
                    className="w-full p-2.5 rounded-lg border border-slate-200 dark:border-[#1F3158] bg-white dark:bg-[#0B1428] text-slate-900 dark:text-white font-mono-num"
                  />
                </div>

                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Invoice Format
                  </label>
                  <select
                    value={editingStore.invoiceFormat}
                    onChange={(e) =>
                      setEditingStore({
                        ...editingStore,
                        invoiceFormat: e.target.value as InvoicePaperSize,
                      })
                    }
                    className="w-full p-2.5 rounded-lg border border-slate-200 dark:border-[#1F3158] bg-white dark:bg-[#0B1428] text-slate-900 dark:text-white"
                  >
                    <option value="thermal">Thermal Receipt (80mm)</option>
                    <option value="a5">A5 Half Page</option>
                    <option value="a4">A4 Full Invoice</option>
                  </select>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200 dark:border-[#1F3158]">
                <button
                  type="button"
                  onClick={() => setEditingStore(null)}
                  className="px-4 py-2 rounded-lg border border-slate-200 dark:border-[#1F3158] text-slate-700 dark:text-slate-300 font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingStoreEdit}
                  className="px-4 py-2 rounded-lg bg-[#087F8C] hover:bg-[#066974] text-white font-bold cursor-pointer disabled:opacity-60"
                >
                  {savingStoreEdit ? 'Saving...' : 'Save Store Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* DELETE STORE CONFIRMATION MODAL */}
      {deleteTargetStore && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#101B35] border border-slate-200 dark:border-[#1F3158] rounded-2xl w-full max-w-md shadow-2xl p-5 space-y-4 text-xs">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-rose-500/15 text-rose-600 dark:text-rose-400 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-slate-900 dark:text-white">
                  Delete Store Permanently?
                </h4>
                <p className="text-slate-600 dark:text-slate-400 mt-1">
                  This will remove <strong>{deleteTargetStore.businessName}</strong> and its branches, inventory, sales, and records. Type the exact store name below to confirm.
                </p>
              </div>
            </div>

            <input
              type="text"
              value={deleteConfirmInput}
              onChange={(e) => setDeleteConfirmInput(e.target.value)}
              placeholder={deleteTargetStore.businessName}
              className="w-full p-2.5 rounded-lg border border-slate-200 dark:border-[#1F3158] bg-white dark:bg-[#0B1428] text-slate-900 dark:text-white font-medium"
            />

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  setDeleteTargetStore(null);
                  setDeleteConfirmInput('');
                }}
                className="px-4 py-2 rounded-lg border border-slate-200 dark:border-[#1F3158] text-slate-700 dark:text-slate-300 font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={
                  deletingStore ||
                  deleteConfirmInput.trim() !== deleteTargetStore.businessName.trim()
                }
                onClick={handleConfirmDeleteStore}
                className="px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-bold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {deletingStore ? 'Deleting...' : 'Delete Store'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* RESET DEMO DATA CONFIRMATION MODAL */}
      {confirmDemoResetOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#101B35] border border-slate-200 dark:border-[#1F3158] rounded-2xl w-full max-w-md shadow-2xl p-5 space-y-4 text-xs">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
                <RotateCcw className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-slate-900 dark:text-white">
                  Reset Local Workspace to Demo Data?
                </h4>
                <p className="text-slate-600 dark:text-slate-400 mt-1">
                  This restores the initial sample catalog and demo figures in local state. Export a JSON backup first if needed.
                </p>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setConfirmDemoResetOpen(false)}
                className="px-4 py-2 rounded-lg border border-slate-200 dark:border-[#1F3158] text-slate-700 dark:text-slate-300 font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  resetToDemoData();
                  setConfirmDemoResetOpen(false);
                  showFeedback('success', 'Demo data reset successfully.');
                }}
                className="px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-bold cursor-pointer"
              >
                Confirm Reset
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
