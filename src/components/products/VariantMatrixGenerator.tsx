import React, { useState } from 'react';
import { ProductVariant } from '../../types';
import { generateClothingSku, generateUniqueEan13Barcode } from '../../utils/barcodeGenerator';
import { inferColorHex } from '../../utils/productImageResolver';
import {
  Grid,
  Plus,
  Trash2,
  Sparkles,
  Check,
  X,
  Layers,
  Barcode,
  Sliders,
  RotateCcw,
} from 'lucide-react';

interface VariantMatrixGeneratorProps {
  productName: string;
  category: string;
  basePurchasePrice: number;
  baseSalePrice: number;
  variants: ProductVariant[];
  onChange: (variants: ProductVariant[]) => void;
  existingBarcodes?: Set<string>;
}

const PRESET_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'Free Size'];
const PRESET_COLORS = [
  { name: 'Black', hex: '#000000' },
  { name: 'White', hex: '#ffffff' },
  { name: 'Navy Blue', hex: '#1e3a8a' },
  { name: 'Royal Blue', hex: '#2563eb' },
  { name: 'Red', hex: '#dc2626' },
  { name: 'Maroon', hex: '#831843' },
  { name: 'Olive Green', hex: '#3f6212' },
  { name: 'Forest Green', hex: '#14532d' },
  { name: 'Grey', hex: '#64748b' },
  { name: 'Charcoal', hex: '#334155' },
  { name: 'Beige', hex: '#d4b996' },
  { name: 'Pink', hex: '#f472b6' },
];

