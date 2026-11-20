import React, { useState } from 'react';
import { supabase, isSupabaseConfigured } from '../../lib/supabase';
import { useApp } from '../../context/AppContext';
import { staffRbacService } from '../../services/staffRbacService';
import { APP_IDENTITY } from '../../config/appIdentity';
import { Store, Mail, Lock, User, ArrowRight, Loader2, AlertCircle, CheckCircle2, ShieldAlert } from 'lucide-react';

interface AuthModalProps {
  onSuccess: () => void;
  initialMode?: 'login' | 'register' | 'forgot' | 'recovery';
  onRecoveryComplete?: () => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({
  onSuccess,
  initialMode = 'login',
  onRecoveryComplete,
}) => {
  const {
    authBlockedReason,
    clearAuthBlockedReason,
    sessionExpiredNotice,
    clearSessionExpiredNotice,
  } = useApp();
  const [mode, setMode] = useState<'login' | 'register' | 'forgot' | 'recovery'>(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [shopName, setShopName] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);
    clearAuthBlockedReason();
    clearSessionExpiredNotice();
    setLoading(true);

    if (!isSupabaseConfigured) {
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

  return (
    <div className="min-h-screen bg-[#0B1428] relative flex items-center justify-center p-4 overflow-hidden">
      {/* Subtle Luxury Background Accents */}
      <div className="pointer-events-none absolute -top-24 -right-24 w-96 h-96 rounded-full bg-[#087F8C]/15 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-24 -left-24 w-96 h-96 rounded-full bg-[#D6AD60]/10 blur-3xl" />

      <div className="relative w-full max-w-md bg-white dark:bg-[#101B35] rounded-[14px] shadow-2xl border border-[#E2E8F0] dark:border-[#1F3158] overflow-hidden adp-modal-enter">
        {/* Luxury Navy & Gold Header */}
        <div className="p-6 bg-gradient-to-br from-[#101B35] via-[#152447] to-[#0B1428] text-white text-center border-b border-[#D6AD60]/25">
          <div className="w-12 h-12 rounded-[12px] bg-gradient-to-br from-[#D6AD60] to-[#B68936] text-[#0B1428] flex items-center justify-center mx-auto mb-3 shadow-lg shadow-black/25">
            <Store className="w-6 h-6 stroke-[2.2]" />
          </div>
          <h1 className="text-xl font-bold tracking-tight text-white">{APP_IDENTITY.name}</h1>
          <p className="text-xs text-[#D6AD60] mt-1 font-medium">{APP_IDENTITY.subtitle}</p>
        </div>

        {/* Tab Selection */}
        {mode === 'recovery' ? (
          <div className="py-3 px-6 bg-[#F1F4F9] dark:bg-[#0B1428]/70 border-b border-[#E2E8F0] dark:border-[#1F3158] text-xs font-semibold text-[#087F8C] dark:text-[#5EEAD4] flex items-center justify-center gap-2">
            <Lock className="w-3.5 h-3.5" />
            <span>Reset Account Password</span>
          </div>
        ) : (
          <div className="flex border-b border-[#E2E8F0] dark:border-[#1F3158] bg-[#F8FAFC] dark:bg-[#0B1428]/60 text-xs font-semibold">
            <button
              type="button"
              onClick={() => {
                setMode('login');
                setErrorMsg(null);
                setSuccessMsg(null);
              }}
              className={`flex-1 py-3 text-center transition-colors cursor-pointer ${
                mode === 'login'
                  ? 'text-[#087F8C] dark:text-[#D6AD60] border-b-2 border-[#087F8C] dark:border-[#D6AD60] bg-white dark:bg-[#101B35]'
                  : 'text-[#64748B] dark:text-slate-400 hover:text-[#172033] dark:hover:text-white'
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('register');
                setErrorMsg(null);
                setSuccessMsg(null);
              }}
              className={`flex-1 py-3 text-center transition-colors cursor-pointer ${
                mode === 'register'
                  ? 'text-[#087F8C] dark:text-[#D6AD60] border-b-2 border-[#087F8C] dark:border-[#D6AD60] bg-white dark:bg-[#101B35]'
                  : 'text-[#64748B] dark:text-slate-400 hover:text-[#172033] dark:hover:text-white'
              }`}
            >
              Create Account
            </button>
          </div>
        )}

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {authBlockedReason && (
            <div className="p-3 rounded-[10px] bg-rose-50 dark:bg-rose-950/40 border border-rose-300 dark:border-rose-700/60 text-rose-800 dark:text-rose-200 text-xs flex items-start gap-2">
              <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5 text-[#F06464]" />
              <div>
                <div className="font-bold">Access Restricted</div>
                <p className="mt-0.5">{authBlockedReason}</p>
              </div>
            </div>
          )}

          {!authBlockedReason && sessionExpiredNotice && (
            <div className="p-3 rounded-[10px] bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-700/60 text-amber-800 dark:text-amber-200 text-xs flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-[#F59E0B]" />
              <div>
                <div className="font-bold">Session Expired</div>
                <p className="mt-0.5">{sessionExpiredNotice}</p>
              </div>
            </div>
          )}

          {errorMsg && (
            <div className="p-3 rounded-[10px] bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-700/60 text-rose-700 dark:text-rose-200 text-xs flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-[#F06464]" />
              <span>{errorMsg}</span>
            </div>
          )}

          {successMsg && (
            <div className="p-3 rounded-[10px] bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-700/60 text-emerald-800 dark:text-emerald-200 text-xs flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-[#10B981]" />
              <span>{successMsg}</span>
            </div>
          )}

          {mode === 'register' && (
            <>
              <div className="p-2.5 rounded-[10px] bg-[#087F8C]/10 border border-[#087F8C]/25 text-[11px] text-[#087F8C] dark:text-[#5EEAD4]">
                Every registered owner gets an isolated multi-branch shop workspace with a 14-day Free Trial. Staff accounts are created internally by your Shop Owner.
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#172033] dark:text-slate-200 mb-1">Full Name *</label>
                <div className="relative">
                  <User className="w-4 h-4 text-[#64748B] dark:text-slate-400 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="e.g. Tanvir Ahmed"
                    className="w-full pl-9 pr-3 py-2 text-xs bg-[#F8FAFC] dark:bg-[#0E182E] border border-[#E2E8F0] dark:border-[#1F3158] rounded-[10px] text-[#172033] dark:text-white placeholder:text-[#94A3B8] focus:outline-none focus:ring-2 focus:ring-[#087F8C]/25 focus:border-[#087F8C]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#172033] dark:text-slate-200 mb-1">Store / Business Name</label>
                <div className="relative">
                  <Store className="w-4 h-4 text-[#64748B] dark:text-slate-400 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    value={shopName}
                    onChange={(e) => setShopName(e.target.value)}
                    placeholder="e.g. Dhaka Fashion Store"
                    className="w-full pl-9 pr-3 py-2 text-xs bg-[#F8FAFC] dark:bg-[#0E182E] border border-[#E2E8F0] dark:border-[#1F3158] rounded-[10px] text-[#172033] dark:text-white placeholder:text-[#94A3B8] focus:outline-none focus:ring-2 focus:ring-[#087F8C]/25 focus:border-[#087F8C]"
                  />
                </div>
              </div>
            </>
          )}

          {mode !== 'recovery' && (
            <div>
              <label className="block text-xs font-semibold text-[#172033] dark:text-slate-200 mb-1">
                {mode === 'login' ? 'Email, Username, or Employee ID *' : 'Email Address *'}
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-[#64748B] dark:text-slate-400 absolute left-3 top-2.5" />
                <input
                  type={mode === 'login' ? 'text' : 'email'}
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={mode === 'login' ? 'admin@example.com, rahim_pos, or EMP-001' : 'you@business.com'}
                  className="w-full pl-9 pr-3 py-2 text-xs bg-[#F8FAFC] dark:bg-[#0E182E] border border-[#E2E8F0] dark:border-[#1F3158] rounded-[10px] text-[#172033] dark:text-white placeholder:text-[#94A3B8] focus:outline-none focus:ring-2 focus:ring-[#087F8C]/25 focus:border-[#087F8C]"
                />
              </div>
            </div>
          )}

          {mode !== 'forgot' && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-semibold text-[#172033] dark:text-slate-200">
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
                    className="text-[11px] text-[#087F8C] dark:text-[#D6AD60] hover:underline font-medium cursor-pointer"
                  >
                    Forgot password?
                  </button>
                )}
              </div>
              <div className="relative">
                <Lock className="w-4 h-4 text-[#64748B] dark:text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="password"
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Minimum 6 characters"
                  className="w-full pl-9 pr-3 py-2 text-xs bg-[#F8FAFC] dark:bg-[#0E182E] border border-[#E2E8F0] dark:border-[#1F3158] rounded-[10px] text-[#172033] dark:text-white placeholder:text-[#94A3B8] focus:outline-none focus:ring-2 focus:ring-[#087F8C]/25 focus:border-[#087F8C]"
                />
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 bg-gradient-to-r from-[#087F8C] to-[#10B981] hover:brightness-110 text-white font-semibold rounded-[10px] text-xs flex items-center justify-center gap-2 shadow-md shadow-[#087F8C]/25 transition-all disabled:opacity-60 cursor-pointer"
          >
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
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
                <ArrowRight className="w-3.5 h-3.5" />
              </>
            )}
          </button>

          {mode === 'forgot' && (
            <div className="text-center pt-2">
              <button
                type="button"
                onClick={() => {
                  setMode('login');
                  setErrorMsg(null);
                }}
                className="text-xs text-[#64748B] dark:text-slate-300 hover:text-[#172033] dark:hover:text-white underline font-medium cursor-pointer"
              >
                Back to Sign In
              </button>
            </div>
          )}
        </form>

        {/* Footer info */}
        <div className="p-4 bg-[#F8FAFC] dark:bg-[#0B1428]/70 border-t border-[#E2E8F0] dark:border-[#1F3158] text-center text-[11px] text-[#64748B] dark:text-slate-400">
          <span>Protected with Supabase Row Level Security &amp; Encryption</span>
        </div>
      </div>
    </div>
  );
};
