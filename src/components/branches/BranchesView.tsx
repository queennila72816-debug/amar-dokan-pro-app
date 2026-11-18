import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { Branch } from '../../types';
import { toBnNumber } from '../../utils/formatters';
import {
  GitFork,
  Plus,
  Building2,
  MapPin,
  Phone,
  CheckCircle2,
  X,
  Trash2,
} from 'lucide-react';

export const BranchesView: React.FC = () => {
  const { branches, addBranch, deleteBranch, activeBranchId, setActiveBranchId, settings, isAdmin } = useApp();
  const isBn = false;

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [mobile, setMobile] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting || !name.trim() || !location.trim()) return;

    setIsSubmitting(true);
    try {
      await addBranch({
        name: name.trim(),
        location: location.trim(),
        mobile: mobile.trim() || settings.mobile,
        isMain: branches.length === 0,
      });

      setIsModalOpen(false);
      setName('');
      setLocation('');
      setMobile('');
    } catch (err: any) {
      alert(`Failed to create branch: ${err.message || 'Database error'}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <Building2 className="w-5 h-5 text-emerald-600" />
            <span>{'Multi-Branch & Warehouse Management'}</span>
          </h2>
          <p className="text-xs text-slate-600 mt-0.5">
            {'Centralized multi-outlet & warehouse management'}
          </p>
        </div>

        <button
          onClick={() => setIsModalOpen(true)}
          className="flex items-center gap-2 px-3.5 py-2 text-xs md:text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg shadow-xs transition-colors self-start md:self-auto cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>{'Add New Branch'}</span>
        </button>
      </div>

      {/* Branches Grid or Empty State */}
      {branches.length === 0 ? (
        <div className="bg-white rounded-2xl border-2 border-dashed border-slate-200 p-8 text-center space-y-3">
          <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto">
            <Building2 className="w-6 h-6" />
          </div>
          <div>
            <h3 className="font-bold text-slate-900 text-sm">No Branches Configured</h3>
            <p className="text-xs text-slate-500 max-w-sm mx-auto mt-0.5">
              Click "Add New Branch" to register your store location or warehouse.
            </p>
          </div>
          <button
            onClick={() => setIsModalOpen(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl shadow-sm transition-all cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Add Store Branch</span>
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {branches.map(branch => {
            const isActive = branch.id === activeBranchId;
            return (
              <div
                key={branch.id}
                className={`p-5 rounded-2xl border transition-all ${
                  isActive
                    ? 'bg-emerald-50/40 border-emerald-300 ring-1 ring-emerald-400'
                    : 'bg-white border-slate-200 hover:border-slate-300'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-bold text-slate-900 text-sm flex items-center gap-1.5">
                      <span>{branch.name}</span>
                      {branch.isMain && (
                        <span className="text-[10px] bg-emerald-100 text-emerald-800 px-1.5 py-0.2 rounded font-medium">
                          {'Main'}
                        </span>
                      )}
                    </h3>
                    <p className="text-xs text-slate-500 mt-1 flex items-center gap-1">
                      <MapPin className="w-3.5 h-3.5" />
                      <span>{branch.location}</span>
                    </p>
                    <p className="text-xs text-slate-500 mt-0.5 flex items-center gap-1 font-mono">
                      <Phone className="w-3.5 h-3.5" />
                      <span>{branch.mobile}</span>
                    </p>
                  </div>

                  <div className="flex items-center gap-1">
                    {isActive && (
                      <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                    )}
                    {isAdmin && !branch.isMain && branches.length > 1 && (
                      <button
                        onClick={async () => {
                          if (confirm(`Delete branch "${branch.name}"?`)) {
                            const res = await deleteBranch(branch.id);
                            if (!res.success) alert(res.message);
                          }
                        }}
                        className="p-1 text-slate-400 hover:text-rose-600 rounded transition-colors"
                        title="Delete Branch"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between">
                  <span className="text-xs text-slate-500">
                    {isActive ? ('Active Outlet') : ('Inactive')}
                  </span>

                  {!isActive && (
                    <button
                      onClick={() => setActiveBranchId(branch.id)}
                      className="px-3 py-1 bg-slate-800 hover:bg-slate-900 text-white text-xs font-semibold rounded-lg transition-colors cursor-pointer"
                    >
                      {'Switch Branch'}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add Branch Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <form
            onSubmit={handleSubmit}
            className="bg-white rounded-2xl shadow-xl border border-slate-200 w-full max-w-md p-5 space-y-4"
          >
            <div className="flex items-center justify-between border-b pb-2">
              <h3 className="font-bold text-sm text-slate-900">
                {'Add New Branch / Outlet'}
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
                <label className="block font-medium text-slate-700 mb-1">{'Branch Name *'}</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Uttara Outlet (Branch 03)"
                  className="w-full p-2 border border-slate-200 rounded-lg"
                />
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">{'Location *'}</label>
                <input
                  type="text"
                  required
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="e.g. Sector-7, Uttara, Dhaka"
                  className="w-full p-2 border border-slate-200 rounded-lg"
                />
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">{'Contact Mobile'}</label>
                <input
                  type="text"
                  value={mobile}
                  onChange={(e) => setMobile(e.target.value)}
                  placeholder="017xxxxxxxx"
                  className="w-full p-2 border border-slate-200 rounded-lg font-mono"
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
                className="px-4 py-1.5 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 rounded-lg cursor-pointer"
              >
                {isSubmitting ? 'Creating...' : 'Create Branch'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
