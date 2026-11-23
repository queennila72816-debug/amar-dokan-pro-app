import React, { useEffect, useState } from 'react';
import {
  supabase,
  isSupabaseConfigured,
  ensureSupabaseRuntimeConfigured,
} from '../../lib/supabase';
import { useApp } from '../../context/AppContext';
import { staffRbacService } from '../../services/staffRbacService';
import { APP_IDENTITY } from '../../config/appIdentity';
import { evaluateBrowserCompatibility } from '../../utils/browserCompat';
import {
  Store,
  Mail,
  Lock,
  User,
  ArrowRight,
  ArrowLeft,
  Loader2,
  AlertCircle,
  CheckCircle2,
  ShieldAlert,
  Eye,
  EyeOff,
  AlertTriangle,
  LogIn,
  UserPlus,
  ShoppingBag,
  Layers,
  Receipt,
  ShieldCheck,
} from 'lucide-react';

export type AuthModalMode = 'welcome' | 'login' | 'register' | 'forgot' | 'recovery';

interface AuthModalProps {
  onSuccess: () => void;
  initialMode?: AuthModalMode;
  onRecoveryComplete?: () => void;
}

const DESKTOP_HIGHLIGHTS = [
  {
    icon: ShoppingBag,
    title: 'Multi-Branch POS',
    description: 'Fast counter billing, barcode scanning, and instant thermal receipts.',
  },
  {
    icon: Layers,
    title: 'Inventory Control',
    description: 'Track stock levels, product variants, and branch transfers live.',
  },
  {
    icon: Receipt,
    title: 'Accounts & Ledgers',
    description: 'Manage expenses by billing month, customer dues, and daily cashbook.',
  },
  {
    icon: ShieldCheck,
    title: 'Role-Based Teams',
    description: 'Isolated owner workspaces with dedicated permissions for managers and staff.',
  },
] as const;

