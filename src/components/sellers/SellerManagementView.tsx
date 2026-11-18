import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { Seller } from '../../types';
import { formatCurrency, formatDate } from '../../utils/formatters';
import {
  Users,
  UserPlus,
  Search,
  CheckCircle2,
  XCircle,
  KeyRound,
  Edit2,
  Eye,
  TrendingUp,
  Receipt,
  Building2,
  Phone,
  Mail,
  ShieldCheck,
  AlertCircle,
  Loader2,
  X,
  Lock,
} from 'lucide-react';

export const SellerManagementView: React.FC = () => {
  const { sellers, addSeller, updateSeller, toggleSellerStatus, resetSellerPassword, branches, sales, settings } = useApp();
  const lang = settings.language;

  // Search & Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [branchFilter, setBranchFilter] = useState<string>('all');

  // Modals state
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingSeller, setEditingSeller] = useState<Seller | null>(null);
  const [viewingSeller, setViewingSeller] = useState<Seller | null>(null);
  const [passwordResetSeller, setPasswordResetSeller] = useState<Seller | null>(null);

  // Add Seller Form State
  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [selectedBranchId, setSelectedBranchId] = useState<string>(branches[0]?.id || '');
  const [isActiveStatus, setIsActiveStatus] = useState<boolean>(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  React.useEffect(() => {
    if (branches.length > 0 && (!selectedBranchId || !branches.some(b => b.id === selectedBranchId))) {
      setSelectedBranchId(branches[0].id);
    }
  }, [branches, selectedBranchId]);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);

  // Edit Seller Form State
  const [editFullName, setEditFullName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editBranchId, setEditBranchId] = useState('');
  const [editStatus, setEditStatus] = useState<'active' | 'inactive'>('active');
  const [isUpdating, setIsUpdating] = useState(false);

  // Reset Password Form State
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [isResettingPass, setIsResettingPass] = useState(false);
  const [resetMsg, setResetMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Filtered sellers list
  const filteredSellers = sellers.filter(s => {
    const matchSearch =
      s.fullName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.username.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.phone.includes(searchQuery);

    const matchStatus = statusFilter === 'all' || s.status === statusFilter;
    const matchBranch = branchFilter === 'all' || s.branchId === branchFilter;

    return matchSearch && matchStatus && matchBranch;
  });

  // Calculate metrics
  const totalSellers = sellers.length;
  const activeSellersCount = sellers.filter(s => s.status === 'active').length;
  const totalSellerSalesAmount = sellers.reduce((acc, curr) => acc + (curr.totalSalesAmount || 0), 0);
  const topSeller = [...sellers].sort((a, b) => (b.totalSalesAmount || 0) - (a.totalSalesAmount || 0))[0];

  // Open Edit Modal
  const handleOpenEdit = (seller: Seller) => {
    setEditingSeller(seller);
    setEditFullName(seller.fullName);
    setEditPhone(seller.phone);
    setEditBranchId(seller.branchId || branches[0]?.id || '');
    setEditStatus(seller.status);
    setFormError(null);
  };

  // Open Password Modal
  const handleOpenResetPassword = (seller: Seller) => {
    setPasswordResetSeller(seller);
    setNewPassword('');
    setConfirmNewPassword('');
    setResetMsg(null);
  };

  // Handle Add Seller Submit
  const handleAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setFormSuccess(null);

    if (!fullName.trim()) {
      setFormError('Please enter seller full name.');
      return;
    }
    if (!username.trim()) {
      setFormError('Please provide a unique username / seller ID.');
      return;
    }
    if (sellers.some(s => s.username.toLowerCase() === username.trim().toLowerCase())) {
      setFormError(`Username "${username.trim()}" is already taken.`);
      return;
    }
    if (!phone.trim()) {
      setFormError('Please provide contact phone number.');
      return;
    }
    if (password.length < 6) {
      setFormError('Password must be at least 6 characters long.');
      return;
    }
    if (password !== confirmPassword) {
      setFormError('Password and confirmation do not match.');
      return;
    }

    setIsSubmitting(true);
    try {
      const assignedBranch = branches.find(b => b.id === selectedBranchId);
      await addSeller({
        fullName: fullName.trim(),
        username: username.trim().toLowerCase().replace(/\s+/g, '_'),
        phone: phone.trim(),
        email: email.trim() || undefined,
        password,
        branchId: selectedBranchId,
        branchName: assignedBranch?.name,
        status: isActiveStatus ? 'active' : 'inactive',
      });

      setFormSuccess('Seller account created successfully!');
      setTimeout(() => {
        setIsAddModalOpen(false);
        // Reset fields
        setFullName('');
        setUsername('');
        setPhone('');
        setEmail('');
        setPassword('');
        setConfirmPassword('');
        setFormSuccess(null);
      }, 1000);
    } catch (err: any) {
      setFormError(err.message || 'Failed to create seller account.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle Edit Submit
  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingSeller) return;

    setIsUpdating(true);
    try {
      const assignedBranch = branches.find(b => b.id === editBranchId);
      await updateSeller(editingSeller.id, {
        fullName: editFullName.trim(),
        phone: editPhone.trim(),
        branchId: editBranchId,
        branchName: assignedBranch?.name,
        status: editStatus,
      });

      setEditingSeller(null);
    } catch (err: any) {
      alert(`Update failed: ${err.message}`);
    } finally {
      setIsUpdating(false);
    }
  };

  // Handle Password Reset
  const handleResetPasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passwordResetSeller) return;

    if (newPassword && newPassword.length < 6) {
      setResetMsg({ type: 'error', text: 'Password must be at least 6 characters long.' });
      return;
    }
    if (newPassword && newPassword !== confirmNewPassword) {
      setResetMsg({ type: 'error', text: 'Passwords do not match.' });
      return;
    }

    setIsResettingPass(true);
    try {
      const result = await resetSellerPassword(
        passwordResetSeller.email || `${passwordResetSeller.username}@amardokanpro.internal`,
        newPassword || undefined
      );

      if (result.success) {
        setResetMsg({ type: 'success', text: result.message });
        setTimeout(() => setPasswordResetSeller(null), 1500);
      } else {
        setResetMsg({ type: 'error', text: result.message });
      }
    } catch (err: any) {
      setResetMsg({ type: 'error', text: err.message || 'Failed to reset password.' });
    } finally {
      setIsResettingPass(false);
    }
  };

  // Toggle status quick button
  const handleToggleStatus = async (seller: Seller) => {
    const nextStatus = seller.status === 'active' ? 'inactive' : 'active';
    const confirmChange = window.confirm(
      `Are you sure you want to ${nextStatus === 'active' ? 'activate' : 'deactivate'} seller "${seller.fullName}"?`
    );
    if (!confirmChange) return;

    try {
      await toggleSellerStatus(seller.id, nextStatus);
    } catch (err: any) {
      alert(`Status update failed: ${err.message}`);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-white p-4 sm:p-6 rounded-2xl border border-slate-200 shadow-xs">
        <div>
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-emerald-600 flex items-center justify-center text-white shadow-sm shadow-emerald-600/20">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-lg sm:text-xl font-bold tracking-tight text-slate-900">
                Seller Management
              </h1>
              <p className="text-xs text-slate-500">
                Manage POS staff credentials, branch assignments, status &amp; sales performance
              </p>
            </div>
          </div>
        </div>

        <button
          onClick={() => {
            setIsAddModalOpen(true);
            setFormError(null);
            setFormSuccess(null);
          }}
          className="w-full sm:w-auto flex items-center justify-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 active:scale-[0.98] text-white rounded-xl text-sm font-semibold shadow-sm shadow-emerald-700/20 transition-all cursor-pointer"
        >
          <UserPlus className="w-4 h-4" />
          <span>Add New Seller</span>
        </button>
      </div>

      {/* KPI Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 mb-1">
            <span className="text-xs font-medium">Total Sellers</span>
            <Users className="w-4 h-4 text-emerald-600" />
          </div>
          <p className="text-xl sm:text-2xl font-bold text-slate-900">{totalSellers}</p>
          <span className="text-[11px] text-slate-500">Registered sales accounts</span>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 mb-1">
            <span className="text-xs font-medium">Active Sellers</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          </div>
          <p className="text-xl sm:text-2xl font-bold text-emerald-700">{activeSellersCount}</p>
          <span className="text-[11px] text-slate-500">Ready to sell at POS</span>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 mb-1">
            <span className="text-xs font-medium">Total Seller Sales</span>
            <TrendingUp className="w-4 h-4 text-emerald-600" />
          </div>
          <p className="text-xl sm:text-2xl font-bold text-slate-900 font-mono-num">
            {formatCurrency(totalSellerSalesAmount, lang)}
          </p>
          <span className="text-[11px] text-slate-500">Cumulative sales generated</span>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 mb-1">
            <span className="text-xs font-medium">Top Performing Seller</span>
            <Receipt className="w-4 h-4 text-amber-600" />
          </div>
          <p className="text-sm sm:text-base font-bold text-slate-900 truncate">
            {topSeller ? topSeller.fullName : '—'}
          </p>
          <span className="text-[11px] text-emerald-700 font-semibold font-mono-num">
            {topSeller ? formatCurrency(topSeller.totalSalesAmount || 0, lang) : '৳0'}
          </span>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
        {/* Search */}
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search seller by name, username, or phone..."
            className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs md:text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
          />
        </div>

        {/* Filter Dropdowns */}
        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={branchFilter}
            onChange={e => setBranchFilter(e.target.value)}
            className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
          >
            <option value="all">All Branches</option>
            {branches.map(b => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>

          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value as any)}
            className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
          >
            <option value="all">All Status</option>
            <option value="active">Active Only</option>
            <option value="inactive">Inactive Only</option>
          </select>
        </div>
      </div>

      {/* Sellers Data Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
              <tr>
                <th className="px-4 py-3 font-semibold">Seller Profile</th>
                <th className="px-4 py-3 font-semibold">Username / ID</th>
                <th className="px-4 py-3 font-semibold">Phone</th>
                <th className="px-4 py-3 font-semibold">Assigned Branch</th>
                <th className="px-4 py-3 font-semibold text-right">Transactions</th>
                <th className="px-4 py-3 font-semibold text-right">Total Sales</th>
                <th className="px-4 py-3 font-semibold text-center">Status</th>
                <th className="px-4 py-3 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredSellers.map(seller => {
                const assignedBranch = branches.find(b => b.id === seller.branchId);

                return (
                  <tr key={seller.id} className="hover:bg-slate-50/70 transition-colors">
                    {/* Seller Name & Avatar */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-full bg-emerald-100 text-emerald-800 font-bold flex items-center justify-center shrink-0">
                          {seller.fullName.slice(0, 2).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <p className="font-semibold text-slate-900 truncate">{seller.fullName}</p>
                          {seller.email && (
                            <p className="text-[11px] text-slate-500 truncate">{seller.email}</p>
                          )}
                        </div>
                      </div>
                    </td>

                    {/* Username */}
                    <td className="px-4 py-3 font-mono font-medium text-slate-700">
                      @{seller.username}
                    </td>

                    {/* Phone */}
                    <td className="px-4 py-3 text-slate-700 font-mono">
                      {seller.phone || '—'}
                    </td>

                    {/* Branch */}
                    <td className="px-4 py-3 text-slate-700">
                      <div className="flex items-center gap-1.5">
                        <Building2 className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        <span className="truncate">{seller.branchName || assignedBranch?.name || 'Main Branch'}</span>
                      </div>
                    </td>

                    {/* Transactions Count */}
                    <td className="px-4 py-3 text-right font-mono-num font-semibold text-slate-800">
                      {seller.totalSalesCount || 0}
                    </td>

                    {/* Total Sales Volume */}
                    <td className="px-4 py-3 text-right font-mono-num font-bold text-emerald-700">
                      {formatCurrency(seller.totalSalesAmount || 0, lang)}
                    </td>

                    {/* Status Badge */}
                    <td className="px-4 py-3 text-center">
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                          seller.status === 'active'
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : 'bg-rose-50 text-rose-700 border border-rose-200'
                        }`}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full ${seller.status === 'active' ? 'bg-emerald-600' : 'bg-rose-600'}`}></span>
                        {seller.status === 'active' ? 'Active' : 'Inactive'}
                      </span>
                    </td>

                    {/* Actions */}
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <div className="flex items-center justify-end gap-1">
                        {/* View Performance */}
                        <button
                          onClick={() => setViewingSeller(seller)}
                          title="View Performance"
                          className="p-1.5 text-slate-600 hover:text-emerald-700 hover:bg-emerald-50 rounded-lg transition-colors cursor-pointer"
                        >
                          <Eye className="w-4 h-4" />
                        </button>

                        {/* Edit Seller */}
                        <button
                          onClick={() => handleOpenEdit(seller)}
                          title="Edit Seller"
                          className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>

                        {/* Reset Password */}
                        <button
                          onClick={() => handleOpenResetPassword(seller)}
                          title="Reset Password"
                          className="p-1.5 text-slate-600 hover:text-amber-700 hover:bg-amber-50 rounded-lg transition-colors cursor-pointer"
                        >
                          <KeyRound className="w-4 h-4" />
                        </button>

                        {/* Toggle Status */}
                        <button
                          onClick={() => handleToggleStatus(seller)}
                          title={seller.status === 'active' ? 'Deactivate Seller' : 'Activate Seller'}
                          className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                            seller.status === 'active'
                              ? 'text-rose-600 hover:bg-rose-50'
                              : 'text-emerald-600 hover:bg-emerald-50'
                          }`}
                        >
                          {seller.status === 'active' ? (
                            <XCircle className="w-4 h-4" />
                          ) : (
                            <CheckCircle2 className="w-4 h-4" />
                          )}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}

              {filteredSellers.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-400">
                    <Users className="w-8 h-8 mx-auto mb-2 opacity-40" />
                    <p className="font-medium">No sellers matching your filters.</p>
                    <p className="text-[11px] mt-0.5">Click "Add New Seller" to create sales staff accounts.</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal: Add New Seller */}
      {isAddModalOpen && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 w-full max-w-lg overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-4 sm:p-5 border-b border-slate-200 bg-slate-50">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-emerald-600 text-white flex items-center justify-center">
                  <UserPlus className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 text-sm sm:text-base">Add New Seller Account</h3>
                  <p className="text-xs text-slate-500">Provide staff details &amp; secure POS credentials</p>
                </div>
              </div>
              <button
                onClick={() => setIsAddModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleAddSubmit} className="p-4 sm:p-6 space-y-4">
              {formError && (
                <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 text-xs rounded-lg flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                  <span>{formError}</span>
                </div>
              )}

              {formSuccess && (
                <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs rounded-lg flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>{formSuccess}</span>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Full Name */}
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Full Name <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={fullName}
                    onChange={e => setFullName(e.target.value)}
                    placeholder="e.g. Tanvir Hasan"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                  />
                </div>

                {/* Username */}
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Username / Seller ID <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={username}
                    onChange={e => setUsername(e.target.value)}
                    placeholder="e.g. tanvir_pos"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs sm:text-sm font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                  />
                  <p className="text-[10px] text-slate-500 mt-0.5">Used by seller to sign in</p>
                </div>

                {/* Phone */}
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Mobile Number <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={phone}
                    onChange={e => setPhone(e.target.value)}
                    placeholder="017xxxxxxxx"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs sm:text-sm font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                  />
                </div>

                {/* Email (Optional) */}
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Email Address <span className="text-slate-400 font-normal">(Optional)</span>
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="seller@example.com (leave blank for auto-generated)"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                  />
                </div>

                {/* Password */}
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Password <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="password"
                    required
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="Min 6 characters"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                  />
                </div>

                {/* Confirm Password */}
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Confirm Password <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="password"
                    required
                    value={confirmPassword}
                    onChange={e => setConfirmPassword(e.target.value)}
                    placeholder="Re-type password"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                  />
                </div>

                {/* Branch Assignment */}
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Assign to Branch
                  </label>
                  <select
                    value={selectedBranchId}
                    onChange={e => setSelectedBranchId(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs sm:text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                  >
                    {branches.map(b => (
                      <option key={b.id} value={b.id}>
                        {b.name} {b.isMain ? '(Main Branch)' : ''}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Status Toggle */}
                <div className="sm:col-span-2 pt-1 flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-slate-200">
                  <div>
                    <span className="text-xs font-semibold text-slate-800 block">Active Status</span>
                    <span className="text-[11px] text-slate-500">Allow seller to log in and make sales immediately</span>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isActiveStatus}
                      onChange={e => setIsActiveStatus(e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-600"></div>
                  </label>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-4 py-2 border border-slate-200 text-slate-700 rounded-lg text-xs sm:text-sm font-medium hover:bg-slate-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex items-center gap-2 px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs sm:text-sm font-semibold shadow-sm transition-all cursor-pointer disabled:opacity-50"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Creating Seller...</span>
                    </>
                  ) : (
                    <span>Create Seller Account</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Edit Seller */}
      {editingSeller && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between p-4 border-b border-slate-200 bg-slate-50">
              <h3 className="font-bold text-slate-900 text-sm sm:text-base">Edit Seller Details</h3>
              <button
                onClick={() => setEditingSeller(null)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleEditSubmit} className="p-4 sm:p-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Full Name</label>
                <input
                  type="text"
                  required
                  value={editFullName}
                  onChange={e => setEditFullName(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Phone Number</label>
                <input
                  type="text"
                  required
                  value={editPhone}
                  onChange={e => setEditPhone(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs sm:text-sm font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Branch Assignment</label>
                <select
                  value={editBranchId}
                  onChange={e => setEditBranchId(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs sm:text-sm font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                >
                  {branches.map(b => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Status</label>
                <select
                  value={editStatus}
                  onChange={e => setEditStatus(e.target.value as any)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs sm:text-sm font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                >
                  <option value="active">Active (Can log in &amp; sell)</option>
                  <option value="inactive">Inactive (Access suspended)</option>
                </select>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setEditingSeller(null)}
                  className="px-4 py-2 border border-slate-200 text-slate-700 rounded-lg text-xs font-medium hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isUpdating}
                  className="flex items-center gap-2 px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold"
                >
                  {isUpdating ? <Loader2 className="w-4 h-4 animate-spin" /> : <span>Save Changes</span>}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Reset Password */}
      {passwordResetSeller && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between p-4 border-b border-slate-200 bg-slate-50">
              <div className="flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-amber-600" />
                <h3 className="font-bold text-slate-900 text-sm sm:text-base">
                  Reset Password for @{passwordResetSeller.username}
                </h3>
              </div>
              <button
                onClick={() => setPasswordResetSeller(null)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleResetPasswordSubmit} className="p-4 sm:p-6 space-y-4">
              <p className="text-xs text-slate-600">
                Set a new password for seller <strong className="text-slate-900">{passwordResetSeller.fullName}</strong>.
              </p>

              {resetMsg && (
                <div
                  className={`p-3 text-xs rounded-lg flex items-center gap-2 ${
                    resetMsg.type === 'success'
                      ? 'bg-emerald-50 border border-emerald-200 text-emerald-800'
                      : 'bg-rose-50 border border-rose-200 text-rose-800'
                  }`}
                >
                  {resetMsg.type === 'success' ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  ) : (
                    <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                  )}
                  <span>{resetMsg.text}</span>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">New Password</label>
                <input
                  type="password"
                  required
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  placeholder="At least 6 characters"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Confirm New Password</label>
                <input
                  type="password"
                  required
                  value={confirmNewPassword}
                  onChange={e => setConfirmNewPassword(e.target.value)}
                  placeholder="Re-type new password"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setPasswordResetSeller(null)}
                  className="px-4 py-2 border border-slate-200 text-slate-700 rounded-lg text-xs font-medium hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isResettingPass}
                  className="flex items-center gap-2 px-5 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-semibold"
                >
                  {isResettingPass ? <Loader2 className="w-4 h-4 animate-spin" /> : <span>Update Password</span>}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: View Seller Performance */}
      {viewingSeller && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 w-full max-w-lg overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between p-4 sm:p-5 border-b border-slate-200 bg-slate-50">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-emerald-600 text-white font-bold flex items-center justify-center text-sm shadow-sm">
                  {viewingSeller.fullName.slice(0, 2).toUpperCase()}
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 text-sm sm:text-base">{viewingSeller.fullName}</h3>
                  <p className="text-xs text-slate-500 font-mono">@{viewingSeller.username}</p>
                </div>
              </div>
              <button
                onClick={() => setViewingSeller(null)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 sm:p-6 space-y-4">
              {/* Stat Cards */}
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-center">
                  <span className="text-[11px] text-slate-500 font-medium block">Total Transactions</span>
                  <span className="text-xl font-bold text-slate-900 font-mono-num">
                    {viewingSeller.totalSalesCount || 0}
                  </span>
                </div>
                <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-200 text-center">
                  <span className="text-[11px] text-emerald-700 font-medium block">Total Sales Amount</span>
                  <span className="text-xl font-bold text-emerald-800 font-mono-num">
                    {formatCurrency(viewingSeller.totalSalesAmount || 0, lang)}
                  </span>
                </div>
              </div>

              {/* Info Details */}
              <div className="space-y-2 text-xs">
                <div className="flex items-center justify-between py-2 border-b border-slate-100">
                  <span className="text-slate-500 flex items-center gap-1.5">
                    <Phone className="w-3.5 h-3.5" /> Mobile Phone
                  </span>
                  <span className="font-semibold text-slate-800 font-mono">{viewingSeller.phone}</span>
                </div>

                <div className="flex items-center justify-between py-2 border-b border-slate-100">
                  <span className="text-slate-500 flex items-center gap-1.5">
                    <Mail className="w-3.5 h-3.5" /> Email
                  </span>
                  <span className="font-semibold text-slate-800 font-mono">{viewingSeller.email || 'None'}</span>
                </div>

                <div className="flex items-center justify-between py-2 border-b border-slate-100">
                  <span className="text-slate-500 flex items-center gap-1.5">
                    <Building2 className="w-3.5 h-3.5" /> Assigned Branch
                  </span>
                  <span className="font-semibold text-slate-800">{viewingSeller.branchName || 'Main Branch'}</span>
                </div>

                <div className="flex items-center justify-between py-2 border-b border-slate-100">
                  <span className="text-slate-500 flex items-center gap-1.5">
                    <ShieldCheck className="w-3.5 h-3.5" /> Account Status
                  </span>
                  <span
                    className={`font-bold px-2 py-0.5 rounded text-[10px] ${
                      viewingSeller.status === 'active' ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
                    }`}
                  >
                    {viewingSeller.status.toUpperCase()}
                  </span>
                </div>

                <div className="flex items-center justify-between py-2">
                  <span className="text-slate-500">Created On</span>
                  <span className="text-slate-700">{formatDate(viewingSeller.createdAt, lang)}</span>
                </div>
              </div>

              {/* Recent Sales by this seller */}
              <div className="pt-2">
                <h4 className="text-xs font-bold text-slate-800 mb-2">Recent Sales Completed by This Seller</h4>
                <div className="max-h-48 overflow-y-auto space-y-1.5 pr-1">
                  {sales
                    .filter(s => s.sellerId === viewingSeller.id || s.servedBy === viewingSeller.fullName || s.servedBy === viewingSeller.username)
                    .slice(0, 5)
                    .map(sale => (
                      <div
                        key={sale.id}
                        className="flex items-center justify-between p-2 bg-slate-50 hover:bg-slate-100 rounded-lg border border-slate-200 text-xs"
                      >
                        <div>
                          <span className="font-bold font-mono text-slate-900 block">{sale.invoiceNumber}</span>
                          <span className="text-[10px] text-slate-500">{sale.customerName}</span>
                        </div>
                        <div className="text-right">
                          <span className="font-bold text-emerald-700 font-mono-num block">
                            {formatCurrency(sale.total, lang)}
                          </span>
                          <span className="text-[10px] text-slate-500 capitalize">{sale.paymentMethod}</span>
                        </div>
                      </div>
                    ))}

                  {sales.filter(s => s.sellerId === viewingSeller.id || s.servedBy === viewingSeller.fullName || s.servedBy === viewingSeller.username).length === 0 && (
                    <p className="text-slate-400 text-center py-4 text-xs">No sales recorded yet by this seller.</p>
                  )}
                </div>
              </div>

              <div className="pt-3 border-t border-slate-100 flex justify-end">
                <button
                  onClick={() => setViewingSeller(null)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg text-xs font-semibold cursor-pointer"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
