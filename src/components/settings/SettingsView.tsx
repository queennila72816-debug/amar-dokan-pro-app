import React, { useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { APP_IDENTITY } from '../../config/appIdentity';
import { isSupabaseConfigured } from '../../lib/supabase';
import { BusinessType, InvoicePaperSize, LabelTemplateId, PrinterSettings } from '../../types';
import {
  getPrinterSettings,
  getShopLogo,
  savePrinterSettings,
  saveShopLogo,
} from '../../utils/printEngine';
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
} from 'lucide-react';

import { isSalesmanOrCashierRole } from '../../utils/rbacDefaults';

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
    currentUserRole,
    hasPermission,
  } = useApp();
  const canEditSettings = (isAdmin || hasPermission('application_settings', 'edit')) && !isSalesmanOrCashierRole(currentUserRole);

  const [shopName, setShopName] = useState(settings.shopName);
  const [tagline, setTagline] = useState(settings.tagline);
  const [address, setAddress] = useState(settings.address);
  const [mobile, setMobile] = useState(settings.mobile);
  const [email, setEmail] = useState(settings.email);
  const [logoUrl, setLogoUrl] = useState<string>(() => getShopLogo(settings, activeBusinessId));
  const [vatTaxRate, setVatTaxRate] = useState<number>(settings.vatTaxRate);
  const [vatRegistrationNo, setVatRegistrationNo] = useState<string>(settings.vatRegistrationNo || '');
  const [invoiceFormat, setInvoiceFormat] = useState<InvoicePaperSize>(settings.invoiceFormat || 'thermal');
  const [businessType, setBusinessType] = useState<BusinessType>(settings.businessType);

  const [printerSettings, setPrinterSettings] = useState<PrinterSettings>(() =>
    getPrinterSettings(settings)
  );

  const [savedNotice, setSavedNotice] = useState(false);

  useEffect(() => {
    setShopName(settings.shopName);
    setTagline(settings.tagline);
    setAddress(settings.address);
    setMobile(settings.mobile);
    setEmail(settings.email);
    setLogoUrl(getShopLogo(settings, activeBusinessId));
    setVatTaxRate(settings.vatTaxRate);
    setVatRegistrationNo(settings.vatRegistrationNo || '');
    setInvoiceFormat(settings.invoiceFormat || 'thermal');
    setBusinessType(settings.businessType);
    setPrinterSettings(getPrinterSettings(settings));
  }, [settings, activeBusinessId]);

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!shopName.trim() || !mobile.trim() || !address.trim()) {
      alert('Shop name, business phone, and address are required.');
      return;
    }
    const cleanVat = Number(vatTaxRate);
    if (!Number.isFinite(cleanVat) || cleanVat < 0 || cleanVat > 100) {
      alert('VAT / Tax rate must be between 0% and 100%.');
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
        tagline: tagline.trim(),
        address: address.trim(),
        mobile: mobile.trim(),
        email: email.trim(),
        logoUrl,
        vatTaxRate: cleanVat,
        vatRegistrationNo: vatRegistrationNo.trim(),
        invoiceFormat,
        businessType,
        printerSettings: syncedPrinter,
      });
      setPrinterSettings(syncedPrinter);
      setSavedNotice(true);
      setTimeout(() => setSavedNotice(false), 3000);
    } catch (err: any) {
      alert(err?.message || 'Failed to save settings to database.');
    }
  };

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 1024 * 1024 * 2) {
      alert('Please select a logo image smaller than 2MB.');
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

  const handleDownloadBackup = () => {
    const jsonStr = backupData();
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `amar-dokan-backup-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
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
          alert('Backup restored successfully!');
        } else {
          alert('Invalid backup JSON file!');
        }
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <span className="p-1.5 rounded-[8px] bg-[#087F8C]/15 text-[#087F8C]">
              <Settings className="w-5 h-5" />
            </span>
            <span>{'Shop Settings & System'}</span>
          </h2>
          <p className="text-xs text-slate-600 mt-0.5">
            {'Configure business details, logo, VAT, printer & label layout, and backups'}
          </p>
        </div>

        {savedNotice && (
          <span className="flex items-center gap-1 text-xs font-bold text-emerald-700 bg-emerald-50 px-3 py-1.5 rounded-lg border border-emerald-200">
            <CheckCircle2 className="w-4 h-4" />
            <span>{'Settings Saved!'}</span>
          </span>
        )}
      </div>

      {/* Profile + Printer Settings Form */}
      <form onSubmit={handleSaveSettings} className="bg-white rounded-xl border border-slate-200 shadow-xs p-5 space-y-5 text-xs">
        <h3 className="text-sm font-bold text-slate-900 pb-2 border-b">
          {'1. Business Profile & Invoice Header'}
        </h3>

        {/* Fixed Software / Application Identity (Read-Only) */}
        <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-start gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0 mt-0.5">
              <Lock className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  Application Identity (Fixed Software Brand)
                </span>
                <span className="text-[10px] font-semibold bg-slate-200 text-slate-700 px-1.5 py-0.5 rounded">
                  Read-Only
                </span>
              </div>
              <div className="text-sm font-bold text-slate-900 mt-0.5">
                {APP_IDENTITY.name}
                <span className="text-xs font-medium text-slate-500 ml-2">
                  · {APP_IDENTITY.subtitle}
                </span>
              </div>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Software branding stays permanently fixed and is completely independent from your editable shop profile below.
              </p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block font-medium text-slate-700 mb-1">{'Shop / Business Name *'}</label>
            <input
              type="text"
              required
              value={shopName}
              onChange={(e) => setShopName(e.target.value)}
              placeholder="e.g. Style Zone & Accessories"
              className="w-full p-2 border border-slate-200 rounded-lg font-medium"
            />
          </div>

          <div>
            <label className="block font-medium text-slate-700 mb-1">{'Business Tagline'}</label>
            <input
              type="text"
              value={tagline}
              onChange={(e) => setTagline(e.target.value)}
              placeholder="e.g. Quality Fashion & Lifestyle Store"
              className="w-full p-2 border border-slate-200 rounded-lg"
            />
          </div>

          <div>
            <label className="block font-medium text-slate-700 mb-1">{'Business Phone *'}</label>
            <input
              type="text"
              required
              value={mobile}
              onChange={(e) => setMobile(e.target.value)}
              className="w-full p-2 border border-slate-200 rounded-lg font-mono"
            />
          </div>

          <div>
            <label className="block font-medium text-slate-700 mb-1">{'Business Email'}</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full p-2 border border-slate-200 rounded-lg"
            />
          </div>

          <div className="md:col-span-2">
            <label className="block font-medium text-slate-700 mb-1">{'Business Address *'}</label>
            <input
              type="text"
              required
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="w-full p-2 border border-slate-200 rounded-lg"
            />
          </div>

          {/* Business Logo Upload / URL */}
          <div className="md:col-span-2 p-3 bg-slate-50 border border-slate-200 rounded-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-14 h-14 rounded-lg bg-white border border-slate-200 flex items-center justify-center overflow-hidden shrink-0">
                {logoUrl ? (
                  <img src={logoUrl} alt="Business Logo" className="max-w-full max-h-full object-contain" />
                ) : (
                  <ImageIcon className="w-6 h-6 text-slate-300" />
                )}
              </div>
              <div>
                <div className="font-bold text-slate-800">Business Logo (Dashboard, Invoices, Statements &amp; Labels)</div>
                <p className="text-[11px] text-slate-500">Upload your shop logo (PNG/JPG) or clear for text-only business headers.</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <label className="px-3 py-1.5 bg-white hover:bg-slate-100 border border-slate-300 rounded-lg font-semibold text-slate-700 cursor-pointer">
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
                  className="p-1.5 text-rose-600 hover:bg-rose-50 border border-rose-200 rounded-lg cursor-pointer"
                  title="Remove Logo"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        </div>

        <h3 className="text-sm font-bold text-slate-900 pt-3 pb-2 border-b">
          {'2. POS & Invoice Configuration'}
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label className="block font-medium text-slate-700 mb-1">{'VAT/Tax Rate (%)'}</label>
            <input
              type="number"
              min="0"
              max="100"
              value={vatTaxRate}
              onChange={(e) => setVatTaxRate(Number(e.target.value) || 0)}
              className="w-full p-2 border border-slate-200 rounded-lg font-mono-num"
            />
          </div>

          <div>
            <label className="block font-medium text-slate-700 mb-1">{'VAT / Tax / BIN No.'}</label>
            <input
              type="text"
              value={vatRegistrationNo}
              onChange={(e) => setVatRegistrationNo(e.target.value)}
              placeholder="e.g. BIN-001234567-0101"
              className="w-full p-2 border border-slate-200 rounded-lg font-mono"
            />
          </div>

          <div>
            <label className="block font-medium text-slate-700 mb-1">{'Default Invoice Paper Size'}</label>
            <select
              aria-label={'Invoice Format'}
              value={invoiceFormat}
              onChange={(e) => {
                const nextFmt = e.target.value as InvoicePaperSize;
                setInvoiceFormat(nextFmt);
                setPrinterSettings(prev => ({ ...prev, invoicePaperSize: nextFmt }));
              }}
              className="w-full p-2 border border-slate-200 rounded-lg bg-white"
            >
              <option value="thermal">{'Thermal Receipt (80mm)'}</option>
              <option value="a5">{'A5 Half Page'}</option>
              <option value="a4">{'A4 Full Invoice'}</option>
            </select>
          </div>

          <div>
            <label className="block font-medium text-slate-700 mb-1">{'Business Category'}</label>
            <select
              aria-label={'Business Category'}
              value={businessType}
              onChange={(e) => setBusinessType(e.target.value as BusinessType)}
              className="w-full p-2 border border-slate-200 rounded-lg bg-white"
            >
              <option value="clothing">{'Clothing'}</option>
              <option value="grocery">{'Grocery'}</option>
              <option value="electronics">{'Electronics'}</option>
              <option value="pharmacy">{'Pharmacy'}</option>
              <option value="general">{'General'}</option>
            </select>
          </div>
        </div>

        {/* Printer & Label Layout Settings (Admin Configurable) */}
        <div className="pt-3 space-y-4">
          <div className="flex items-center justify-between pb-2 border-b">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Printer className="w-4 h-4 text-emerald-600" />
              <span>{'2B. Printer & Barcode Label Layout Settings'}</span>
            </h3>
            {!canEditSettings && (
              <span className="text-[11px] bg-amber-50 text-amber-800 border border-amber-200 px-2 py-0.5 rounded font-semibold">
                Admin Only
              </span>
            )}
          </div>

          <fieldset disabled={!canEditSettings} className="space-y-4 disabled:opacity-60">
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <div>
                <label className="block font-medium text-slate-700 mb-1">Invoice Orientation</label>
                <select
                  value={printerSettings.invoiceOrientation}
                  onChange={(e) =>
                    setPrinterSettings({
                      ...printerSettings,
                      invoiceOrientation: e.target.value as 'portrait' | 'landscape',
                    })
                  }
                  className="w-full p-2 border border-slate-200 rounded-lg bg-white"
                >
                  <option value="portrait">Portrait</option>
                  <option value="landscape">Landscape</option>
                </select>
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">Invoice Margin (mm)</label>
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
                  className="w-full p-2 border border-slate-200 rounded-lg font-mono-num"
                />
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">Invoice Font Size</label>
                <select
                  value={printerSettings.invoiceFontSize}
                  onChange={(e) =>
                    setPrinterSettings({
                      ...printerSettings,
                      invoiceFontSize: e.target.value as 'small' | 'medium' | 'large',
                    })
                  }
                  className="w-full p-2 border border-slate-200 rounded-lg bg-white"
                >
                  <option value="small">Small (Compact)</option>
                  <option value="medium">Medium (Standard)</option>
                  <option value="large">Large (Readable)</option>
                </select>
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">Default Label Template</label>
                <select
                  value={printerSettings.labelTemplate}
                  onChange={(e) =>
                    setPrinterSettings({
                      ...printerSettings,
                      labelTemplate: e.target.value as LabelTemplateId,
                    })
                  }
                  className="w-full p-2 border border-slate-200 rounded-lg bg-white"
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

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <label className="block font-medium text-slate-700 mb-1">Custom Label Width (mm)</label>
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
                  className="w-full p-2 border border-slate-200 rounded-lg font-mono-num"
                />
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">Custom Label Height (mm)</label>
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
                  className="w-full p-2 border border-slate-200 rounded-lg font-mono-num"
                />
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">Label Orientation</label>
                <select
                  value={printerSettings.labelOrientation}
                  onChange={(e) =>
                    setPrinterSettings({
                      ...printerSettings,
                      labelOrientation: e.target.value as 'portrait' | 'landscape',
                    })
                  }
                  className="w-full p-2 border border-slate-200 rounded-lg bg-white"
                >
                  <option value="portrait">Portrait (Standard Roll)</option>
                  <option value="landscape">Landscape</option>
                </select>
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">Label Margin (mm)</label>
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
                  className="w-full p-2 border border-slate-200 rounded-lg font-mono-num"
                />
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">A4 Labels Per Row</label>
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
                  className="w-full p-2 border border-slate-200 rounded-lg font-mono-num"
                />
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">Gap Horizontal / Vertical (mm)</label>
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
                    className="w-1/2 p-2 border border-slate-200 rounded-lg font-mono-num"
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
                    className="w-1/2 p-2 border border-slate-200 rounded-lg font-mono-num"
                    title="Vertical gap (mm)"
                  />
                </div>
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">Barcode Height (px)</label>
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
                  className="w-full p-2 border border-slate-200 rounded-lg font-mono-num"
                />
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">Label Font Size</label>
                <select
                  value={printerSettings.labelFontSize}
                  onChange={(e) =>
                    setPrinterSettings({
                      ...printerSettings,
                      labelFontSize: e.target.value as 'small' | 'medium' | 'large',
                    })
                  }
                  className="w-full p-2 border border-slate-200 rounded-lg bg-white"
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
              <span className="font-medium text-slate-700">
                Show 100% Actual-Size / Margins: None / Save-as-PDF calibration guidance in Print Preview
              </span>
            </label>

            <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl text-blue-900 text-[11px] flex items-start gap-2">
              <Info className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
              <span>
                Thermal printers (80mm POS receipt or 30×20 / 40×30 / 50×25 / 50×30mm label printers) require matching paper dimensions configured in your OS printer driver preferences and <strong>Scale: 100%</strong> in the browser print dialog.
              </span>
            </div>
          </fieldset>
        </div>

        <div className="flex justify-end pt-3 border-t">
          <button
            type="submit"
            className="flex items-center gap-2 px-5 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg shadow-xs transition-colors cursor-pointer"
          >
            <Save className="w-4 h-4" />
            <span>{'Save Changes'}</span>
          </button>
        </div>
      </form>

      {/* Backup, Restore & Reset Section */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs p-5 space-y-4 text-xs">
        <h3 className="text-sm font-bold text-slate-900 pb-2 border-b">
          {'3. Data Backup & Recovery'}
        </h3>

        <p className="text-slate-600">
          {'Download an encrypted JSON backup file of all products, stock, sales, and accounts.'}
        </p>

        <div className="flex flex-wrap items-center gap-3 pt-1">
          <button
            onClick={handleDownloadBackup}
            className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-lg font-semibold transition-colors shadow-xs"
          >
            <Download className="w-4 h-4" />
            <span>{'Download Backup'}</span>
          </button>

          <label className="flex items-center gap-2 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg font-semibold transition-colors border border-slate-200 cursor-pointer">
            <Upload className="w-4 h-4" />
            <span>{'Restore from JSON'}</span>
            <input
              type="file"
              accept=".json"
              onChange={handleRestoreFile}
              className="hidden"
            />
          </label>

          <button
            onClick={() => {
              if (confirm('Reset to initial demo data?')) {
                resetToDemoData();
                alert('Demo data reset successfully.');
              }
            }}
            className="flex items-center gap-2 px-4 py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 rounded-lg font-semibold transition-colors border border-rose-200 ml-auto"
          >
            <RotateCcw className="w-4 h-4" />
            <span>{'Reset to Demo Data'}</span>
          </button>
        </div>
      </div>

      {/* Cloud Database & Legacy Data Migration Section */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs p-5 space-y-4 text-xs">
        <h3 className="text-sm font-bold text-slate-900 pb-2 border-b flex items-center gap-2">
          <Database className="w-4 h-4 text-emerald-600" />
          <span>{'Cloud Database & Safe Migration'}</span>
        </h3>

        <div className="space-y-2 text-slate-600">
          {!isSupabaseConfigured ? (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-900 space-y-1">
              <div className="font-bold">Temporary Local Browser Storage Mode Active</div>
              <p className="text-[11px] leading-relaxed">
                Supabase environment variables (<code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code>) are not configured. Data entered now is saved temporarily in this browser&apos;s localStorage and will not sync across devices until Supabase is connected.
              </p>
            </div>
          ) : (
            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-900 font-semibold">
              Connected to Supabase Cloud Database
            </div>
          )}
          <div className="flex items-center gap-2">
            <span className="font-semibold text-slate-800">Account:</span>
            <span>{user ? user.email : 'Local Browser Session (Temporary)'}</span>
          </div>
          {activeBusinessId && (
            <div className="flex items-center gap-2">
              <span className="font-semibold text-slate-800">Business ID:</span>
              <span className="font-mono text-[11px] bg-slate-100 px-2 py-0.5 rounded">{activeBusinessId}</span>
            </div>
          )}
          <p>
            If you have existing offline store items, you can safely sync them to your cloud business database once Supabase is connected.
          </p>
        </div>

        <div className="pt-2">
          <button
            type="button"
            onClick={() => migrateLegacyData()}
            disabled={!isSupabaseConfigured || isMigrated}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-semibold transition-colors shadow-xs disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
          >
            <CloudUpload className="w-4 h-4" />
            <span>
              {!isSupabaseConfigured
                ? 'Connect Supabase to Enable Cloud Sync'
                : isMigrated
                ? 'Data Synced with Cloud'
                : 'Sync Local Store to Cloud Database'}
            </span>
          </button>
        </div>
      </div>

      {/* Role & Permissions Guide */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs p-5 space-y-3 text-xs">
        <h3 className="text-sm font-bold text-slate-900 pb-2 border-b flex items-center gap-2">
          <Shield className="w-4 h-4 text-emerald-600" />
          <span>{'4. Role & Permissions Guide'}</span>
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="p-3 bg-slate-50 rounded-lg border">
            <span className="font-bold text-slate-900 block">👑 Owner / Admin</span>
            <p className="text-slate-600 mt-1">Full access to all modules (Dashboard, Sales, Purchases, Profits, Settings &amp; Backup).</p>
          </div>
          <div className="p-3 bg-slate-50 rounded-lg border">
            <span className="font-bold text-slate-900 block">🧑💻 Salesman</span>
            <p className="text-slate-600 mt-1">Access to POS, Customers, and Invoices. Sensitive financial and report data is hidden.</p>
          </div>
          <div className="p-3 bg-slate-50 rounded-lg border">
            <span className="font-bold text-slate-900 block">📦 Storekeeper</span>
            <p className="text-slate-600 mt-1">Manage product catalog, stock adjustments, and inter-branch inventory transfers.</p>
          </div>
        </div>
      </div>
    </div>
  );
};