export const VariantMatrixGenerator: React.FC<VariantMatrixGeneratorProps> = ({
  productName,
  category,
  basePurchasePrice,
  baseSalePrice,
  variants,
  onChange,
  existingBarcodes,
}) => {
  // Selected sizes & colors for quick matrix generation
  const [selectedSizes, setSelectedSizes] = useState<string[]>(['M', 'L', 'XL']);
  const [selectedColors, setSelectedColors] = useState<string[]>(['Black', 'White', 'Navy Blue']);
  const [customSizeInput, setCustomSizeInput] = useState('');
  const [customColorInput, setCustomColorInput] = useState('');
  const [defaultStockQty, setDefaultStockQty] = useState<number>(5);
  const [matrixError, setMatrixError] = useState<string | null>(null);

  // Toggle size selection
  const toggleSize = (size: string) => {
    setSelectedSizes(prev =>
      prev.includes(size) ? prev.filter(s => s !== size) : [...prev, size]
    );
  };

  // Add custom size
  const handleAddCustomSize = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = customSizeInput.trim().toUpperCase();
    if (clean && !selectedSizes.includes(clean)) {
      setSelectedSizes(prev => [...prev, clean]);
      setCustomSizeInput('');
    }
  };

  // Toggle color selection
  const toggleColor = (colorName: string) => {
    setSelectedColors(prev =>
      prev.includes(colorName) ? prev.filter(c => c !== colorName) : [...prev, colorName]
    );
  };

  // Add custom color
  const handleAddCustomColor = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = customColorInput.trim();
    if (clean && !selectedColors.includes(clean)) {
      setSelectedColors(prev => [...prev, clean]);
      setCustomColorInput('');
    }
  };

  const buildUsedBarcodeSet = (excludeVariantId?: string): Set<string> => {
    const used = new Set<string>(existingBarcodes ? Array.from(existingBarcodes) : []);
    variants.forEach(v => {
      if (v.id !== excludeVariantId && v.barcode) {
        used.add(v.barcode.trim().toLowerCase());
      }
    });
    return used;
  };

  // 1-Click Generate Combinations Matrix
  const handleGenerateMatrix = () => {
    if (selectedSizes.length === 0 || selectedColors.length === 0) {
      setMatrixError('Please select at least one Size and one Color before generating the matrix.');
      return;
    }
    setMatrixError(null);

    const usedCodes = new Set<string>(existingBarcodes ? Array.from(existingBarcodes) : []);
    const generated: ProductVariant[] = [];
    let count = 1;

    selectedColors.forEach(color => {
      selectedSizes.forEach(size => {
        const sku = generateClothingSku(productName || 'APPAR', category || 'CLOTH', color, size);
        const barcode = generateUniqueEan13Barcode(usedCodes, '894');
        usedCodes.add(barcode.toLowerCase());

        generated.push({
          id: `var-${Date.now()}-${count++}`,
          color,
          colorHex: inferColorHex(color),
          size,
          sku,
          barcode,
          stock: defaultStockQty,
          purchasePrice: basePurchasePrice > 0 ? basePurchasePrice : undefined,
          salePrice: baseSalePrice > 0 ? baseSalePrice : undefined,
          minStockAlert: 5,
          status: 'active',
        });
      });
    });

    onChange(generated);
  };

  // Add a single blank variant row manually
  const handleAddSingleRow = () => {
    setMatrixError(null);
    const count = variants.length + 1;
    const sku = `${productName.slice(0, 3).toUpperCase() || 'PRD'}-VAR-${count}`;
    const usedCodes = buildUsedBarcodeSet();
    const barcode = generateUniqueEan13Barcode(usedCodes, '894');
    const newVar: ProductVariant = {
      id: `var-${Date.now()}-${count}`,
      color: '',
      size: '',
      sku,
      barcode,
      stock: 5,
      purchasePrice: basePurchasePrice > 0 ? basePurchasePrice : undefined,
      salePrice: baseSalePrice > 0 ? baseSalePrice : undefined,
      minStockAlert: 5,
      status: 'active',
    };
    onChange([...variants, newVar]);
  };

  // Remove a variant row
  const handleRemoveRow = (id: string) => {
    onChange(variants.filter(v => v.id !== id));
  };

  // Update a specific variant field
  const handleUpdateRow = (id: string, updates: Partial<ProductVariant>) => {
    onChange(variants.map(v => (v.id === id ? { ...v, ...updates } : v)));
  };

  const handleRegenerateVariantBarcode = (id: string) => {
    const usedCodes = buildUsedBarcodeSet(id);
    const nextBarcode = generateUniqueEan13Barcode(usedCodes, '894');
    handleUpdateRow(id, { barcode: nextBarcode });
  };

  // Calculate total matrix stock
  const totalStock = variants.reduce((sum, v) => sum + (Number(v.stock) || 0), 0);

  return (
    <div className="space-y-4 p-4 bg-slate-50 border border-slate-200 rounded-2xl">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-200">
        <div>
          <h3 className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
            <Sparkles className="w-4 h-4 text-purple-600" />
            <span>Apparel Size &amp; Color Matrix Generator</span>
          </h3>
          <p className="text-[11px] text-slate-500">
            Select sizes and colors to generate all unique SKUs, barcodes, and inventory records.
          </p>
        </div>

        <div className="text-right">
          <span className="text-[10px] text-slate-400 block">Total Combined Stock</span>
          <span className="text-xs font-bold text-emerald-700 font-mono-num">
            {totalStock} pcs ({variants.length} Variants)
          </span>
        </div>
      </div>

      {/* Matrix Setup Controls */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Sizes Selector */}
        <div className="space-y-2 bg-white p-3 rounded-xl border border-slate-200">
          <label className="text-xs font-semibold text-slate-700 block">1. Select Clothing Sizes</label>
          <div className="flex flex-wrap gap-1.5">
            {PRESET_SIZES.map(s => {
              const isSelected = selectedSizes.includes(s);
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => toggleSize(s)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-mono font-bold transition-all cursor-pointer ${
                    isSelected
                      ? 'bg-purple-600 text-white shadow-xs'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {s}
                </button>
              );
            })}
          </div>

          {/* Custom Size Form */}
          <div className="flex items-center gap-1 pt-1">
            <input
              type="text"
              value={customSizeInput}
              onChange={e => setCustomSizeInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleAddCustomSize(e);
                }
              }}
              placeholder="+ Custom size (e.g. 38, 40)"
              className="px-2 py-1 text-xs border border-slate-300 rounded-lg flex-1"
            />
            <button
              type="button"
              onClick={handleAddCustomSize}
              className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-lg cursor-pointer"
            >
              Add
            </button>
          </div>
        </div>

        {/* Colors Selector */}
        <div className="space-y-2 bg-white p-3 rounded-xl border border-slate-200">
          <label className="text-xs font-semibold text-slate-700 block">2. Select Apparel Colors</label>
          <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
            {PRESET_COLORS.map(c => {
              const isSelected = selectedColors.includes(c.name);
              return (
                <button
                  key={c.name}
                  type="button"
                  onClick={() => toggleColor(c.name)}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                    isSelected
                      ? 'bg-purple-600 text-white shadow-xs'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  <span
                    className="w-2.5 h-2.5 rounded-full border border-black/20"
                    style={{ backgroundColor: c.hex }}
                  />
                  <span>{c.name}</span>
                </button>
              );
            })}
          </div>

          {/* Custom Color Form */}
          <div className="flex items-center gap-1 pt-1">
            <input
              type="text"
              value={customColorInput}
              onChange={e => setCustomColorInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleAddCustomColor(e);
                }
              }}
              placeholder="+ Custom color name"
              className="px-2 py-1 text-xs border border-slate-300 rounded-lg flex-1"
            />
            <button
              type="button"
              onClick={handleAddCustomColor}
              className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-lg cursor-pointer"
            >
              Add
            </button>
          </div>
        </div>
      </div>

      {/* Action Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-purple-50/60 p-3 rounded-xl border border-purple-200">
        <div className="flex items-center gap-3">
          <label className="text-xs text-purple-900 font-semibold flex items-center gap-1.5">
            <span>Default Starting Stock per Variant:</span>
            <input
              type="number"
              min="0"
              max="500"
              value={defaultStockQty}
              onChange={e => setDefaultStockQty(Math.max(0, parseInt(e.target.value) || 0))}
              className="w-14 px-2 py-1 bg-white border border-purple-300 rounded-lg text-xs font-bold text-center"
            />
          </label>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleGenerateMatrix}
            className="flex items-center gap-1.5 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold rounded-xl shadow-xs cursor-pointer transition-colors"
          >
            <Grid className="w-4 h-4" />
            <span>Generate Matrix ({selectedSizes.length * selectedColors.length} Variants)</span>
          </button>
          <button
            type="button"
            onClick={handleAddSingleRow}
            className="px-3 py-2 bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 text-xs font-semibold rounded-xl cursor-pointer"
          >
            + Single Row
          </button>
        </div>
      </div>

      {matrixError && (
        <div className="px-3 py-2 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold">
          {matrixError}
        </div>
      )}

      {/* Generated Variants Table */}
      {variants.length > 0 ? (
        <div className="overflow-x-auto max-h-72 overflow-y-auto border border-slate-200 rounded-xl bg-white">
          <table className="w-full text-left text-xs border-collapse">
            <thead className="bg-slate-50 sticky top-0 z-10 border-b border-slate-200 text-slate-600 font-semibold">
              <tr>
                <th className="py-2 px-2.5">Color</th>
                <th className="py-2 px-2.5">Size</th>
                <th className="py-2 px-2.5">SKU</th>
                <th className="py-2 px-2.5">Barcode</th>
                <th className="py-2 px-2.5 w-20">Stock</th>
                <th className="py-2 px-2.5 w-24">Sale Price</th>
                <th className="py-2 px-2.5 w-24">Cost</th>
                <th className="py-2 px-2 w-8"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {variants.map(v => (
                <tr key={v.id} className="hover:bg-slate-50">
                  <td className="py-1.5 px-2.5">
                    <input
                      type="text"
                      value={v.color || ''}
                      onChange={e => handleUpdateRow(v.id, { color: e.target.value })}
                      className="w-24 px-2 py-1 text-xs border border-slate-200 rounded font-medium"
                    />
                  </td>
                  <td className="py-1.5 px-2.5">
                    <input
                      type="text"
                      value={v.size || ''}
                      onChange={e => handleUpdateRow(v.id, { size: e.target.value })}
                      className="w-16 px-2 py-1 text-xs border border-slate-200 rounded font-mono font-bold text-center"
                    />
                  </td>
                  <td className="py-1.5 px-2.5">
                    <input
                      type="text"
                      value={v.sku}
                      onChange={e => handleUpdateRow(v.id, { sku: e.target.value })}
                      className="w-32 px-2 py-1 text-xs border border-slate-200 rounded font-mono"
                    />
                  </td>
                  <td className="py-1.5 px-2.5">
                    <div className="flex items-center gap-1">
                      <input
                        type="text"
                        value={v.barcode || ''}
                        onChange={e => handleUpdateRow(v.id, { barcode: e.target.value })}
                        className="w-28 px-2 py-1 text-xs border border-slate-200 rounded font-mono text-[11px]"
                      />
                      <button
                        type="button"
                        onClick={() => handleRegenerateVariantBarcode(v.id)}
                        title="Generate unique EAN-13 barcode for this variant"
                        className="p-1 rounded border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-600 cursor-pointer shrink-0"
                      >
                        <RotateCcw className="w-3 h-3" />
                      </button>
                    </div>
                  </td>
                  <td className="py-1.5 px-2.5">
                    <input
                      type="number"
                      min="0"
                      value={v.stock}
                      onChange={e => handleUpdateRow(v.id, { stock: Math.max(0, parseInt(e.target.value) || 0) })}
                      className="w-16 px-2 py-1 text-xs border border-slate-200 rounded text-center font-bold"
                    />
                  </td>
                  <td className="py-1.5 px-2.5">
                    <input
                      type="number"
                      min="0"
                      value={v.salePrice !== undefined ? v.salePrice : (baseSalePrice > 0 ? baseSalePrice : '')}
                      onChange={e =>
                        handleUpdateRow(v.id, {
                          salePrice: e.target.value === '' ? undefined : Math.max(0, Number(e.target.value)),
                        })
                      }
                      className="w-20 px-2 py-1 text-xs border border-slate-200 rounded text-right font-mono-num font-bold"
                    />
                  </td>
                  <td className="py-1.5 px-2.5">
                    <input
                      type="number"
                      min="0"
                      value={v.purchasePrice !== undefined ? v.purchasePrice : (basePurchasePrice > 0 ? basePurchasePrice : '')}
                      onChange={e =>
                        handleUpdateRow(v.id, {
                          purchasePrice: e.target.value === '' ? undefined : Math.max(0, Number(e.target.value)),
                        })
                      }
                      className="w-20 px-2 py-1 text-xs border border-slate-200 rounded text-right font-mono-num text-slate-600"
                    />
                  </td>
                  <td className="py-1.5 px-2 text-center">
                    <button
                      type="button"
                      onClick={() => handleRemoveRow(v.id)}
                      className="text-rose-500 hover:text-rose-700 p-1"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="p-6 text-center text-xs text-slate-400 bg-white rounded-xl border border-dashed border-slate-200">
          No variants created yet. Click 'Generate Matrix' above to create all size &amp; color combinations.
        </div>
      )}
    </div>
  );
};
