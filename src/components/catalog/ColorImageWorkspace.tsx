import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Edit3,
  Eye,
  FolderSync,
  ImagePlus,
  Loader2,
  Palette,
  Plus,
  RefreshCw,
  Star,
  Trash2,
  Upload,
  X,
  AlertCircle,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { Product, ProductColor, ProductColorImage } from '../../types';
import { SearchableCombobox, ComboboxOption } from '../common/SearchableCombobox';
import { ProductThumbnail } from '../common/ProductThumbnail';
import { validateImageFile } from '../../services/catalogImageService';
import {
  inferColorHex,
  normalizeColorKey,
  resolveColorImages,
  resolveProductColors,
  resolveProductImage,
} from '../../utils/productImageResolver';

const QUICK_COLOR_SWATCHES = [
  { name: 'Black', hex: '#0f172a' },
  { name: 'White', hex: '#ffffff' },
  { name: 'Navy Blue', hex: '#1e3a8a' },
  { name: 'Grey', hex: '#64748b' },
  { name: 'Charcoal', hex: '#334155' },
  { name: 'Royal Blue', hex: '#2563eb' },
  { name: 'Red', hex: '#dc2626' },
  { name: 'Maroon', hex: '#831843' },
  { name: 'Olive Green', hex: '#3f6212' },
  { name: 'Beige', hex: '#d4b996' },
  { name: 'Pink', hex: '#f472b6' },
  { name: 'Gold', hex: '#d6ad60' },
];

interface UploadProgressItem {
  id: string;
  fileName: string;
  progress: number;
  status: 'uploading' | 'done' | 'error';
  error?: string;
}

interface ColorImageWorkspaceProps {
  initialProductId?: string | null;
  onCloseModal?: () => void;
  compact?: boolean;
}

