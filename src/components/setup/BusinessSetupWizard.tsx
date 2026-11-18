import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { BusinessType, BusinessSetupData } from '../../types';
import { APP_IDENTITY } from '../../config/appIdentity';
import {
  Store,
  Building2,
  User,
  Phone,
  Mail,
  MapPin,
  Calendar,
  Percent,
  Wallet,
  Sparkles,
  ArrowRight,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Plus,
  Trash2,
} from 'lucide-react';

interface BusinessSetupWizardProps {
  onCompleted?: () => void;
}

export const BusinessSetupWizard: React.FC<BusinessSetupWizardProps> = ({ onCompleted }) => {
  const { completeBusinessSetup, user } = useApp();

  const currentYear = new Date().getFullYear();

  // Step state
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3>(1);

  // Form Fields
  const [shopName, setShopName] = useState('');
  const [ownerName, setOwnerName] = useState(
    user?.user_metadata?.full_name || ''
  );
  const [businessType, setBusinessType] = useState<BusinessType>('general');
  const [phone, setPhone] = useState(user?.user_metadata?.phone || '');
  const [email, setEmail] = useState(user?.email || '');
  const [address, setAddress] = useState('');
  const [branchName, setBranchName] = useState('Main Branch');
  const [currency, setCurrency] = useState('BDT (৳)');
  const [financialYear, setFinancialYear] = useState(`${currentYear}-${currentYear + 1}`);
  const [vatTaxRate, setVatTaxRate] = useState<number>(0);

  // Optional initial accounts configured by Admin
  const [accountsList, setAccountsList] = useState<
    { name: string; accountType: 'cash' | 'bank' | 'mobile_bank'; accountNumber?: string; openingBalance: number }[]
  >([
    { name: 'Cash in Hand', accountType: 'cash', openingBalance: 0 },
    { name: 'Bank Account', accountType: 'bank', accountNumber: '', openingBalance: 0 },
    { name: 'bKash Merchant', accountType: 'mobile_bank', accountNumber: '', openingBalance: 0 },
  ]);

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const businessTypes: { id: BusinessType; title: string; desc: string }[] = [
    { id: 'general', title: 'General Retail', desc: 'Departmental, stationery, gifts & general goods' },
    { id: 'clothing', title: 'Clothing & Fashion', desc: 'Apparel, shoes, fabrics with size/color variants' },
    { id: 'grocery', title: 'Grocery & Super Shop', desc: 'Daily FMCG, packaged goods, batch & expiry' },
    { id: 'electronics', title: 'Electronics & Mobile', desc: 'Gadgets, appliances, IMEI & warranty tracking' },
    { id: 'pharmacy', title: 'Pharmacy', desc: 'Medicines, pharmaceuticals & expiry control' },
    { id: 'restaurant', title: 'Food & Restaurant', desc: 'Cafe, dining, quick service & takeout' },
  ];

  const handleNext = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (currentStep === 1) {
      if (!shopName.trim()) {
        setErrorMsg('Please enter your business / shop name.');
        return;
      }
      if (!ownerName.trim()) {
        setErrorMsg('Please enter the owner / administrator name.');
        return;
      }
      setCurrentStep(2);
    } else if (currentStep === 2) {
      if (!phone.trim()) {
        setErrorMsg('Please enter a valid business contact phone number.');
        return;
      }
      if (!address.trim()) {
        setErrorMsg('Please enter the primary business location / address.');
        return;
      }
      if (!branchName.trim()) {
        setErrorMsg('Please specify the primary branch name.');
        return;
      }
      setCurrentStep(3);
    }
  };

  const handleFinalSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setLoading(true);

    try {
      const cleanCurrency = currency.includes('BDT') || currency.includes('৳') ? '৳' : currency.split(' ')[0] || '৳';
      const setupPayload: BusinessSetupData = {
        shopName: shopName.trim(),
        ownerName: ownerName.trim(),
        businessType,
        phone: phone.trim(),
        email: email.trim() || undefined,
        address: address.trim(),
        branchName: branchName.trim() || 'Main Branch',
        currency: cleanCurrency,
        financialYear: financialYear.trim() || `${currentYear}-${currentYear + 1}`,
        vatTaxRate: Number(vatTaxRate) || 0,
        initialAccounts: accountsList.filter(a => a.name.trim().length > 0).map(a => ({
          name: a.name.trim(),
          accountType: a.accountType,
          accountNumber: a.accountNumber?.trim() || undefined,
          openingBalance: Number(a.openingBalance) || 0,
        })),
      };

      await completeBusinessSetup(setupPayload);
      if (onCompleted) onCompleted();
    } catch (err: any) {
      console.error('Setup submission failed:', err);
      setErrorMsg(err.message || 'Failed to complete business setup. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const addAccountRow = () => {
    setAccountsList(prev => [
      ...prev,
      { name: '', accountType: 'cash', openingBalance: 0 },
    ]);
  };

  const removeAccountRow = (index: number) => {
    setAccountsList(prev => prev.filter((_, idx) => idx !== index));
  };

  const inputBaseClass =
    'w-full pl-9 pr-3 py-2.5 text-xs sm:text-sm bg-[#F8FAFC] dark:bg-[#0E182E] border border-[#E2E8F0] dark:border-[#1F3158] rounded-[10px] focus:outline-none focus:ring-2 focus:ring-[#087F8C]/25 focus:border-[#087F8C] text-[#172033] dark:text-white placeholder:text-[#94A3B8] font-medium';

  return (
    <div className="min-h-screen bg-[#0B1428] relative flex items-center justify-center p-3 sm:p-6 overflow-y-auto">
      <div className="pointer-events-none fixed -top-24 -right-24 w-96 h-96 rounded-full bg-[#087F8C]/15 blur-3xl" />
      <div className="pointer-events-none fixed -bottom-24 -left-24 w-96 h-96 rounded-full bg-[#D6AD60]/10 blur-3xl" />

      <div className="relative w-full max-w-2xl bg-white dark:bg-[#101B35] rounded-[16px] shadow-2xl border border-[#E2E8F0] dark:border-[#1F3158] overflow-hidden my-auto adp-modal-enter">
        {/* Wizard Header Banner */}
        <div className="bg-gradient-to-r from-[#101B35] via-[#152447] to-[#0B1428] text-white p-6 sm:p-8 border-b border-[#D6AD60]/25">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2.5">
              <div className="w-11 h-11 rounded-[12px] bg-gradient-to-br from-[#D6AD60] to-[#B68936] text-[#0B1428] flex items-center justify-center shadow-md">
                <Store className="w-6 h-6 stroke-[2.2]" />
              </div>
              <div>
                <div className="text-xs font-bold tracking-tight text-white">{APP_IDENTITY.name}</div>
                <div className="text-[10px] text-[#D6AD60] font-medium">{APP_IDENTITY.subtitle}</div>
              </div>
            </div>
            <span className="text-xs font-semibold px-3 py-1 rounded-[8px] bg-white/10 border border-[#D6AD60]/30 text-[#D6AD60] tracking-wide uppercase">
              Step {currentStep} of 3
            </span>
          </div>
          <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight text-white">
            First-Time Business Setup
          </h1>
          <p className="text-xs sm:text-sm text-slate-300 mt-1">
            Configure your genuine business profile, branch, and financial accounts. No demo data.
          </p>

          {/* Stepper progress dots */}
          <div className="grid grid-cols-3 gap-2 mt-6">
            <div className={`h-1.5 rounded-full transition-all ${currentStep >= 1 ? 'bg-[#D6AD60]' : 'bg-white/15'}`} />
            <div className={`h-1.5 rounded-full transition-all ${currentStep >= 2 ? 'bg-[#D6AD60]' : 'bg-white/15'}`} />
            <div className={`h-1.5 rounded-full transition-all ${currentStep >= 3 ? 'bg-[#10B981]' : 'bg-white/15'}`} />
          </div>
        </div>

        {/* Wizard Content */}
        <div className="p-6 sm:p-8">
          {errorMsg && (
            <div className="p-3.5 mb-5 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-700/60 text-rose-800 dark:text-rose-200 text-xs sm:text-sm rounded-[10px] flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 text-[#F06464] shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* STEP 1: Business Identity & Category */}
          {currentStep === 1 && (
            <form onSubmit={handleNext} className="space-y-5">
              <div className="space-y-1">
                <h2 className="text-base font-bold text-[#172033] dark:text-white flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-[#087F8C] dark:text-[#D6AD60]" />
                  <span>Business Profile &amp; Owner</span>
                </h2>
                <p className="text-xs text-[#64748B] dark:text-slate-400">
                  Enter your official shop or company name and owner administrator details.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-bold text-[#172033] dark:text-slate-200 mb-1">
                    Business / Shop Name <span className="text-[#F06464]">*</span>
                  </label>
                  <div className="relative">
                    <Store className="w-4 h-4 text-[#64748B] dark:text-slate-400 absolute left-3 top-3" />
                    <input
                      type="text"
                      required
                      value={shopName}
                      onChange={e => setShopName(e.target.value)}
                      placeholder="e.g. Apex Footwear / Fresh Mart / Dhaka Electronics"
                      className={inputBaseClass}
                    />
                  </div>
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-xs font-bold text-[#172033] dark:text-slate-200 mb-1">
                    Owner / Administrator Name <span className="text-[#F06464]">*</span>
                  </label>
                  <div className="relative">
                    <User className="w-4 h-4 text-[#64748B] dark:text-slate-400 absolute left-3 top-3" />
                    <input
                      type="text"
                      required
                      value={ownerName}
                      onChange={e => setOwnerName(e.target.value)}
                      placeholder="e.g. Mohammad Rahman"
                      className={inputBaseClass}
                    />
                  </div>
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-xs font-bold text-[#172033] dark:text-slate-200 mb-2">
                    Primary Business Category <span className="text-[#F06464]">*</span>
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {businessTypes.map(bt => {
                      const isSelected = businessType === bt.id;
                      return (
                        <div
                          key={bt.id}
                          onClick={() => setBusinessType(bt.id)}
                          className={`p-3 rounded-[10px] border text-left cursor-pointer transition-all ${
                            isSelected
                              ? 'bg-[#087F8C]/10 dark:bg-[#087F8C]/20 border-[#087F8C] ring-2 ring-[#087F8C]/20'
                              : 'bg-white dark:bg-[#0E182E] border-[#E2E8F0] dark:border-[#1F3158] hover:border-slate-300 dark:hover:border-slate-600'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-[#172033] dark:text-white">{bt.title}</span>
                            {isSelected && <CheckCircle2 className="w-4 h-4 text-[#087F8C] dark:text-[#10B981]" />}
                          </div>
                          <p className="text-[11px] text-[#64748B] dark:text-slate-400 mt-1 leading-tight">{bt.desc}</p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="flex justify-end pt-4 border-t border-[#E2E8F0] dark:border-[#1F3158]">
                <button
                  type="submit"
                  className="flex items-center gap-2 px-6 py-2.5 bg-gradient-to-r from-[#087F8C] to-[#10B981] hover:brightness-110 text-white rounded-[10px] text-xs sm:text-sm font-bold shadow-md shadow-[#087F8C]/20 active:scale-[0.98] transition-all cursor-pointer"
                >
                  <span>Continue to Location</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </form>
          )}

          {/* STEP 2: Location, Contact & Branch */}
          {currentStep === 2 && (
            <form onSubmit={handleNext} className="space-y-5">
              <div className="space-y-1">
                <h2 className="text-base font-bold text-[#172033] dark:text-white flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-[#087F8C] dark:text-[#D6AD60]" />
                  <span>Contact Details &amp; Primary Branch</span>
                </h2>
                <p className="text-xs text-[#64748B] dark:text-slate-400">
                  Every business starts with at least one active branch or store outlet.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-[#172033] dark:text-slate-200 mb-1">
                    Phone Number <span className="text-[#F06464]">*</span>
                  </label>
                  <div className="relative">
                    <Phone className="w-4 h-4 text-[#64748B] dark:text-slate-400 absolute left-3 top-3" />
                    <input
                      type="text"
                      required
                      value={phone}
                      onChange={e => setPhone(e.target.value)}
                      placeholder="017xxxxxxxx"
                      className={`${inputBaseClass} font-mono`}
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-[#172033] dark:text-slate-200 mb-1">
                    Email Address <span className="text-[#64748B] dark:text-slate-400 font-normal">(Optional)</span>
                  </label>
                  <div className="relative">
                    <Mail className="w-4 h-4 text-[#64748B] dark:text-slate-400 absolute left-3 top-3" />
                    <input
                      type="email"
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      placeholder="business@example.com"
                      className={inputBaseClass}
                    />
                  </div>
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-xs font-bold text-[#172033] dark:text-slate-200 mb-1">
                    Business Address / Location <span className="text-[#F06464]">*</span>
                  </label>
                  <div className="relative">
                    <MapPin className="w-4 h-4 text-[#64748B] dark:text-slate-400 absolute left-3 top-3" />
                    <input
                      type="text"
                      required
                      value={address}
                      onChange={e => setAddress(e.target.value)}
                      placeholder="e.g. Shop 12, Ground Floor, City Center, Dhaka"
                      className={inputBaseClass}
                    />
                  </div>
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-xs font-bold text-[#172033] dark:text-slate-200 mb-1">
                    Primary Branch / Outlet Name <span className="text-[#F06464]">*</span>
                  </label>
                  <div className="relative">
                    <Building2 className="w-4 h-4 text-[#64748B] dark:text-slate-400 absolute left-3 top-3" />
                    <input
                      type="text"
                      required
                      value={branchName}
                      onChange={e => setBranchName(e.target.value)}
                      placeholder="e.g. Main Outlet / Dhanmondi Branch / Head Office"
                      className={inputBaseClass}
                    />
                  </div>
                  <p className="text-[11px] text-[#64748B] dark:text-slate-400 mt-1">
                    This will be configured as your primary outlet. You can add more branches later.
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-between pt-4 border-t border-[#E2E8F0] dark:border-[#1F3158]">
                <button
                  type="button"
                  onClick={() => setCurrentStep(1)}
                  className="px-4 py-2 border border-[#E2E8F0] dark:border-[#1F3158] text-[#172033] dark:text-slate-200 rounded-[10px] text-xs sm:text-sm font-semibold hover:bg-[#F8FAFC] dark:hover:bg-[#162344] cursor-pointer"
                >
                  Back
                </button>
                <button
                  type="submit"
                  className="flex items-center gap-2 px-6 py-2.5 bg-gradient-to-r from-[#087F8C] to-[#10B981] hover:brightness-110 text-white rounded-[10px] text-xs sm:text-sm font-bold shadow-md shadow-[#087F8C]/20 active:scale-[0.98] transition-all cursor-pointer"
                >
                  <span>Continue to Accounts</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </form>
          )}

          {/* STEP 3: Financial Settings & Initial Accounts */}
          {currentStep === 3 && (
            <form onSubmit={handleFinalSubmit} className="space-y-5">
              <div className="space-y-1">
                <h2 className="text-base font-bold text-[#172033] dark:text-white flex items-center gap-2">
                  <Wallet className="w-4 h-4 text-[#087F8C] dark:text-[#D6AD60]" />
                  <span>Financial Configuration &amp; Real Accounts</span>
                </h2>
                <p className="text-xs text-[#64748B] dark:text-slate-400">
                  Set currency, tax rates, and configure actual payment accounts (Cash, Bank, Mobile Wallets).
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-4 bg-[#F8FAFC] dark:bg-[#0E182E] rounded-[12px] border border-[#E2E8F0] dark:border-[#1F3158] text-xs">
                <div>
                  <label className="block font-bold text-[#172033] dark:text-slate-200 mb-1">Currency</label>
                  <select
                    value={currency}
                    onChange={e => setCurrency(e.target.value)}
                    className="w-full p-2 bg-white dark:bg-[#101B35] border border-[#E2E8F0] dark:border-[#1F3158] rounded-[8px] font-medium text-[#172033] dark:text-white"
                  >
                    <option value="BDT (৳)">BDT (৳)</option>
                    <option value="USD ($)">USD ($)</option>
                    <option value="EUR (€)">EUR (€)</option>
                    <option value="GBP (£)">GBP (£)</option>
                    <option value="INR (₹)">INR (₹)</option>
                  </select>
                </div>

                <div>
                  <label className="block font-bold text-[#172033] dark:text-slate-200 mb-1">Financial Year</label>
                  <div className="relative">
                    <Calendar className="w-3.5 h-3.5 text-[#64748B] dark:text-slate-400 absolute left-2.5 top-2.5" />
                    <input
                      type="text"
                      value={financialYear}
                      onChange={e => setFinancialYear(e.target.value)}
                      placeholder="2026-2027"
                      className="w-full pl-8 pr-2 p-2 bg-white dark:bg-[#101B35] border border-[#E2E8F0] dark:border-[#1F3158] rounded-[8px] font-mono text-[#172033] dark:text-white"
                    />
                  </div>
                </div>

                <div>
                  <label className="block font-bold text-[#172033] dark:text-slate-200 mb-1">Default VAT/Tax %</label>
                  <div className="relative">
                    <Percent className="w-3.5 h-3.5 text-[#64748B] dark:text-slate-400 absolute left-2.5 top-2.5" />
                    <input
                      type="number"
                      min="0"
                      max="100"
                      value={vatTaxRate}
                      onChange={e => setVatTaxRate(Number(e.target.value) || 0)}
                      placeholder="0"
                      className="w-full pl-8 pr-2 p-2 bg-white dark:bg-[#101B35] border border-[#E2E8F0] dark:border-[#1F3158] rounded-[8px] font-mono text-[#172033] dark:text-white"
                    />
                  </div>
                </div>
              </div>

              {/* Initial Accounts Setup Table */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <label className="block text-xs font-bold text-[#172033] dark:text-white">
                      Payment Accounts (Cash, Bank &amp; Mobile Banking)
                    </label>
                    <p className="text-[11px] text-[#64748B] dark:text-slate-400">
                      Configure your actual accounts with initial opening balances.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={addAccountRow}
                    className="flex items-center gap-1 text-xs font-semibold text-[#087F8C] dark:text-[#5EEAD4] bg-[#087F8C]/10 px-2.5 py-1 rounded-[8px] border border-[#087F8C]/25 transition-colors cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add Account</span>
                  </button>
                </div>

                <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                  {accountsList.map((acc, idx) => (
                    <div
                      key={idx}
                      className="p-3 bg-white dark:bg-[#0E182E] border border-[#E2E8F0] dark:border-[#1F3158] rounded-[10px] grid grid-cols-12 gap-2 items-center text-xs"
                    >
                      <div className="col-span-4">
                        <label className="text-[10px] text-[#64748B] dark:text-slate-400 block mb-0.5">Account Name</label>
                        <input
                          type="text"
                          required
                          value={acc.name}
                          onChange={e => {
                            const val = e.target.value;
                            setAccountsList(prev => prev.map((item, i) => i === idx ? { ...item, name: val } : item));
                          }}
                          placeholder="e.g. Cash in Hand"
                          className="w-full p-1.5 bg-[#F8FAFC] dark:bg-[#101B35] border border-[#E2E8F0] dark:border-[#1F3158] rounded-[8px] text-[#172033] dark:text-white"
                        />
                      </div>

                      <div className="col-span-3">
                        <label className="text-[10px] text-[#64748B] dark:text-slate-400 block mb-0.5">Type</label>
                        <select
                          value={acc.accountType}
                          onChange={e => {
                            const val = e.target.value as any;
                            setAccountsList(prev => prev.map((item, i) => i === idx ? { ...item, accountType: val } : item));
                          }}
                          className="w-full p-1.5 bg-[#F8FAFC] dark:bg-[#101B35] border border-[#E2E8F0] dark:border-[#1F3158] rounded-[8px] text-[#172033] dark:text-white"
                        >
                          <option value="cash">Cash</option>
                          <option value="bank">Bank</option>
                          <option value="mobile_bank">Mobile Bank</option>
                        </select>
                      </div>

                      <div className="col-span-3">
                        <label className="text-[10px] text-[#64748B] dark:text-slate-400 block mb-0.5">Opening Balance</label>
                        <input
                          type="number"
                          min="0"
                          value={acc.openingBalance}
                          onChange={e => {
                            const val = Number(e.target.value) || 0;
                            setAccountsList(prev => prev.map((item, i) => i === idx ? { ...item, openingBalance: val } : item));
                          }}
                          placeholder="0"
                          className="w-full p-1.5 bg-[#F8FAFC] dark:bg-[#101B35] border border-[#E2E8F0] dark:border-[#1F3158] rounded-[8px] font-mono text-right text-[#172033] dark:text-white"
                        />
                      </div>

                      <div className="col-span-2 text-right pt-4">
                        <button
                          type="button"
                          onClick={() => removeAccountRow(idx)}
                          className="p-1.5 text-slate-400 hover:text-[#F06464] hover:bg-rose-50 dark:hover:bg-rose-950/30 rounded-[8px] transition-colors cursor-pointer"
                          title="Remove Account"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}

                  {accountsList.length === 0 && (
                    <div className="p-4 text-center text-[#64748B] dark:text-slate-400 border-2 border-dashed border-[#E2E8F0] dark:border-[#1F3158] rounded-[10px] text-xs">
                      No accounts configured yet. Click &quot;+ Add Account&quot; to configure Cash or Bank accounts.
                    </div>
                  )}
                </div>
              </div>

              {/* Notice */}
              <div className="p-3 bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/50 rounded-[10px] text-emerald-900 dark:text-emerald-200 text-xs flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-[#10B981] shrink-0" />
                <span>
                  Your business will start clean with zero fake products, fake sales, or fake dues.
                </span>
              </div>

              <div className="flex items-center justify-between pt-4 border-t border-[#E2E8F0] dark:border-[#1F3158]">
                <button
                  type="button"
                  onClick={() => setCurrentStep(2)}
                  className="px-4 py-2 border border-[#E2E8F0] dark:border-[#1F3158] text-[#172033] dark:text-slate-200 rounded-[10px] text-xs sm:text-sm font-semibold hover:bg-[#F8FAFC] dark:hover:bg-[#162344] cursor-pointer"
                >
                  Back
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="flex items-center gap-2 px-7 py-2.5 bg-gradient-to-r from-[#087F8C] to-[#10B981] hover:brightness-110 text-white rounded-[10px] text-xs sm:text-sm font-bold shadow-lg shadow-[#087F8C]/25 active:scale-[0.98] transition-all cursor-pointer disabled:opacity-60"
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Configuring Business...</span>
                    </>
                  ) : (
                    <>
                      <span>Complete Setup &amp; Launch</span>
                      <CheckCircle2 className="w-4 h-4" />
                    </>
                  )}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