export const AuthModal: React.FC<AuthModalProps> = ({
  onSuccess,
  initialMode = 'welcome',
  onRecoveryComplete,
}) => {
  const {
    authBlockedReason,
    clearAuthBlockedReason,
    sessionExpiredNotice,
    clearSessionExpiredNotice,
  } = useApp();
  const [mode, setMode] = useState<AuthModalMode>(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [shopName, setShopName] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [compatReport] = useState(() => evaluateBrowserCompatibility());

  useEffect(() => {
    setMode(initialMode);
  }, [initialMode]);

  useEffect(() => {
    void ensureSupabaseRuntimeConfigured();
  }, []);

  const switchMode = (nextMode: AuthModalMode) => {
    if (loading) return;
    setMode(nextMode);
    setErrorMsg(null);
    setSuccessMsg(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);
    clearAuthBlockedReason();
    clearSessionExpiredNotice();
    setLoading(true);

    const configured = isSupabaseConfigured || (await ensureSupabaseRuntimeConfigured());

    if (!configured) {
      setErrorMsg('Supabase is not configured. Please check VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.');
      setLoading(false);
      return;
    }

    try {
      if (mode === 'recovery') {
        const { error } = await supabase.auth.updateUser({
          password,
        });

        if (error) {
          throw error;
        }

        setSuccessMsg('Password updated successfully! Redirecting...');
        setTimeout(() => {
          if (onRecoveryComplete) {
            onRecoveryComplete();
          } else {
            setMode('login');
          }
        }, 1500);
      } else if (mode === 'login') {
        const loginEmail = await staffRbacService.resolveLoginIdentifier(email);

        const { data, error } = await supabase.auth.signInWithPassword({
          email: loginEmail,
          password,
        });

        if (error) {
          throw error;
        }

        if (data.session) {
          onSuccess();
        }
      } else if (mode === 'register') {
        if (!fullName.trim()) {
          setErrorMsg('Please enter your full name.');
          setLoading(false);
          return;
        }

        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            data: {
              full_name: fullName.trim(),
              shop_name: shopName.trim() || undefined,
            },
          },
        });

        if (error) {
          throw error;
        }

        if (data.session) {
          onSuccess();
        } else if (data.user) {
          setSuccessMsg('Registration successful! If confirmation is required, please check your email.');
          setMode('login');
        }
      } else if (mode === 'forgot') {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: window.location.origin,
        });

        if (error) {
          throw error;
        }

        setSuccessMsg('Password reset instructions sent to your email.');
        setTimeout(() => setMode('login'), 3000);
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'An error occurred during authentication.');
    } finally {
      setLoading(false);
    }
  };

  const modeHeading =
    mode === 'welcome'
      ? `Welcome to ${APP_IDENTITY.name}`
      : mode === 'login'
      ? 'Sign In to Your Workspace'
      : mode === 'register'
      ? 'Create Business Account'
      : mode === 'recovery'
      ? 'Set New Password'
      : 'Reset Your Password';

  const modeContextLabel =
    mode === 'login'
      ? 'Account Sign In'
      : mode === 'register'
      ? 'New Account Registration'
      : mode === 'recovery'
      ? 'Password Recovery'
      : 'Password Reset';

  return (
    <div className="min-h-screen supports-[min-height:100dvh]:min-h-dvh w-full overflow-x-hidden bg-[#0A122C] relative flex items-center justify-center px-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))] pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6 sm:py-8 lg:px-10 lg:py-6 xl:py-10">
      {/* Subtle Non-Interactive Ambient Brand Layers */}
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-32 -right-24 w-72 h-72 sm:w-[28rem] sm:h-[28rem] rounded-full bg-[#243B70]/35 blur-3xl" />
        <div className="absolute -bottom-32 -left-24 w-72 h-72 sm:w-[26rem] sm:h-[26rem] rounded-full bg-[#FF9D32]/12 blur-3xl" />
        <div className="hidden lg:block absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,rgba(36,59,112,0.28),transparent_55%)]" />
      </div>

      {/* Responsive Container: Single-Column (Mobile/Tablet) -> Two-Column (Desktop >= 1024px) */}
      <div className="relative z-10 w-full max-w-[440px] sm:max-w-[500px] lg:max-w-[1120px] mx-auto grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-10 xl:gap-14 items-center">
        {/* Desktop Left Showcase Column (1024px+) */}
        <aside className="hidden lg:flex lg:col-span-6 xl:col-span-7 flex-col justify-center min-w-0 text-white pr-2 xl:pr-4">
          <div className="inline-flex items-center justify-center bg-white rounded-[14px] px-5 py-3 shadow-lg shadow-black/25 border border-white/85 self-start mb-6">
            <img
              src={APP_IDENTITY.logoPath}
              alt={`${APP_IDENTITY.name} — ${APP_IDENTITY.subtitle}`}
              className="h-14 xl:h-16 w-auto object-contain select-none"
            />
          </div>

          <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#FF9D32] mb-2.5">
            {APP_IDENTITY.name} · {APP_IDENTITY.subtitle}
          </p>

          <h1 className="text-[clamp(1.85rem,2.7vw,2.65rem)] font-extrabold leading-[1.15] tracking-tight text-white mb-4">
            Unified commerce, inventory, and financial control for modern shops.
          </h1>

          <p className="text-sm xl:text-[15px] leading-relaxed text-slate-300 max-w-xl mb-7">
            Operate multi-branch counters, manage supplier and customer ledgers, track monthly expenses, and coordinate your team from one secure workspace.
          </p>

          <div className="grid grid-cols-2 gap-3.5 max-w-xl">
            {DESKTOP_HIGHLIGHTS.map((item) => {
              const Icon = item.icon;
              return (
                <div
                  key={item.title}
                  className="rounded-[12px] bg-[#101B3F]/85 border border-[#243B70]/85 p-4 transition-colors hover:border-[#FF9D32]/40"
                >
                  <div className="flex items-center gap-2.5 mb-1.5">
                    <div className="w-8 h-8 rounded-[8px] bg-[#243B70]/80 border border-white/10 flex items-center justify-center shrink-0">
                      <Icon className="w-4 h-4 text-[#FF9D32]" />
                    </div>
                    <h2 className="text-[13px] font-bold text-white leading-snug">
                      {item.title}
                    </h2>
                  </div>
                  <p className="text-xs leading-relaxed text-slate-300/90">
                    {item.description}
                  </p>
                </div>
              );
            })}
          </div>

          <div className="mt-7 pt-4 border-t border-white/10 text-xs text-slate-300/80 flex items-center gap-2 max-w-xl">
            <ShieldCheck className="w-4 h-4 text-[#FF9D32] shrink-0" />
            <span>
              Protected by isolated tenant workspaces, encrypted authentication, and role-based access control.
            </span>
          </div>
        </aside>

        {/* Right / Primary Auth Card Column */}
        <main className="lg:col-span-6 xl:col-span-5 w-full min-w-0 flex justify-center">
          <div className="w-full max-w-[440px] sm:max-w-[480px] lg:max-w-[460px] bg-white dark:bg-[#101B3F] rounded-[14px] shadow-2xl border border-[#E2E8F0] dark:border-[#243B70] overflow-hidden adp-modal-enter min-w-0">
            {/* Mobile & Tablet Official Brand Header (< 1024px) */}
            <div className="lg:hidden px-4 py-4 min-[375px]:px-6 sm:py-5 bg-[#101B3F] bg-gradient-to-br from-[#101B3F] via-[#1B2F63] to-[#243B70] text-white text-center border-b border-[#FF9D32]/30">
              <div className="inline-flex items-center justify-center bg-white rounded-[12px] px-3.5 py-2 shadow-lg shadow-black/25 border border-white/80 mb-2">
                <img
                  src={APP_IDENTITY.logoPath}
                  alt={`${APP_IDENTITY.name} — ${APP_IDENTITY.subtitle}`}
                  className="h-12 min-[375px]:h-14 sm:h-16 w-auto object-contain select-none"
                />
              </div>
              <h1 className="text-base sm:text-lg font-extrabold tracking-[0.18em] text-white uppercase">
                {APP_IDENTITY.name}
              </h1>
              <p className="text-[11px] sm:text-xs font-medium tracking-wide text-slate-200/90 mt-0.5">
                {APP_IDENTITY.subtitle}
              </p>
            </div>

            {/* Desktop Compact Card Header (>= 1024px) */}
            <div className="hidden lg:flex items-center justify-between gap-3 px-6 py-4 bg-[#101B3F] bg-gradient-to-r from-[#101B3F] via-[#1B2F63] to-[#243B70] text-white border-b border-[#FF9D32]/30">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 rounded-[9px] bg-white p-1.5 flex items-center justify-center shrink-0 shadow-sm">
                  <img
                    src={APP_IDENTITY.symbolPath}
                    alt={APP_IDENTITY.name}
                    className="w-full h-full object-contain select-none"
                  />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-extrabold tracking-[0.16em] text-white uppercase truncate">
                    {APP_IDENTITY.name}
                  </p>
                  <p className="text-[11px] text-slate-200/85 truncate">
                    {modeHeading}
                  </p>
                </div>
              </div>
              <span className="text-[11px] font-semibold uppercase tracking-wider text-[#FF9D32] shrink-0">
                Portal
              </span>
            </div>

            {!compatReport.supported && (
              <div className="mx-4 min-[375px]:mx-5 sm:mx-7 mt-4 p-3 rounded-[10px] bg-amber-50 border border-amber-300 text-amber-950 text-xs flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <p className="font-bold">Browser Compatibility Notice</p>
                  <p className="mt-0.5 leading-relaxed">{compatReport.recommendedAction}</p>
                </div>
              </div>
            )}

            {mode === 'welcome' ? (
              <div className="p-4 min-[375px]:p-5 sm:p-7 space-y-5">
                {authBlockedReason && (
                  <div className="p-3 rounded-[10px] bg-rose-50 dark:bg-rose-950/40 border border-rose-300 dark:border-rose-700/60 text-rose-800 dark:text-rose-200 text-xs flex items-start gap-2.5">
                    <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5 text-[#F06464]" />
                    <div className="min-w-0">
                      <div className="font-bold">Access Restricted</div>
                      <p className="mt-0.5 leading-relaxed">{authBlockedReason}</p>
                    </div>
                  </div>
                )}

                {!authBlockedReason && sessionExpiredNotice && (
                  <div className="p-3 rounded-[10px] bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-700/60 text-amber-800 dark:text-amber-200 text-xs flex items-start gap-2.5">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-[#F59E0B]" />
                    <div className="min-w-0">
                      <div className="font-bold">Session Expired</div>
                      <p className="mt-0.5 leading-relaxed">{sessionExpiredNotice}</p>
                    </div>
                  </div>
                )}

                <div className="text-center lg:text-left space-y-2 pt-0.5">
                  <h2 className="text-xl sm:text-[22px] font-bold tracking-tight text-[#101B3F] dark:text-white">
                    Welcome to {APP_IDENTITY.name}
                  </h2>
                  <p className="text-[13px] sm:text-sm leading-relaxed text-[#475569] dark:text-slate-300">
                    Sign in to access your existing store or register a new multi-branch business workspace to get started.
                  </p>
                </div>

                <div className="space-y-3 pt-1">
                  <button
                    type="button"
                    onClick={() => switchMode('login')}
                    className="w-full min-h-[48px] py-3 px-4 bg-[#101B3F] bg-gradient-to-r from-[#101B3F] to-[#243B70] hover:brightness-110 active:scale-[0.99] text-white font-semibold rounded-[10px] text-sm flex items-center justify-between shadow-md shadow-[#101B3F]/25 border border-[#FF9D32]/35 transition-all cursor-pointer"
                  >
                    <span className="flex items-center gap-2.5">
                      <LogIn className="w-4 h-4 text-[#FF9D32] shrink-0" />
                      <span>Login</span>
                    </span>
                    <ArrowRight className="w-4 h-4 text-[#FF9D32] shrink-0" />
                  </button>

                  <button
                    type="button"
                    onClick={() => switchMode('register')}
                    className="w-full min-h-[48px] py-3 px-4 bg-[#F5F7FC] dark:bg-[#0D1736] hover:bg-[#E2E8F0]/75 dark:hover:bg-[#16254E] active:scale-[0.99] text-[#101B3F] dark:text-white font-semibold rounded-[10px] text-sm flex items-center justify-between border border-[#CBD5E1] dark:border-[#243B70] transition-all cursor-pointer"
                  >
                    <span className="flex items-center gap-2.5">
                      <UserPlus className="w-4 h-4 text-[#087F8C] dark:text-[#FF9D32] shrink-0" />
                      <span>Create New Account</span>
                    </span>
                    <ArrowRight className="w-4 h-4 text-[#64748B] dark:text-slate-400 shrink-0" />
                  </button>
                </div>
              </div>
            ) : (
              <>
                {/* Navigation / Mode Header */}
                {mode === 'recovery' ? (
                  <div className="py-3 px-4 sm:px-6 bg-[#F5F7FC] dark:bg-[#0A122C]/70 border-b border-[#E2E8F0] dark:border-[#243B70] text-xs font-semibold text-[#243B70] dark:text-[#FF9D32] flex items-center justify-center gap-2">
                    <Lock className="w-3.5 h-3.5 shrink-0" />
                    <span>Reset Account Password</span>
                  </div>
                ) : (
                  <div>
                    <div className="px-4 min-[375px]:px-5 sm:px-6 py-1.5 bg-[#F8FAFC] dark:bg-[#0A122C]/80 border-b border-[#E2E8F0] dark:border-[#243B70] flex items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => switchMode('welcome')}
                        disabled={loading}
                        className="min-h-[44px] inline-flex items-center gap-1.5 px-1.5 -ml-1.5 text-xs font-semibold text-[#475569] dark:text-slate-300 hover:text-[#101B3F] dark:hover:text-white transition-colors cursor-pointer disabled:opacity-50"
                      >
                        <ArrowLeft className="w-3.5 h-3.5 shrink-0" />
                        <span>Back to Welcome</span>
                      </button>
                      <span className="text-[11px] font-medium text-[#64748B] dark:text-slate-400 truncate">
                        {modeContextLabel}
                      </span>
                    </div>

                    {mode !== 'forgot' && (
                      <div className="grid grid-cols-2 border-b border-[#E2E8F0] dark:border-[#243B70] bg-[#F5F7FC] dark:bg-[#0A122C]/60 text-xs sm:text-[13px] font-semibold">
                        <button
                          type="button"
                          onClick={() => switchMode('login')}
                          className={`min-h-[46px] px-2 py-3 text-center whitespace-nowrap transition-colors cursor-pointer ${
                            mode === 'login'
                              ? 'text-[#101B3F] dark:text-[#FF9D32] border-b-2 border-[#FF9D32] bg-white dark:bg-[#101B3F]'
                              : 'text-[#64748B] dark:text-slate-400 hover:text-[#101B3F] dark:hover:text-white'
                          }`}
                        >
                          Login
                        </button>
                        <button
                          type="button"
                          onClick={() => switchMode('register')}
                          className={`min-h-[46px] px-2 py-3 text-center whitespace-nowrap transition-colors cursor-pointer ${
                            mode === 'register'
                              ? 'text-[#101B3F] dark:text-[#FF9D32] border-b-2 border-[#FF9D32] bg-white dark:bg-[#101B3F]'
                              : 'text-[#64748B] dark:text-slate-400 hover:text-[#101B3F] dark:hover:text-white'
                          }`}
                        >
                          Create New Account
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* Form Body */}
                <form onSubmit={handleSubmit} className="p-4 min-[375px]:p-5 sm:p-7 space-y-4">
                  {authBlockedReason && (
                    <div className="p-3 rounded-[10px] bg-rose-50 dark:bg-rose-950/40 border border-rose-300 dark:border-rose-700/60 text-rose-800 dark:text-rose-200 text-xs flex items-start gap-2.5">
                      <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5 text-[#F06464]" />
                      <div className="min-w-0">
                        <div className="font-bold">Access Restricted</div>
                        <p className="mt-0.5 leading-relaxed">{authBlockedReason}</p>
                      </div>
                    </div>
                  )}

                  {!authBlockedReason && sessionExpiredNotice && (
                    <div className="p-3 rounded-[10px] bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-700/60 text-amber-800 dark:text-amber-200 text-xs flex items-start gap-2.5">
                      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-[#F59E0B]" />
                      <div className="min-w-0">
                        <div className="font-bold">Session Expired</div>
                        <p className="mt-0.5 leading-relaxed">{sessionExpiredNotice}</p>
                      </div>
                    </div>
                  )}

                  {errorMsg && (
                    <div className="p-3 rounded-[10px] bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-700/60 text-rose-700 dark:text-rose-200 text-xs flex items-start gap-2.5">
                      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-[#F06464]" />
                      <span className="leading-relaxed min-w-0">{errorMsg}</span>
                    </div>
                  )}

                  {successMsg && (
                    <div className="p-3 rounded-[10px] bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-700/60 text-emerald-800 dark:text-emerald-200 text-xs flex items-start gap-2.5">
                      <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-[#10B981]" />
                      <span className="leading-relaxed min-w-0">{successMsg}</span>
                    </div>
                  )}

                  {mode === 'register' && (
                    <>
                      <div className="p-3 rounded-[10px] bg-[#087F8C]/10 border border-[#087F8C]/25 text-xs leading-relaxed text-[#087F8C] dark:text-[#5EEAD4]">
                        Every registered owner receives an isolated multi-branch shop workspace with a 14-day Free Trial. Staff accounts are created internally by your Shop Owner.
                      </div>

                      <div>
                        <label
                          htmlFor="auth-full-name"
                          className="block text-xs sm:text-[13px] font-semibold text-[#172033] dark:text-slate-200 mb-1.5"
                        >
                          Full Name *
                        </label>
                        <div className="relative">
                          <User className="w-4 h-4 text-[#64748B] dark:text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                          <input
                            id="auth-full-name"
                            type="text"
                            required
                            autoComplete="name"
                            value={fullName}
                            onChange={(e) => setFullName(e.target.value)}
                            placeholder="e.g. Tanvir Ahmed"
                            className="w-full min-h-[44px] pl-10 pr-3.5 py-2.5 text-sm bg-[#F8FAFC] dark:bg-[#0E182E] border border-[#E2E8F0] dark:border-[#1F3158] rounded-[10px] text-[#172033] dark:text-white placeholder:text-[#94A3B8] focus:outline-none focus:ring-2 focus:ring-[#087F8C]/25 focus:border-[#087F8C]"
                          />
                        </div>
                      </div>

                      <div>
                        <label
                          htmlFor="auth-shop-name"
                          className="block text-xs sm:text-[13px] font-semibold text-[#172033] dark:text-slate-200 mb-1.5"
                        >
                          Store / Business Name
                        </label>
                        <div className="relative">
                          <Store className="w-4 h-4 text-[#64748B] dark:text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                          <input
                            id="auth-shop-name"
                            type="text"
                            autoComplete="organization"
                            value={shopName}
                            onChange={(e) => setShopName(e.target.value)}
                            placeholder="e.g. Dhaka Fashion Store"
                            className="w-full min-h-[44px] pl-10 pr-3.5 py-2.5 text-sm bg-[#F8FAFC] dark:bg-[#0E182E] border border-[#E2E8F0] dark:border-[#1F3158] rounded-[10px] text-[#172033] dark:text-white placeholder:text-[#94A3B8] focus:outline-none focus:ring-2 focus:ring-[#087F8C]/25 focus:border-[#087F8C]"
                          />
                        </div>
                      </div>
                    </>
                  )}

                  {mode !== 'recovery' && (
                    <div>
                      <label
                        htmlFor="auth-email"
                        className="block text-xs sm:text-[13px] font-semibold text-[#172033] dark:text-slate-200 mb-1.5"
                      >
                        {mode === 'login' ? 'Email, Username, or Employee ID *' : 'Email Address *'}
                      </label>
                      <div className="relative">
                        <Mail className="w-4 h-4 text-[#64748B] dark:text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                        <input
                          id="auth-email"
                          type={mode === 'login' ? 'text' : 'email'}
                          required
                          autoComplete={mode === 'login' ? 'username' : 'email'}
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          placeholder={mode === 'login' ? 'admin@example.com or EMP-001' : 'you@business.com'}
                          className="w-full min-h-[44px] pl-10 pr-3.5 py-2.5 text-sm bg-[#F8FAFC] dark:bg-[#0E182E] border border-[#E2E8F0] dark:border-[#1F3158] rounded-[10px] text-[#172033] dark:text-white placeholder:text-[#94A3B8] focus:outline-none focus:ring-2 focus:ring-[#087F8C]/25 focus:border-[#087F8C]"
                        />
                      </div>
                    </div>
                  )}

                  {mode !== 'forgot' && (
                    <div>
                      <div className="flex items-center justify-between gap-2 mb-1.5">
                        <label
                          htmlFor="auth-password"
                          className="block text-xs sm:text-[13px] font-semibold text-[#172033] dark:text-slate-200"
                        >
                          {mode === 'recovery' ? 'New Password *' : 'Password *'}
                        </label>
                        {mode === 'login' && (
                          <button
                            type="button"
                            onClick={() => {
                              setMode('forgot');
                              setErrorMsg(null);
                              setSuccessMsg(null);
                            }}
                            className="min-h-[36px] inline-flex items-center text-xs text-[#243B70] dark:text-[#FF9D32] hover:underline font-medium cursor-pointer"
                          >
                            Forgot password?
                          </button>
                        )}
                      </div>
                      <div className="relative">
                        <Lock className="w-4 h-4 text-[#64748B] dark:text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                        <input
                          id="auth-password"
                          type={showPassword ? 'text' : 'password'}
                          required
                          minLength={6}
                          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          placeholder="Minimum 6 characters"
                          className="w-full min-h-[44px] pl-10 pr-12 py-2.5 text-sm bg-[#F5F7FC] dark:bg-[#0D1736] border border-[#E2E8F0] dark:border-[#243B70] rounded-[10px] text-[#172033] dark:text-white placeholder:text-[#94A3B8] focus:outline-none focus:ring-2 focus:ring-[#243B70]/25 focus:border-[#243B70]"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword(prev => !prev)}
                          aria-label={showPassword ? 'Hide password' : 'Show password'}
                          title={showPassword ? 'Hide password' : 'Show password'}
                          className="absolute right-0 inset-y-0 min-w-[44px] flex items-center justify-center text-[#64748B] dark:text-slate-400 hover:text-[#101B3F] dark:hover:text-white transition-colors cursor-pointer"
                        >
                          {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full min-h-[48px] py-3 px-4 bg-[#101B3F] bg-gradient-to-r from-[#101B3F] to-[#243B70] hover:brightness-110 active:scale-[0.99] text-white font-semibold rounded-[10px] text-sm flex items-center justify-center gap-2 shadow-md shadow-[#101B3F]/25 border border-[#FF9D32]/30 transition-all disabled:opacity-60 cursor-pointer"
                  >
                    {loading ? (
                      <Loader2 className="w-4 h-4 animate-spin text-[#FF9D32]" />
                    ) : (
                      <>
                        <span>
                          {mode === 'login'
                            ? 'Sign In'
                            : mode === 'register'
                            ? 'Register Business'
                            : mode === 'recovery'
                            ? 'Update Password'
                            : 'Send Reset Link'}
                        </span>
                        <ArrowRight className="w-4 h-4 text-[#FF9D32]" />
                      </>
                    )}
                  </button>

                  {mode === 'forgot' && (
                    <div className="text-center pt-1">
                      <button
                        type="button"
                        onClick={() => {
                          setMode('login');
                          setErrorMsg(null);
                        }}
                        className="min-h-[40px] inline-flex items-center justify-center px-3 text-xs sm:text-[13px] text-[#64748B] dark:text-slate-300 hover:text-[#101B3F] dark:hover:text-white underline font-medium cursor-pointer"
                      >
                        Back to Sign In
                      </button>
                    </div>
                  )}
                </form>
              </>
            )}

            {/* Footer info */}
            <div className="px-4 py-3.5 sm:px-6 bg-[#F5F7FC] dark:bg-[#0A122C]/70 border-t border-[#E2E8F0] dark:border-[#243B70] text-center text-[11px] leading-relaxed text-[#64748B] dark:text-slate-400">
              <span>{APP_IDENTITY.name} · Protected with Supabase Row Level Security &amp; Encryption</span>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
};
