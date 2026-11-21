import React, { useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { BusinessType, BusinessSetupData, SubscriptionPlan } from '../../types';
import { APP_IDENTITY } from '../../config/appIdentity';
import { subscriptionService } from '../../services/subscriptionService';
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
  Crown,
  ShieldCheck,
  X,
} from 'lucide-react';

interface BusinessSetupWizardProps {
  onCompleted?: () => void;
  mode?: 'initial' | 'additional';
  onCancel?: () => void;
}

export const BusinessSetupWizard: React.FC<BusinessSetupWizardProps> = ({
  onCompleted,
  mode = 'initial',
  onCancel,
}) => {
  const { completeBusinessSetup, user, availablePlans } = useApp();

  const currentYear = new Date().getFullYear();

  // Step state (1: Profile, 2: Contact, Mobile OTP & Branch, 3: Accounts, 4: SaaS Plan)
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3 | 4>(1);

  // Form Fields
  const [shopName, setShopName] = useState(
    mode === 'additional' ? '' : user?.user_metadata?.shop_name || ''
  );
  const [ownerName, setOwnerName] = useState(user?.user_metadata?.full_name || '');
  const [businessType, setBusinessType] = useState<BusinessType>('general');
  const [phone, setPhone] = useState(user?.user_metadata?.phone || '');
  const [email, setEmail] = useState(user?.email || '');
  const [address, setAddress] = useState('');
  const [branchName, setBranchName] = useState('Main Branch');
  const [currency, setCurrency] = useState('BDT (৳)');
  const [financialYear, setFinancialYear] = useState(`${currentYear}-${currentYear + 1}`);
  const [vatTaxRate, setVatTaxRate] = useState<number>(0);

  // Mobile OTP verification state
  const [otpSending, setOtpSending] = useState(false);
  const [otpVerifying, setOtpVerifying] = useState(false);
  const [otpSentPhone, setOtpSentPhone] = useState('');
  const [otpCodeInput, setOtpCodeInput] = useState('');
  const [otpPreviewHint, setOtpPreviewHint] = useState<string | null>(null);
  const [mobileVerified, setMobileVerified] = useState(false);

  // Plan Selection State
  const [plans, setPlans] = useState<SubscriptionPlan[]>(availablePlans);
  const [selectedPlanCode, setSelectedPlanCode] = useState<string>('free_trial');
  const [billingCycle, setBillingCycle] = useState<'trial' | 'monthly' | 'yearly'>('trial');

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

  useEffect(() => {
    if (availablePlans.length > 0) {
      setPlans(availablePlans);
    } else {
      subscriptionService
        .fetchPlans()
        .then(res => {
          if (res.plans.length > 0) setPlans(res.plans);
        })
        .catch(() => {});
    }
  }, [availablePlans]);

  const businessTypes: { id: BusinessType; title: string; desc: string }[] = [
    { id: 'general', title: 'General Retail', desc: 'Departmental, stationery, gifts & general goods' },
    { id: 'clothing', title: 'Clothing & Fashion', desc: 'Apparel, shoes, fabrics with size/color variants' },
    { id: 'grocery', title: 'Grocery & Super Shop', desc: 'Daily FMCG, packaged goods, batch & expiry' },
    { id: 'electronics', title: 'Electronics & Mobile', desc: 'Gadgets, appliances, IMEI & warranty tracking' },
    { id: 'pharmacy', title: 'Pharmacy', desc: 'Medicines, pharmaceuticals & expiry control' },
    { id: 'restaurant', title: 'Food & Restaurant', desc: 'Cafe, dining, quick service & takeout' },
  ];

  const handleSendOtp = async () => {
    setErrorMsg(null);
    const cleaned = phone.replace(/[\s-]/g, '').trim();
    if (!/^\+?[0-9]{10,15}$/.test(cleaned)) {
      setErrorMsg('Please enter a valid 10-15 digit mobile number before requesting an OTP.');
      return;
    }
    setOtpSending(true);
    try {
      const res = await subscriptionService.sendMobileOtp(cleaned);
      setOtpSentPhone(cleaned);
      setMobileVerified(false);
      setOtpPreviewHint(res.previewCode ? `${res.message}` : res.message);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Unable to send OTP verification code.');
    } finally {
      setOtpSending(false);
    }
  };

  const handleVerifyOtp = async () => {
    setErrorMsg(null);
    const cleaned = phone.replace(/[\s-]/g, '').trim();
    if (!/^[0-9]{6}$/.test(otpCodeInput.trim())) {
      setErrorMsg('Please enter the 6-digit OTP verification code.');
      return;
    }
    setOtpVerifying(true);
    try {
      await subscriptionService.verifyMobileOtp(cleaned, otpCodeInput.trim());
      setMobileVerified(true);
      setOtpPreviewHint(null);
    } catch (err: any) {
      setErrorMsg(err?.message || 'OTP verification failed. Please check the code.');
    } finally {
      setOtpVerifying(false);
    }
  };

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
    } else if (currentStep === 3) {
      setCurrentStep(4);
    }
  };

  const handleFinalSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setErrorMsg(null);
    setLoading(true);

    try {
      const cleanCurrency = currency.includes('BDT') || currency.includes('৳') ? '৳' : currency.split(' ')[0] || '৳';
      const resolvedCycle =
        selectedPlanCode === 'free_trial'
          ? 'trial'
          : billingCycle === 'trial'
          ? 'monthly'
          : billingCycle;

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
        createNew: mode === 'additional',
        planCode: selectedPlanCode,
        billingCycle: resolvedCycle,
        initialAccounts: accountsList
          .filter(a => a.name.trim().length > 0)
          .map(a => ({
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
    setAccountsList(prev => [...prev, { name: '', accountType: 'cash', openingBalance: 0 }]);
  };

  const removeAccountRow = (index: number) => {
    setAccountsList(prev => prev.filter((_, idx) => idx !== index));
  };

  const inputBaseClass =
    'w-full pl-9 pr-3 py-2.5 text-xs sm:text-sm bg-[#F8FAFC] dark:bg-[#0E182E] border border-[#E2E8F0] dark:border-[#1F3158] rounded-[10px] focus:outline-none focus:ring-2 focus:ring-[#087F8C]/25 focus:border-[#087F8C] text-[#172033] dark:text-white placeholder:text-[#94A3B8] font-medium';

  return (
    <div
      className={`${
        mode === 'additional' ? 'fixed inset-0 z-50 bg-[#0A122C]/80 backdrop-blur-xs' : 'min-h-screen bg-[#0A122C]'
      } relative flex items-center justify-center p-3 sm:p-6 overflow-y-auto`}
    >
      {mode === 'initial' && (
        <>
          <div className="pointer-events-none fixed -top-24 -right-24 w-96 h-96 rounded-full bg-[#243B70]/35 blur-3xl" />
          <div className="pointer-events-none fixed -bottom-24 -left-24 w-96 h-96 rounded-full bg-[#FF9D32]/15 blur-3xl" />
        </>
      )}

      <div className="relative w-full max-w-2xl bg-white dark:bg-[#101B3F] rounded-[16px] shadow-2xl border border-[#E2E8F0] dark:border-[#243B70] overflow-hidden my-auto adp-modal-enter">
        {/* Wizard Header Banner */}
        <div className="bg-[#101B3F] bg-gradient-to-r from-[#101B3F] via-[#1B2F63] to-[#243B70] text-white p-6 sm:p-7 border-b border-[#FF9D32]/30">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-[12px] bg-white p-1 flex items-center justify-center shadow-md shrink-0">
                <img
                  src={APP_IDENTITY.symbolPath}
                  alt={APP_IDENTITY.name}
                  className="w-full h-full object-contain"
                />
              </div>
              <div>
                <div className="text-sm font-extrabold tracking-tight text-white">{APP_IDENTITY.name}</div>
                <div className="text-[10.5px] text-[#FF9D32] font-medium">{APP_IDENTITY.subtitle}</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold px-3 py-1 rounded-[8px] bg-white/10 border border-[#FF9D32]/40 text-[#FF9D32] tracking-wide uppercase">
                Step {currentStep} of 4
              </span>
              {mode === 'additional' && onCancel && (
                <button
                  type="button"
                  onClick={onCancel}
                  aria-label="Close new business wizard"
                  className="p-1.5 rounded-[8px] bg-white/10 hover:bg-white/20 text-white cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
          <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight text-white">
            {mode === 'additional' ? 'Create New Business Workspace' : 'Business Onboarding & Setup'}
          </h1>
          <p className="text-xs sm:text-sm text-slate-300 mt-1">
            Configure your isolated tenant workspace, verify contact number, and choose a SaaS plan.
          </p>

          {/* Stepper progress bars */}
          <div className="grid grid-cols-4 gap-2 mt-5">
            <div className={`h-1.5 rounded-full transition-all ${currentStep >= 1 ? 'bg-[#FF9D32]' : 'bg-white/15'}`} />
            <div className={`h-1.5 rounded-full transition-all ${currentStep >= 2 ? 'bg-[#FF9D32]' : 'bg-white/15'}`} />
            <div className={`h-1.5 rounded-full transition-all ${currentStep >= 3 ? 'bg-[#FF9D32]' : 'bg-white/15'}`} />
            <div className={`h-1.5 rounded-full transition-all ${currentStep >= 4 ? 'bg-[#10B981]' : 'bg-white/15'}`} />
          </div>
        </div>

        {/* Wizard Content */}
        <div className="p-6 sm:p-7">
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
                  className="flex items-center gap-2 px-6 py-2.5 bg-[#087F8C] bg-gradient-to-r from-[#087F8C] to-[#10B981] hover:brightness-110 text-white rounded-[10px] text-xs sm:text-sm font-bold shadow-md shadow-[#087F8C]/20 active:scale-[0.98] transition-all cursor-pointer"
                >
                  <span>Continue to Contact &amp; Verification</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </form>
          )}

          {/* STEP 2: Location, Contact, Mobile OTP & Primary Branch */}
          {currentStep === 2 && (
            <form onSubmit={handleNext} className="space-y-4">
              <div className="space-y-1">
                <h2 className="text-base font-bold text-[#172033] dark:text-white flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-[#087F8C] dark:text-[#D6AD60]" />
                  <span>Contact Verification &amp; Primary Branch</span>
                </h2>
                <p className="text-xs text-[#64748B] dark:text-slate-400">
                  Verify your owner mobile number via OTP and configure your primary outlet.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2 p-3.5 rounded-[12px] bg-[#F8FAFC] dark:bg-[#0E182E] border border-[#E2E8F0] dark:border-[#1F3158] space-y-2.5">
                  <div className="flex flex-col sm:flex-row sm:items-end gap-2">
                    <div className="flex-1">
                      <label className="block text-xs font-bold text-[#172033] dark:text-slate-200 mb-1">
                        Owner / Business Mobile Number <span className="text-[#F06464]">*</span>
                      </label>
                      <div className="relative">
                        <Phone className="w-4 h-4 text-[#64748B] dark:text-slate-400 absolute left-3 top-3" />
                        <input
                          type="text"
                          required
                          value={phone}
                          onChange={e => {
                            setPhone(e.target.value);
                            setMobileVerified(false);
                          }}
                          placeholder="017xxxxxxxx"
                          className={`${inputBaseClass} font-mono`}
                        />
                      </div>
                    </div>
                    {mobileVerified ? (
                      <div className="inline-flex items-center gap-1.5 px-3 py-2.5 rounded-[10px] bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 text-xs font-bold shrink-0">
                        <ShieldCheck className="w-4 h-4" />
                        <span>Mobile Verified</span>
                      </div>
                    ) : (
                      <button
                        type="button"
                        disabled={otpSending}
                        onClick={handleSendOtp}
                        className="px-4 py-2.5 rounded-[10px] bg-[#101B35] text-white text-xs font-bold hover:brightness-110 shrink-0 cursor-pointer disabled:opacity-60"
                      >
                        {otpSending ? 'Sending...' : otpSentPhone ? 'Resend OTP' : 'Send OTP Code'}
                      </button>
                    )}
                  </div>

                  {otpSentPhone && !mobileVerified && (
                    <div className="space-y-2 pt-1">
                      {otpPreviewHint && (
                        <div className="p-2.5 rounded-[8px] bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-700/50 text-[11px] text-amber-800 dark:text-amber-200">
                          {otpPreviewHint}
                        </div>
                      )}
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          maxLength={6}
                          value={otpCodeInput}
                          onChange={e => setOtpCodeInput(e.target.value)}
                          placeholder="Enter 6-digit OTP"
                          className="w-40 px-3 py-2 text-xs bg-white dark:bg-[#101B35] border border-[#E2E8F0] dark:border-[#1F3158] rounded-[8px] font-mono tracking-widest"
                        />
                        <button
                          type="button"
                          disabled={otpVerifying}
                          onClick={handleVerifyOtp}
                          className="px-4 py-2 rounded-[8px] bg-[#087F8C] text-white text-xs font-bold cursor-pointer"
                        >
                          {otpVerifying ? 'Verifying...' : 'Verify OTP'}
                        </button>
                      </div>
                    </div>
                  )}
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

                <div>
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
                      placeholder="e.g. Main Outlet / Dhanmondi Branch"
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
                  className="flex items-center gap-2 px-6 py-2.5 bg-[#087F8C] bg-gradient-to-r from-[#087F8C] to-[#10B981] hover:brightness-110 text-white rounded-[10px] text-xs sm:text-sm font-bold shadow-md shadow-[#087F8C]/20 active:scale-[0.98] transition-all cursor-pointer"
                >
                  <span>Continue to Accounts</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </form>
          )}

          {/* STEP 3: Financial Settings & Initial Accounts */}
          {currentStep === 3 && (
            <form onSubmit={handleNext} className="space-y-5">
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

                <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
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
                            setAccountsList(prev => prev.map((item, i) => (i === idx ? { ...item, name: val } : item)));
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
                            setAccountsList(prev => prev.map((item, i) => (i === idx ? { ...item, accountType: val } : item)));
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
                            setAccountsList(prev => prev.map((item, i) => (i === idx ? { ...item, openingBalance: val } : item)));
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
                </div>
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
                  className="flex items-center gap-2 px-6 py-2.5 bg-[#087F8C] bg-gradient-to-r from-[#087F8C] to-[#10B981] hover:brightness-110 text-white rounded-[10px] text-xs sm:text-sm font-bold shadow-md shadow-[#087F8C]/20 cursor-pointer"
                >
                  <span>Select Subscription Plan</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </form>
          )}

          {/* STEP 4: SaaS Plan Selection */}
          {currentStep === 4 && (
            <form onSubmit={handleFinalSubmit} className="space-y-5">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <div>
                  <h2 className="text-base font-bold text-[#172033] dark:text-white flex items-center gap-2">
                    <Crown className="w-4 h-4 text-[#D6AD60]" />
                    <span>Choose Your Subscription Plan</span>
                  </h2>
                  <p className="text-xs text-[#64748B] dark:text-slate-400">
                    Start with a 14-day Free Trial or pick a scaling plan (payment verification available in Plan &amp; Support).
                  </p>
                </div>

                {selectedPlanCode !== 'free_trial' && (
                  <div className="inline-flex rounded-[8px] border border-[#E2E8F0] dark:border-[#1F3158] p-0.5 text-[11px] font-bold">
                    <button
                      type="button"
                      onClick={() => setBillingCycle('monthly')}
                      className={`px-2.5 py-1 rounded-[6px] cursor-pointer ${
                        billingCycle !== 'yearly' ? 'bg-[#087F8C] text-white' : 'text-slate-500'
                      }`}
                    >
                      Monthly
                    </button>
                    <button
                      type="button"
                      onClick={() => setBillingCycle('yearly')}
                      className={`px-2.5 py-1 rounded-[6px] cursor-pointer ${
                        billingCycle === 'yearly' ? 'bg-[#087F8C] text-white' : 'text-slate-500'
                      }`}
                    >
                      Yearly
                    </button>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-72 overflow-y-auto pr-1">
                {plans.map(plan => {
                  const selected = selectedPlanCode === plan.code;
                  const price =
                    plan.priceMonthly === 0
                      ? 0
                      : billingCycle === 'yearly'
                      ? plan.priceYearly
                      : plan.priceMonthly;
                  return (
                    <div
                      key={plan.id}
                      onClick={() => {
                        setSelectedPlanCode(plan.code);
                        if (plan.code === 'free_trial') {
                          setBillingCycle('trial');
                        } else if (billingCycle === 'trial') {
                          setBillingCycle('monthly');
                        }
                      }}
                      className={`p-3.5 rounded-[12px] border cursor-pointer transition-all ${
                        selected
                          ? 'bg-[#087F8C]/10 dark:bg-[#087F8C]/20 border-[#087F8C] ring-2 ring-[#087F8C]/20'
                          : 'bg-white dark:bg-[#0E182E] border-[#E2E8F0] dark:border-[#1F3158] hover:border-slate-300'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-[#172033] dark:text-white">{plan.name}</span>
                        <span className="text-xs font-extrabold font-mono-num text-[#087F8C] dark:text-[#D6AD60]">
                          {price === 0 ? `${plan.trialDays}d Free` : `৳${price.toLocaleString()}`}
                        </span>
                      </div>
                      <p className="text-[11px] text-[#64748B] dark:text-slate-400 mt-1">{plan.description}</p>
                      <div className="mt-2 text-[10.5px] font-mono text-[#475569] dark:text-slate-300">
                        {plan.maxUsers || '∞'} users · {plan.maxBranches || '∞'} branches ·{' '}
                        {plan.maxProducts ? plan.maxProducts.toLocaleString() : '∞'} products
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="p-3 bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/50 rounded-[10px] text-emerald-900 dark:text-emerald-200 text-xs flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-[#10B981] shrink-0" />
                <span>
                  {selectedPlanCode === 'free_trial'
                    ? 'Your workspace starts immediately with a 14-day full-featured evaluation.'
                    : 'Your workspace starts with trial evaluation immediately; submit payment in Plan & Support to activate paid billing.'}
                </span>
              </div>

              <div className="flex items-center justify-between pt-4 border-t border-[#E2E8F0] dark:border-[#1F3158]">
                <button
                  type="button"
                  onClick={() => setCurrentStep(3)}
                  className="px-4 py-2 border border-[#E2E8F0] dark:border-[#1F3158] text-[#172033] dark:text-slate-200 rounded-[10px] text-xs sm:text-sm font-semibold hover:bg-[#F8FAFC] dark:hover:bg-[#162344] cursor-pointer"
                >
                  Back
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="flex items-center gap-2 px-7 py-2.5 bg-[#087F8C] bg-gradient-to-r from-[#087F8C] to-[#10B981] hover:brightness-110 text-white rounded-[10px] text-xs sm:text-sm font-bold shadow-lg shadow-[#087F8C]/25 active:scale-[0.98] transition-all cursor-pointer disabled:opacity-60"
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Provisioning Workspace...</span>
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