export const ColorImageWorkspace: React.FC<ColorImageWorkspaceProps> = ({
  initialProductId,
  onCloseModal,
  compact = false,
}) => {
  const {
    products,
    hasPermission,
    isAdmin,
    addProductColor,
    updateProductColor,
    deleteProductColor,
    uploadProductColorImage,
    replaceProductColorImage,
    setPrimaryProductColorImage,
    reorderProductColorImages,
    reassignProductImageColor,
    deleteProductColorImage,
  } = useApp();

  const canCreateOrEdit = isAdmin || hasPermission('product_management', 'create') || hasPermission('product_management', 'edit');
  const canDelete = isAdmin || hasPermission('product_management', 'delete') || hasPermission('product_management', 'edit');

  const activeProducts = useMemo(
    () => products.filter(p => p.isActive !== false),
    [products]
  );

  const [selectedProductId, setSelectedProductId] = useState<string>(
    initialProductId || activeProducts[0]?.id || ''
  );

  useEffect(() => {
    if (initialProductId) {
      setSelectedProductId(initialProductId);
    } else if (!selectedProductId && activeProducts[0]?.id) {
      setSelectedProductId(activeProducts[0].id);
    }
  }, [initialProductId, activeProducts, selectedProductId]);

  const selectedProduct: Product | undefined = useMemo(
    () => activeProducts.find(p => p.id === selectedProductId) || products.find(p => p.id === selectedProductId),
    [activeProducts, products, selectedProductId]
  );

  const productColors: ProductColor[] = useMemo(
    () => resolveProductColors(selectedProduct),
    [selectedProduct]
  );

  const [selectedColorId, setSelectedColorId] = useState<string>('');
  const [newColorName, setNewColorName] = useState('');
  const [newColorHex, setNewColorHex] = useState('#0f172a');
  const [isAddingColor, setIsAddingColor] = useState(false);

  const [editingColorId, setEditingColorId] = useState<string | null>(null);
  const [editingColorName, setEditingColorName] = useState('');
  const [editingColorHex, setEditingColorHex] = useState('#0f172a');
  const [savingColorAction, setSavingColorAction] = useState(false);

  const [uploadQueue, setUploadQueue] = useState<UploadProgressItem[]>([]);
  const [replacingImageId, setReplacingImageId] = useState<string | null>(null);
  const [busyImageId, setBusyImageId] = useState<string | null>(null);
  const [isDraggingOver, setIsDraggingOver] = useState(false);

  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [previewImage, setPreviewImage] = useState<ProductColorImage | null>(null);
  const [confirmDeleteImage, setConfirmDeleteImage] = useState<ProductColorImage | null>(null);
  const [confirmDeleteColor, setConfirmDeleteColor] = useState<ProductColor | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const replaceTargetRef = useRef<ProductColorImage | null>(null);

  // Keep selectedColorId synced to the current product's colors
  useEffect(() => {
    if (!selectedProduct) {
      setSelectedColorId('');
      return;
    }
    if (productColors.length === 0) {
      setSelectedColorId('');
      return;
    }
    if (!selectedColorId || !productColors.some(c => c.id === selectedColorId)) {
      setSelectedColorId(productColors[0].id);
    }
  }, [selectedProduct, productColors, selectedColorId]);

  const activeColor = useMemo(
    () => productColors.find(c => c.id === selectedColorId) || null,
    [productColors, selectedColorId]
  );

  const activeColorImages = useMemo(
    () => (selectedProduct && activeColor ? resolveColorImages(selectedProduct, activeColor.id, activeColor.colorName) : []),
    [selectedProduct, activeColor]
  );

  const productOptions: ComboboxOption[] = useMemo(
    () =>
      activeProducts.map(p => {
        const colors = resolveProductColors(p);
        const imgsCount = (p.productImages || []).length;
        return {
          id: p.id,
          label: `${p.name} (${p.code})`,
          sublabel: `${p.category} · ${colors.length} color${colors.length === 1 ? '' : 's'} · ${imgsCount} photo${imgsCount === 1 ? '' : 's'}`,
          badge: p.barcode ? p.barcode.slice(-6) : p.code,
          searchText: `${p.name} ${p.code} ${p.barcode} ${p.category} ${(p.variants || []).map(v => `${v.sku} ${v.color || ''}`).join(' ')}`,
        };
      }),
    [activeProducts]
  );

  const showToast = (type: 'success' | 'error', message: string) => {
    setFeedback({ type, message });
    window.setTimeout(() => {
      setFeedback(prev => (prev?.message === message ? null : prev));
    }, 5000);
  };

  /**
   * Ensures a permanent UUID color row exists in DB before uploading images.
   * Handles unsynced local-color-* items seamlessly so upload always links to a real color_id.
   */
  const ensurePersistedColorId = async (color: ProductColor): Promise<string> => {
    if (!selectedProduct) throw new Error('Select a product first.');
    if (!color.id.startsWith('local-color-')) {
      return color.id;
    }
    const created = await addProductColor(selectedProduct.id, color.colorName, color.colorHex);
    setSelectedColorId(created.id);
    return created.id;
  };

  const handleAddColorSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!selectedProduct || !canCreateOrEdit) return;
    const clean = newColorName.trim();
    if (!clean) {
      showToast('error', 'Please enter a color name.');
      return;
    }

    const dup = productColors.find(
      c => normalizeColorKey(c.normalizedName || c.colorName) === normalizeColorKey(clean)
    );
    if (dup) {
      setSelectedColorId(dup.id);
      setIsAddingColor(false);
      setNewColorName('');
      showToast('success', `Selected existing color "${dup.colorName}".`);
      return;
    }

    setSavingColorAction(true);
    try {
      const created = await addProductColor(selectedProduct.id, clean, newColorHex);
      setSelectedColorId(created.id);
      setNewColorName('');
      setIsAddingColor(false);
      showToast('success', `Added color "${created.colorName}" (ID linked to ${selectedProduct.code}).`);
    } catch (err: any) {
      showToast('error', err?.message || 'Failed to add color.');
    } finally {
      setSavingColorAction(false);
    }
  };

  const handleSaveColorEdit = async (color: ProductColor) => {
    if (!selectedProduct || !canCreateOrEdit) return;
    const clean = editingColorName.trim();
    if (!clean) {
      showToast('error', 'Color name cannot be empty.');
      return;
    }
    setSavingColorAction(true);
    try {
      const persistedId = await ensurePersistedColorId(color);
      await updateProductColor(selectedProduct.id, persistedId, clean, editingColorHex);
      setEditingColorId(null);
      showToast('success', `Updated color to "${clean}".`);
    } catch (err: any) {
      showToast('error', err?.message || 'Failed to update color.');
    } finally {
      setSavingColorAction(false);
    }
  };

  const handleDeleteColorConfirmed = async () => {
    if (!selectedProduct || !confirmDeleteColor) return;
    const target = confirmDeleteColor;
    setConfirmDeleteColor(null);
    if (target.id.startsWith('local-color-')) {
      showToast('error', 'This color comes from a variant SKU and cannot be removed here.');
      return;
    }
    setSavingColorAction(true);
    try {
      await deleteProductColor(selectedProduct.id, target.id);
      showToast('success', `Removed color "${target.colorName}" and its photos.`);
    } catch (err: any) {
      showToast('error', err?.message || 'Failed to delete color.');
    } finally {
      setSavingColorAction(false);
    }
  };

  const handleFilesSelected = async (filesList: FileList | File[] | null) => {
    if (!filesList || !selectedProduct || !activeColor || !canCreateOrEdit) return;
    const files = Array.from(filesList);
    if (files.length === 0) return;

    // Validate all files first so invalid formats/sizes show instant feedback
    const validFiles: File[] = [];
    for (const file of files) {
      const check = validateImageFile(file);
      if (!check.valid) {
        showToast('error', check.error || `Invalid file: ${file.name}`);
      } else {
        validFiles.push(file);
      }
    }
    if (validFiles.length === 0) return;

    let targetColorId: string;
    try {
      targetColorId = await ensurePersistedColorId(activeColor);
    } catch (err: any) {
      showToast('error', err?.message || 'Failed to prepare color record.');
      return;
    }

    const queueItems: UploadProgressItem[] = validFiles.map((f, idx) => ({
      id: `up-${Date.now()}-${idx}`,
      fileName: f.name,
      progress: 0,
      status: 'uploading',
    }));
    setUploadQueue(prev => [...queueItems, ...prev]);

    let successCount = 0;
    for (let i = 0; i < validFiles.length; i++) {
      const file = validFiles[i];
      const qId = queueItems[i].id;
      try {
        await uploadProductColorImage({
          productId: selectedProduct.id,
          colorId: targetColorId,
          file,
          onProgress: pct => {
            setUploadQueue(prev =>
              prev.map(item => (item.id === qId ? { ...item, progress: pct } : item))
            );
          },
        });
        successCount += 1;
        setUploadQueue(prev =>
          prev.map(item => (item.id === qId ? { ...item, progress: 100, status: 'done' } : item))
        );
      } catch (err: any) {
        const msg = err?.message || 'Upload failed.';
        setUploadQueue(prev =>
          prev.map(item =>
            item.id === qId ? { ...item, status: 'error', error: msg } : item
          )
        );
        showToast('error', `${file.name}: ${msg}`);
      }
    }

    if (successCount > 0) {
      showToast(
        'success',
        `Uploaded ${successCount} image${successCount === 1 ? '' : 's'} for ${selectedProduct.name} · ${activeColor.colorName}.`
      );
    }

    window.setTimeout(() => {
      setUploadQueue(prev => prev.filter(item => item.status !== 'done'));
    }, 3500);
  };

  const handleReplaceFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const targetImg = replaceTargetRef.current;
    e.target.value = '';
    if (!file || !targetImg || !selectedProduct) return;

    const check = validateImageFile(file);
    if (!check.valid) {
      showToast('error', check.error || 'Invalid replacement file.');
      return;
    }

    setReplacingImageId(targetImg.id);
    try {
      await replaceProductColorImage({
        productId: selectedProduct.id,
        image: targetImg,
        file,
      });
      showToast('success', `Replaced photo "${targetImg.fileName || 'image'}" successfully.`);
    } catch (err: any) {
      showToast('error', err?.message || 'Failed to replace photo.');
    } finally {
      setReplacingImageId(null);
      replaceTargetRef.current = null;
    }
  };

  const handleSetPrimary = async (img: ProductColorImage) => {
    if (!selectedProduct || !canCreateOrEdit) return;
    setBusyImageId(img.id);
    try {
      await setPrimaryProductColorImage({
        productId: selectedProduct.id,
        colorId: img.colorId,
        imageId: img.id,
      });
      showToast('success', 'Updated primary photo for this color.');
    } catch (err: any) {
      showToast('error', err?.message || 'Failed to set primary image.');
    } finally {
      setBusyImageId(null);
    }
  };

  const handleMoveImageOrder = async (index: number, direction: -1 | 1) => {
    if (!selectedProduct || !activeColor || !canCreateOrEdit) return;
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= activeColorImages.length) return;
    const reordered = [...activeColorImages];
    const [moved] = reordered.splice(index, 1);
    reordered.splice(nextIndex, 0, moved);
    setBusyImageId(moved.id);
    try {
      await reorderProductColorImages({
        productId: selectedProduct.id,
        colorId: activeColor.id,
        orderedImageIds: reordered.map(i => i.id),
      });
    } catch (err: any) {
      showToast('error', err?.message || 'Failed to reorder images.');
    } finally {
      setBusyImageId(null);
    }
  };

  const handleReassignColor = async (img: ProductColorImage, targetColorId: string) => {
    if (!selectedProduct || !canCreateOrEdit || targetColorId === img.colorId) return;
    const targetColor = productColors.find(c => c.id === targetColorId);
    if (!targetColor) return;
    setBusyImageId(img.id);
    try {
      const persistedTargetId = await ensurePersistedColorId(targetColor);
      await reassignProductImageColor({
        productId: selectedProduct.id,
        imageId: img.id,
        targetColorId: persistedTargetId,
      });
      showToast('success', `Moved image to color "${targetColor.colorName}".`);
    } catch (err: any) {
      showToast('error', err?.message || 'Failed to reassign image color.');
    } finally {
      setBusyImageId(null);
    }
  };

  const handleDeleteImageConfirmed = async () => {
    if (!selectedProduct || !confirmDeleteImage) return;
    const target = confirmDeleteImage;
    setConfirmDeleteImage(null);
    setBusyImageId(target.id);
    try {
      await deleteProductColorImage({
        productId: selectedProduct.id,
        image: target,
      });
      showToast('success', 'Image deleted from catalog & cloud storage.');
    } catch (err: any) {
      showToast('error', err?.message || 'Failed to delete image.');
    } finally {
      setBusyImageId(null);
    }
  };

  const formatFileSize = (bytes?: number) => {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  return (
    <div className="space-y-4">
      {/* Hidden input for replacing existing image */}
      <input
        ref={replaceInputRef}
        type="file"
        accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
        onChange={handleReplaceFileChange}
        className="hidden"
      />

      {/* Feedback Banner */}
      {feedback && (
        <div
          role="status"
          className={`flex items-center justify-between gap-3 px-4 py-2.5 rounded-xl border text-xs font-medium ${
            feedback.type === 'success'
              ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200'
              : 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-200'
          }`}
        >
          <div className="flex items-center gap-2">
            {feedback.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 shrink-0" />
            )}
            <span>{feedback.message}</span>
          </div>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="opacity-70 hover:opacity-100 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Product Selector Bar */}
      <div className="adp-card p-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex-1 min-w-0">
            <label className="block text-[11px] font-bold uppercase tracking-wider text-[#64748B] dark:text-slate-400 mb-1.5">
              Select Existing Product (Name, SKU, or Product Code)
            </label>
            <SearchableCombobox
              ariaLabel="Select Product for Color Image Management"
              options={productOptions}
              value={selectedProductId}
              onChange={id => setSelectedProductId(id)}
              placeholder="Search product by name, SKU, or barcode..."
              emptyMessage="No active products found in Product Management"
              size="md"
            />
          </div>

          {selectedProduct && (
            <div className="flex items-center gap-3 pt-2 lg:pt-5 shrink-0">
              <ProductThumbnail
                src={resolveProductImage(selectedProduct, {
                  colorId: activeColor?.id,
                  colorName: activeColor?.colorName,
                })}
                alt={selectedProduct.name}
                colorHex={activeColor?.colorHex}
                colorName={activeColor?.colorName}
                size="md"
              />
              <div className="min-w-0">
                <div className="text-sm font-bold text-[#172033] dark:text-white truncate max-w-[220px]">
                  {selectedProduct.name}
                </div>
                <div className="text-[11px] text-[#64748B] dark:text-slate-400 font-mono">
                  Code: {selectedProduct.code} · {selectedProduct.category}
                </div>
                <div className="text-[11px] font-semibold text-[#087F8C] dark:text-[#5EEAD4]">
                  {productColors.length} Color{productColors.length === 1 ? '' : 's'} ·{' '}
                  {(selectedProduct.productImages || []).length} Photo{(selectedProduct.productImages || []).length === 1 ? '' : 's'}
                </div>
              </div>
              {onCloseModal && (
                <button
                  type="button"
                  onClick={onCloseModal}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-[#162344] cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {!selectedProduct ? (
        <div className="adp-card p-10 text-center text-xs text-[#64748B] dark:text-slate-400">
          Select a product above or create a product in Products &amp; Variants first.
        </div>
      ) : (
        <div className={`grid grid-cols-1 ${compact ? 'lg:grid-cols-12' : 'lg:grid-cols-12'} gap-4 items-start`}>
          {/* Left Panel: Permanent Product Colors */}
          <div className="lg:col-span-4 adp-card p-4 space-y-3">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-[#1F3158] pb-2.5">
              <div>
                <h3 className="text-xs font-bold text-[#172033] dark:text-white flex items-center gap-1.5">
                  <Palette className="w-4 h-4 text-[#087F8C] dark:text-[#D6AD60]" />
                  <span>Product Colors</span>
                </h3>
                <p className="text-[11px] text-[#64748B] dark:text-slate-400 mt-0.5">
                  Choose a color to upload or manage its photos
                </p>
              </div>
              {canCreateOrEdit && (
                <button
                  type="button"
                  onClick={() => setIsAddingColor(prev => !prev)}
                  className="px-2.5 py-1 rounded-lg bg-[#087F8C]/10 dark:bg-[#087F8C]/25 text-[#087F8C] dark:text-[#5EEAD4] hover:bg-[#087F8C]/20 text-[11px] font-bold flex items-center gap-1 cursor-pointer transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Color</span>
                </button>
              )}
            </div>

            {/* Add New Color Inline Panel */}
            {isAddingColor && canCreateOrEdit && (
              <form
                onSubmit={handleAddColorSubmit}
                className="p-3 rounded-xl bg-[#F8FAFC] dark:bg-[#0E182E] border border-[#E2E8F0] dark:border-[#1F3158] space-y-2.5"
              >
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-[#172033] dark:text-white">
                    New Product Color
                  </span>
                  <button
                    type="button"
                    onClick={() => setIsAddingColor(false)}
                    className="text-slate-400 hover:text-slate-600 cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {QUICK_COLOR_SWATCHES.map(swatch => (
                    <button
                      key={swatch.name}
                      type="button"
                      onClick={() => {
                        setNewColorName(swatch.name);
                        setNewColorHex(swatch.hex);
                      }}
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[10px] font-semibold cursor-pointer transition-colors ${
                        normalizeColorKey(newColorName) === normalizeColorKey(swatch.name)
                          ? 'border-[#087F8C] bg-[#087F8C]/10 text-[#087F8C] dark:text-[#5EEAD4]'
                          : 'border-slate-200 dark:border-[#1F3158] bg-white dark:bg-[#101B35] text-slate-700 dark:text-slate-200'
                      }`}
                    >
                      <span
                        className="w-2.5 h-2.5 rounded-full border border-slate-300"
                        style={{ backgroundColor: swatch.hex }}
                      />
                      <span>{swatch.name}</span>
                    </button>
                  ))}
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    aria-label="Pick color hex"
                    value={newColorHex}
                    onChange={e => setNewColorHex(e.target.value)}
                    className="w-9 h-9 rounded-lg border border-slate-200 dark:border-[#1F3158] cursor-pointer p-0.5 bg-white dark:bg-[#101B35]"
                  />
                  <input
                    type="text"
                    value={newColorName}
                    onChange={e => {
                      setNewColorName(e.target.value);
                      setNewColorHex(inferColorHex(e.target.value, undefined));
                    }}
                    placeholder="e.g. Navy Blue, Ash Grey..."
                    className="flex-1 px-2.5 py-2 text-xs border border-slate-200 dark:border-[#1F3158] rounded-lg bg-white dark:bg-[#101B35] text-[#172033] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#087F8C]/30"
                  />
                  <button
                    type="submit"
                    disabled={savingColorAction}
                    className="px-3 py-2 rounded-lg bg-[#087F8C] hover:bg-[#066974] text-white text-xs font-bold cursor-pointer disabled:opacity-50"
                  >
                    {savingColorAction ? 'Saving...' : 'Save'}
                  </button>
                </div>
              </form>
            )}

            {/* Color List */}
            {productColors.length === 0 ? (
              <div className="p-5 rounded-xl bg-slate-50 dark:bg-[#0E182E] border border-dashed border-slate-200 dark:border-[#1F3158] text-center space-y-2">
                <Palette className="w-6 h-6 text-slate-400 mx-auto" />
                <div className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                  No colors configured for {selectedProduct.name}
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Add colors (e.g., Black, White, Navy Blue) to attach manual photos to each color.
                </p>
                {canCreateOrEdit && !isAddingColor && (
                  <button
                    type="button"
                    onClick={() => setIsAddingColor(true)}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#087F8C] text-white text-xs font-bold cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add First Color</span>
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                {productColors.map(color => {
                  const imgs = resolveColorImages(selectedProduct, color.id, color.colorName);
                  const primaryUrl = imgs.find(i => i.isPrimary)?.imageUrl || imgs[0]?.imageUrl;
                  const isSelected = activeColor?.id === color.id;
                  const isEditing = editingColorId === color.id;

                  if (isEditing) {
                    return (
                      <div
                        key={color.id}
                        className="p-2.5 rounded-xl border border-[#087F8C] bg-[#087F8C]/5 dark:bg-[#087F8C]/15 space-y-2"
                      >
                        <div className="flex items-center gap-2">
                          <input
                            type="color"
                            value={editingColorHex}
                            onChange={e => setEditingColorHex(e.target.value)}
                            className="w-8 h-8 rounded border border-slate-200 dark:border-[#1F3158] cursor-pointer p-0.5 bg-white"
                          />
                          <input
                            type="text"
                            value={editingColorName}
                            onChange={e => setEditingColorName(e.target.value)}
                            className="flex-1 px-2.5 py-1.5 text-xs border border-slate-200 dark:border-[#1F3158] rounded-lg bg-white dark:bg-[#101B35] text-[#172033] dark:text-white"
                          />
                        </div>
                        <div className="flex justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => setEditingColorId(null)}
                            className="px-2.5 py-1 text-[11px] text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#162344] rounded-md cursor-pointer"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            disabled={savingColorAction}
                            onClick={() => handleSaveColorEdit(color)}
                            className="px-2.5 py-1 text-[11px] font-bold bg-[#087F8C] text-white rounded-md cursor-pointer flex items-center gap-1"
                          >
                            <Check className="w-3 h-3" />
                            <span>Save</span>
                          </button>
                        </div>
                      </div>
                    );
                  }

                  return (
                    <div
                      key={color.id}
                      onClick={() => setSelectedColorId(color.id)}
                      className={`group flex items-center justify-between gap-2.5 p-2.5 rounded-xl border transition-all cursor-pointer ${
                        isSelected
                          ? 'border-[#087F8C] bg-[#087F8C]/8 dark:bg-[#087F8C]/20 shadow-xs'
                          : 'border-slate-200 dark:border-[#1F3158] bg-white dark:bg-[#101B35] hover:border-slate-300 dark:hover:border-slate-600'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <ProductThumbnail
                          src={primaryUrl}
                          alt={`${selectedProduct.name} - ${color.colorName}`}
                          colorHex={color.colorHex}
                          colorName={color.colorName}
                          size="sm"
                        />
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span
                              className="w-3 h-3 rounded-full border border-slate-300 dark:border-slate-600 shrink-0"
                              style={{ backgroundColor: color.colorHex }}
                            />
                            <span className="text-xs font-bold text-[#172033] dark:text-white truncate">
                              {color.colorName}
                            </span>
                          </div>
                          <div className="text-[11px] mt-0.5 flex items-center gap-1.5">
                            {imgs.length > 0 ? (
                              <span className="text-emerald-700 dark:text-emerald-400 font-semibold">
                                Uploaded ({imgs.length})
                              </span>
                            ) : (
                              <span className="text-amber-700 dark:text-amber-400 font-medium">
                                Needs Photo
                              </span>
                            )}
                            <span className="text-slate-300 dark:text-slate-600">·</span>
                            <span className="text-[10px] font-mono text-slate-400">
                              #{color.id.slice(-6)}
                            </span>
                          </div>
                        </div>
                      </div>

                      {canCreateOrEdit && (
                        <div
                          className="flex items-center gap-1 shrink-0"
                          onClick={e => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            title="Edit color name or swatch"
                            onClick={() => {
                              setEditingColorId(color.id);
                              setEditingColorName(color.colorName);
                              setEditingColorHex(color.colorHex);
                            }}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-[#087F8C] hover:bg-slate-100 dark:hover:bg-[#162344] cursor-pointer"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          {canDelete && !color.id.startsWith('local-color-') && (
                            <button
                              type="button"
                              title="Delete color"
                              onClick={() => setConfirmDeleteColor(color)}
                              className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Right Panel: Upload & Manage Images for Selected Color */}
          <div className="lg:col-span-8 adp-card p-4 space-y-4">
            {!activeColor ? (
              <div className="py-12 text-center text-xs text-[#64748B] dark:text-slate-400">
                Add or select a product color on the left to upload and manage its images.
              </div>
            ) : (
              <>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-100 dark:border-[#1F3158]">
                  <div className="flex items-center gap-2.5">
                    <span
                      className="w-6 h-6 rounded-full border border-slate-300 dark:border-slate-600 shadow-xs shrink-0"
                      style={{ backgroundColor: activeColor.colorHex }}
                    />
                    <div>
                      <h3 className="text-sm font-bold text-[#172033] dark:text-white">
                        {selectedProduct.name} — {activeColor.colorName}
                      </h3>
                      <p className="text-[11px] text-[#64748B] dark:text-slate-400 font-mono">
                        Product ID: {selectedProduct.id.slice(0, 8)}… · Color ID: {activeColor.id.slice(0, 8)}… ·{' '}
                        {activeColorImages.length} Image{activeColorImages.length === 1 ? '' : 's'}
                      </p>
                    </div>
                  </div>

                  {canCreateOrEdit && (
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-[10px] bg-[#087F8C] hover:bg-[#066974] text-white text-xs font-bold shadow-xs cursor-pointer transition-colors shrink-0"
                    >
                      <ImagePlus className="w-4 h-4" />
                      <span>Upload {activeColor.colorName} Photos</span>
                    </button>
                  )}
                </div>

                {/* Manual Upload Dropzone */}
                {canCreateOrEdit && (
                  <div
                    onDragOver={e => {
                      e.preventDefault();
                      setIsDraggingOver(true);
                    }}
                    onDragLeave={() => setIsDraggingOver(false)}
                    onDrop={e => {
                      e.preventDefault();
                      setIsDraggingOver(false);
                      handleFilesSelected(e.dataTransfer.files);
                    }}
                    onClick={() => fileInputRef.current?.click()}
                    className={`rounded-2xl border-2 border-dashed p-5 text-center transition-colors cursor-pointer ${
                      isDraggingOver
                        ? 'border-[#087F8C] bg-[#087F8C]/10 dark:bg-[#087F8C]/20'
                        : 'border-slate-200 dark:border-[#1F3158] bg-[#F8FAFC] dark:bg-[#0E182E] hover:border-[#087F8C]/60'
                    }`}
                  >
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
                      onChange={e => {
                        handleFilesSelected(e.target.files);
                        e.target.value = '';
                      }}
                      className="hidden"
                    />
                    <div className="w-10 h-10 rounded-full bg-[#087F8C]/10 dark:bg-[#087F8C]/25 text-[#087F8C] dark:text-[#5EEAD4] flex items-center justify-center mx-auto mb-2">
                      <Upload className="w-5 h-5" />
                    </div>
                    <div className="text-xs font-bold text-[#172033] dark:text-white">
                      Click to select or drag &amp; drop photos for{' '}
                      <span className="text-[#087F8C] dark:text-[#5EEAD4]">{activeColor.colorName}</span>
                    </div>
                    <div className="text-[11px] text-[#64748B] dark:text-slate-400 mt-1">
                      Supports JPG, JPEG, PNG, WEBP · Max 5 MB per photo · Multiple photos allowed per color
                    </div>
                  </div>
                )}

                {/* Upload Progress Queue */}
                {uploadQueue.length > 0 && (
                  <div className="space-y-2">
                    {uploadQueue.map(item => (
                      <div
                        key={item.id}
                        className="p-2.5 rounded-xl bg-slate-50 dark:bg-[#0E182E] border border-slate-200 dark:border-[#1F3158] space-y-1.5"
                      >
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-semibold text-[#172033] dark:text-white truncate max-w-[70%]">
                            {item.fileName}
                          </span>
                          <span className="font-mono-num text-[11px] font-bold">
                            {item.status === 'error' ? (
                              <span className="text-rose-600">Failed</span>
                            ) : item.status === 'done' ? (
                              <span className="text-emerald-600">Uploaded (100%)</span>
                            ) : (
                              <span className="text-[#087F8C] dark:text-[#5EEAD4]">
                                {item.progress}%
                              </span>
                            )}
                          </span>
                        </div>
                        <div className="h-1.5 w-full rounded-full bg-slate-200 dark:bg-[#1F3158] overflow-hidden">
                          <div
                            className={`h-full transition-all duration-200 ${
                              item.status === 'error'
                                ? 'bg-rose-500'
                                : item.status === 'done'
                                ? 'bg-emerald-500'
                                : 'bg-[#087F8C]'
                            }`}
                            style={{ width: `${item.status === 'error' ? 100 : item.progress}%` }}
                          />
                        </div>
                        {item.error && (
                          <div className="text-[11px] text-rose-600">{item.error}</div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Uploaded Images Grid for Selected Color */}
                {activeColorImages.length === 0 ? (
                  <div className="py-10 text-center space-y-1.5 border border-slate-100 dark:border-[#1F3158] rounded-xl bg-slate-50/50 dark:bg-[#0E182E]/50">
                    <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                      No photos uploaded yet for {activeColor.colorName}
                    </p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      The first uploaded photo becomes the primary image for this color in POS, Catalog, Inventory, and Invoices.
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3.5">
                    {activeColorImages.map((img, idx) => {
                      const isBusy = busyImageId === img.id || replacingImageId === img.id;
                      return (
                        <div
                          key={img.id}
                          className={`rounded-xl overflow-hidden border transition-all bg-white dark:bg-[#101B35] flex flex-col ${
                            img.isPrimary
                              ? 'border-[#087F8C] ring-1 ring-[#087F8C]/25'
                              : 'border-slate-200 dark:border-[#1F3158]'
                          }`}
                        >
                          <div className="relative aspect-[4/3] bg-slate-100 dark:bg-[#0E182E] overflow-hidden group">
                            <img
                              src={img.imageUrl}
                              alt={`${selectedProduct.name} - ${activeColor.colorName}`}
                              referrerPolicy="no-referrer"
                              className="w-full h-full object-cover"
                            />

                            {img.isPrimary && (
                              <span className="absolute top-2 left-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#087F8C] text-white text-[10px] font-bold shadow-xs">
                                <Star className="w-3 h-3 fill-current" />
                                <span>Primary</span>
                              </span>
                            )}

                            <span className="absolute top-2 right-2 px-1.5 py-0.5 rounded bg-slate-900/70 text-white text-[10px] font-mono-num font-bold">
                              #{idx + 1}
                            </span>

                            {isBusy && (
                              <div className="absolute inset-0 bg-slate-900/50 flex items-center justify-center text-white">
                                <Loader2 className="w-6 h-6 animate-spin" />
                              </div>
                            )}

                            <button
                              type="button"
                              onClick={() => setPreviewImage(img)}
                              title="Full preview"
                              className="absolute bottom-2 right-2 p-1.5 rounded-lg bg-slate-900/75 text-white opacity-90 hover:opacity-100 cursor-pointer"
                            >
                              <Eye className="w-3.5 h-3.5" />
                            </button>
                          </div>

                          <div className="p-2.5 space-y-2 text-[11px] flex-1 flex flex-col justify-between">
                            <div>
                              <div className="font-semibold text-[#172033] dark:text-white truncate">
                                {img.fileName || `${activeColor.colorName} Photo #${idx + 1}`}
                              </div>
                              <div className="text-[10px] text-[#64748B] dark:text-slate-400 font-mono">
                                {formatFileSize(img.fileSize)}
                                {img.mimeType ? ` · ${img.mimeType.replace('image/', '').toUpperCase()}` : ''}
                              </div>
                            </div>

                            {canCreateOrEdit && (
                              <div className="space-y-1.5 pt-1 border-t border-slate-100 dark:border-[#1F3158]">
                                <div className="flex items-center justify-between gap-1">
                                  <button
                                    type="button"
                                    disabled={img.isPrimary || isBusy}
                                    onClick={() => handleSetPrimary(img)}
                                    className={`flex-1 py-1 px-2 rounded-lg text-[11px] font-bold flex items-center justify-center gap-1 cursor-pointer transition-colors ${
                                      img.isPrimary
                                        ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 cursor-default'
                                        : 'bg-slate-100 dark:bg-[#162344] text-slate-700 dark:text-slate-200 hover:bg-[#087F8C] hover:text-white'
                                    }`}
                                  >
                                    <Star className="w-3 h-3" />
                                    <span>{img.isPrimary ? 'Primary' : 'Set Primary'}</span>
                                  </button>

                                  <button
                                    type="button"
                                    disabled={isBusy}
                                    title="Replace image file"
                                    onClick={() => {
                                      replaceTargetRef.current = img;
                                      replaceInputRef.current?.click();
                                    }}
                                    className="p-1.5 rounded-lg bg-slate-100 dark:bg-[#162344] text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-[#1F3158] cursor-pointer"
                                  >
                                    <RefreshCw className="w-3.5 h-3.5" />
                                  </button>

                                  <button
                                    type="button"
                                    disabled={idx === 0 || isBusy}
                                    title="Move earlier"
                                    onClick={() => handleMoveImageOrder(idx, -1)}
                                    className="p-1.5 rounded-lg bg-slate-100 dark:bg-[#162344] text-slate-700 dark:text-slate-200 hover:bg-slate-200 disabled:opacity-40 cursor-pointer"
                                  >
                                    <ArrowLeft className="w-3.5 h-3.5" />
                                  </button>

                                  <button
                                    type="button"
                                    disabled={idx === activeColorImages.length - 1 || isBusy}
                                    title="Move later"
                                    onClick={() => handleMoveImageOrder(idx, 1)}
                                    className="p-1.5 rounded-lg bg-slate-100 dark:bg-[#162344] text-slate-700 dark:text-slate-200 hover:bg-slate-200 disabled:opacity-40 cursor-pointer"
                                  >
                                    <ArrowRight className="w-3.5 h-3.5" />
                                  </button>

                                  {canDelete && (
                                    <button
                                      type="button"
                                      disabled={isBusy}
                                      title="Delete image"
                                      onClick={() => setConfirmDeleteImage(img)}
                                      className="p-1.5 rounded-lg bg-rose-50 dark:bg-rose-950/30 text-rose-600 hover:bg-rose-100 cursor-pointer"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  )}
                                </div>

                                {productColors.length > 1 && (
                                  <div className="flex items-center gap-1.5">
                                    <FolderSync className="w-3 h-3 text-slate-400 shrink-0" />
                                    <select
                                      aria-label="Reassign color"
                                      value={img.colorId}
                                      disabled={isBusy}
                                      onChange={e => handleReassignColor(img, e.target.value)}
                                      className="w-full py-1 px-1.5 text-[10px] rounded-md border border-slate-200 dark:border-[#1F3158] bg-slate-50 dark:bg-[#0E182E] text-slate-700 dark:text-slate-200"
                                    >
                                      {productColors.map(c => (
                                        <option key={c.id} value={c.id}>
                                          Color: {c.colorName}
                                        </option>
                                      ))}
                                    </select>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* Full Image Preview Lightbox */}
      {previewImage && selectedProduct && (
        <div
          onClick={() => setPreviewImage(null)}
          className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-xs"
        >
          <div
            onClick={e => e.stopPropagation()}
            className="bg-white dark:bg-[#101B35] rounded-2xl border border-slate-200 dark:border-[#1F3158] max-w-2xl w-full overflow-hidden shadow-2xl"
          >
            <div className="px-4 py-3 border-b border-slate-100 dark:border-[#1F3158] flex items-center justify-between">
              <div>
                <div className="text-xs font-bold text-[#172033] dark:text-white">
                  {selectedProduct.name} · {activeColor?.colorName}
                </div>
                <div className="text-[11px] text-[#64748B] dark:text-slate-400 font-mono">
                  {previewImage.fileName || 'Product Photo'} {formatFileSize(previewImage.fileSize) ? `· ${formatFileSize(previewImage.fileSize)}` : ''}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setPreviewImage(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="bg-slate-100 dark:bg-[#0B1428] max-h-[70vh] flex items-center justify-center p-4">
              <img
                src={previewImage.imageUrl}
                alt={selectedProduct.name}
                referrerPolicy="no-referrer"
                className="max-h-[62vh] max-w-full object-contain rounded-lg"
              />
            </div>
          </div>
        </div>
      )}

      {/* Delete Image Confirmation Modal */}
      {confirmDeleteImage && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs">
          <div className="bg-white dark:bg-[#101B35] rounded-2xl border border-slate-200 dark:border-[#1F3158] max-w-sm w-full p-5 space-y-4 shadow-xl">
            <h4 className="text-sm font-bold text-[#172033] dark:text-white">Delete Color Image?</h4>
            <p className="text-xs text-[#64748B] dark:text-slate-400">
              This will permanently remove{' '}
              <span className="font-semibold text-[#172033] dark:text-white">
                {confirmDeleteImage.fileName || 'this photo'}
              </span>{' '}
              from cloud storage and unlink it from this product color.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setConfirmDeleteImage(null)}
                className="px-3.5 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#162344] rounded-lg cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeleteImageConfirmed}
                className="px-4 py-1.5 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-lg cursor-pointer"
              >
                Delete Photo
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Color Confirmation Modal */}
      {confirmDeleteColor && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs">
          <div className="bg-white dark:bg-[#101B35] rounded-2xl border border-slate-200 dark:border-[#1F3158] max-w-sm w-full p-5 space-y-4 shadow-xl">
            <h4 className="text-sm font-bold text-[#172033] dark:text-white">
              Remove Color &ldquo;{confirmDeleteColor.colorName}&rdquo;?
            </h4>
            <p className="text-xs text-[#64748B] dark:text-slate-400">
              All photos linked to <span className="font-semibold">{confirmDeleteColor.colorName}</span> will be deleted. Product variants and inventory stock remain intact.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setConfirmDeleteColor(null)}
                className="px-3.5 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#162344] rounded-lg cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeleteColorConfirmed}
                className="px-4 py-1.5 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-lg cursor-pointer"
              >
                Remove Color
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
