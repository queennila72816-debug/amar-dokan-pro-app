import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Download,
  ExternalLink,
  FileDown,
  Image as ImageIcon,
  Layers,
  Loader2,
  Palette,
  PenTool,
  Printer,
  QrCode,
  RefreshCw,
  Save,
  Sparkles,
  Trash2,
  Upload,
  UserCheck,
  Wand2,
  X,
} from 'lucide-react';
import {
  Branch,
  ComboOffer,
  ComboPosterConfig,
  MasterImageType,
  PosterCustomProject,
  PosterDimensionPreset,
  PosterModelCategory,
  PosterMode,
  PosterTemplateId,
  PosterUserTemplate,
  Product,
  ShopSettings,
} from '../../types';
import {
  POSTER_DIMENSION_PRESETS,
  POSTER_TEMPLATES,
  RenderedPosterResult,
  analyzeComboForPosterDesign,
  buildCompactPosterDataUrl,
  buildDefaultPosterConfig,
  buildPosterFilename,
  downloadPosterCanvasesAsImages,
  downloadPosterCanvasesAsPdf,
  getBusinessCompletenessIssues,
  printPosterCanvases,
  renderComboMasterCompositionDataUrl,
  renderComboPosterToCanvases,
  resolveComboMarketplaceQrUrl,
  resolvePosterDimensions,
  resolvePosterProductItems,
} from '../../utils/comboPosterEngine';
import {
  POSTER_MODEL_PRESETS,
  resolveModelAssetSelection,
} from '../../utils/posterModelAssets';
import {
  clearPosterStudioDraft,
  deleteCustomPosterTemplate,
  generateEditableLayersFromStyleZoneConfig,
  loadCustomPosterTemplates,
  loadPosterStudioDraft,
  renderCustomPosterProjectToCanvas,
  saveCustomPosterTemplate,
  savePosterStudioDraft,
} from '../../utils/customPosterProjectEngine';
import { CustomPosterEditor } from './CustomPosterEditor';
import { validateImageFile } from '../../services/catalogImageService';
import { formatCurrency } from '../../utils/formatters';
import { supabase } from '../../lib/supabase';

interface ComboPosterStudioModalProps {
  offer: ComboOffer;
  products: Product[];
  settings: ShopSettings;
  activeBranch?: Branch | null;
  onClose: () => void;
  onSaveOfferPosterData: (updates: Partial<ComboOffer>) => Promise<void>;
  onOpenSettings?: () => void;
}

const compressPosterOverrideImage = (file: File, maxDim = 960): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          const ratio = Math.min(maxDim / width, maxDim / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(String(reader.result));
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        const keepPng = file.type === 'image/png' || file.type === 'image/webp';
        resolve(keepPng ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', 0.88));
      };
      img.onerror = () => reject(new Error('Could not decode uploaded image.'));
      img.src = String(reader.result);
    };
    reader.onerror = () => reject(new Error('Could not read uploaded file.'));
    reader.readAsDataURL(file);
  });

const imageUrlToBase64Part = async (
  src: string
): Promise<{ mimeType: string; data: string } | null> => {
  try {
    if (src.startsWith('data:')) {
      const match = /^data:([^;]+);base64,(.+)$/i.exec(src);
      if (match) return { mimeType: match[1], data: match[2] };
      return null;
    }
    const res = await fetch(src, { mode: 'cors', credentials: 'omit' });
    if (!res.ok) return null;
    const blob = await res.blob();
    return new Promise(resolve => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const str = String(reader.result || '');
        const match = /^data:([^;]+);base64,(.+)$/i.exec(str);
        resolve(match ? { mimeType: match[1], data: match[2] } : null);
      };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
};

export const ComboPosterStudioModal: React.FC<ComboPosterStudioModalProps> = ({
  offer,
  products,
  settings,
  activeBranch,
  onClose,
  onSaveOfferPosterData,
  onOpenSettings,
}) => {
  const lang = settings.language || 'en';
  const [config, setConfig] = useState<ComboPosterConfig>(() =>
    buildDefaultPosterConfig(offer, products, offer.posterConfig)
  );
  const [studioMode, setStudioMode] = useState<'ai_creative' | 'custom_studio'>(() =>
    offer.posterConfig?.mode === 'custom_studio' ? 'custom_studio' : 'ai_creative'
  );
  const [previewTab, setPreviewTab] = useState<'poster' | 'product_composition'>('poster');
  const [activePageIdx, setActivePageIdx] = useState(0);
  const [rendering, setRendering] = useState(false);
  const [rendered, setRendered] = useState<RenderedPosterResult | null>(null);
  const [compositionPreviewUrl, setCompositionPreviewUrl] = useState<string>('');
  const [savingAction, setSavingAction] = useState<string | null>(null);
  const [aiStatus, setAiStatus] = useState<{ checked: boolean; configured: boolean }>({
    checked: false,
    configured: false,
  });
  const [aiGenerating, setAiGenerating] = useState(false);
  const [feedback, setFeedback] = useState<{
    tone: 'success' | 'warning' | 'error';
    text: string;
  } | null>(null);
  const [masterConfirmPending, setMasterConfirmPending] = useState<{
    actionLabel: string;
    nextImage: string;
    nextType: MasterImageType;
  } | null>(null);
  const [userTemplates, setUserTemplates] = useState<PosterUserTemplate[]>(() =>
    loadCustomPosterTemplates(offer.businessId || 'default')
  );
  const [availableDraft, setAvailableDraft] = useState<{
    savedAt: string;
    config: ComboPosterConfig;
  } | null>(() => {
    const draft = loadPosterStudioDraft(offer.id);
    if (!draft) return null;
    const savedAt = offer.posterConfig?.updatedAt || offer.updatedAt || '';
    if (!savedAt || new Date(draft.savedAt).getTime() > new Date(savedAt).getTime()) {
      return draft;
    }
    return null;
  });

  const previewImgCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Query backend once to check if Gemini API Key is configured in environment secrets
  useEffect(() => {
    let cancelled = false;
    fetch('/api/posters/ai-status')
      .then(r => (r.ok ? r.json() : { configured: false }))
      .then(data => {
        if (!cancelled) {
          setAiStatus({ checked: true, configured: Boolean(data?.configured) });
        }
      })
      .catch(() => {
        if (!cancelled) setAiStatus({ checked: true, configured: false });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const resolvedItems = useMemo(
    () => resolvePosterProductItems(offer, products, config.posterProductImages),
    [offer, products, config.posterProductImages]
  );

  const autoAnalysis = useMemo(
    () => analyzeComboForPosterDesign(offer, resolvedItems),
    [offer, resolvedItems]
  );

  const resolvedModel = useMemo(
    () =>
      resolveModelAssetSelection({
        modelCategory: config.modelCategory,
        customModelImageUrl: config.customModelImageUrl,
        aiGeneratedModelUrl: config.aiGeneratedModelUrl,
        offer,
        items: resolvedItems,
      }),
    [config.modelCategory, config.customModelImageUrl, config.aiGeneratedModelUrl, offer, resolvedItems]
  );

  const missingImageItems = useMemo(
    () => resolvedItems.filter(it => it.hasMissingImage),
    [resolvedItems]
  );

  const bizIssues = useMemo(
    () => getBusinessCompletenessIssues(settings, activeBranch),
    [settings, activeBranch]
  );

  const qrResolved = useMemo(
    () => resolveComboMarketplaceQrUrl(offer, settings, config.customQrUrl),
    [offer, settings, config.customQrUrl]
  );

  const dims = useMemo(() => {
    if (studioMode === 'custom_studio' && config.customDesign) {
      return {
        widthPx: config.customDesign.canvasWidth,
        heightPx: config.customDesign.canvasHeight,
        spec: POSTER_DIMENSION_PRESETS[config.dimensionPreset] || POSTER_DIMENSION_PRESETS.custom,
      };
    }
    return resolvePosterDimensions(config);
  }, [studioMode, config]);

  // Debounced auto-save draft cleanly to localStorage while editing
  useEffect(() => {
    const timer = setTimeout(() => {
      savePosterStudioDraft(offer.id, config);
    }, 1200);
    return () => clearTimeout(timer);
  }, [offer.id, config]);

  // Render Mode 1 high-DPI Poster & Product-Only Composition whenever config changes
  useEffect(() => {
    let cancelled = false;
    setRendering(true);

    const timer = setTimeout(async () => {
      try {
        const [posterRes, compUrl] = await Promise.all([
          renderComboPosterToCanvases({
            offer,
            products,
            settings,
            activeBranch,
            config,
            modelImageUrl: resolvedModel.imageUrl,
          }),
          renderComboMasterCompositionDataUrl(
            offer,
            products,
            config.posterProductImages,
            720
          ),
        ]);
        if (!cancelled) {
          setRendered(posterRes);
          setCompositionPreviewUrl(compUrl);
          setActivePageIdx(prev =>
            Math.min(prev, Math.max(0, posterRes.canvases.length - 1))
          );
        }
      } catch (err: any) {
        if (!cancelled) {
          setFeedback({
            tone: 'error',
            text: err?.message || 'Failed to render combo poster preview.',
          });
        }
      } finally {
        if (!cancelled) setRendering(false);
      }
    }, 90);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [offer, products, settings, activeBranch, config, resolvedModel.imageUrl]);

  // Blit active Mode 1 canvas into visible preview canvas
  useEffect(() => {
    if (studioMode !== 'ai_creative') return;
    const dest = previewImgCanvasRef.current;
    const src = rendered?.canvases[activePageIdx];
    if (!dest || !src || previewTab !== 'poster') return;
    dest.width = src.width;
    dest.height = src.height;
    const ctx = dest.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, dest.width, dest.height);
      ctx.drawImage(src, 0, 0);
    }
  }, [studioMode, rendered, activePageIdx, previewTab]);

  // Produce final export canvases for EITHER Mode 1 or Mode 2 cleanly
  const buildExportCanvases = useCallback(async (): Promise<{
    canvases: HTMLCanvasElement[];
    widthPx: number;
    heightPx: number;
  } | null> => {
    if (studioMode === 'custom_studio' && config.customDesign) {
      const customCanvas = await renderCustomPosterProjectToCanvas(config.customDesign);
      return {
        canvases: [customCanvas],
        widthPx: customCanvas.width,
        heightPx: customCanvas.height,
      };
    }
    if (!rendered || rendered.canvases.length === 0) return null;
    return {
      canvases: rendered.canvases,
      widthPx: rendered.widthPx,
      heightPx: rendered.heightPx,
    };
  }, [studioMode, config.customDesign, rendered]);

  const openInCustomStudio = useCallback(
    (forceRegenerateFromMode1 = false) => {
      setConfig(prev => {
        const nextProject =
          !forceRegenerateFromMode1 && prev.customDesign && prev.customDesign.layers.length > 0
            ? prev.customDesign
            : generateEditableLayersFromStyleZoneConfig({
                offer,
                products,
                settings,
                activeBranch,
                config: prev,
                modelImageUrl: resolvedModel.imageUrl,
              });
        return {
          ...prev,
          mode: 'custom_studio',
          customDesign: nextProject,
        };
      });
      setStudioMode('custom_studio');
      setFeedback({
        tone: 'success',
        text: forceRegenerateFromMode1
          ? 'Style Zone poster converted into fully editable Custom Design Studio layers.'
          : 'Custom Design Studio ready — drag, resize, rotate, edit text, crop, or remove backgrounds.',
      });
    },
    [offer, products, settings, activeBranch, resolvedModel.imageUrl]
  );

  const handleModeSwitch = (target: 'ai_creative' | 'custom_studio') => {
    if (target === 'custom_studio') {
      openInCustomStudio(false);
    } else {
      setStudioMode('ai_creative');
      setConfig(prev => ({
        ...prev,
        mode: prev.templateId === 'style_zone_reference' ? 'ai_creative' : 'template',
      }));
    }
  };

  const applyTemplatePreset = (templateId: PosterTemplateId, nextMode: PosterMode = 'ai_creative') => {
    const tpl = POSTER_TEMPLATES.find(t => t.id === templateId) || POSTER_TEMPLATES[0];
    setConfig(prev => ({
      ...prev,
      mode: nextMode,
      templateId: tpl.id,
      backgroundColor: tpl.backgroundColor,
      secondaryColor: tpl.secondaryColor,
      accentColor: tpl.accentColor,
      textColor: tpl.textColor,
      promoText: nextMode === 'ai_creative' || nextMode === 'auto' ? autoAnalysis.promoText : tpl.badgeText,
    }));
  };

  const applyCustomUserTemplate = (userTpl: PosterUserTemplate) => {
    setConfig(prev => ({
      ...prev,
      mode: 'custom_studio',
      customDesign: {
        ...userTpl.project,
        updatedAt: new Date().toISOString(),
      },
    }));
    setStudioMode('custom_studio');
    setFeedback({
      tone: 'success',
      text: `Loaded custom reusable template "${userTpl.name}".`,
    });
  };

  const handleUploadPosterItemImage = async (itemKey: string, file: File | null) => {
    if (!file) return;
    const validation = validateImageFile(file);
    if (!validation.valid) {
      setFeedback({ tone: 'error', text: validation.error || 'Invalid image file.' });
      return;
    }
    try {
      const dataUrl = await compressPosterOverrideImage(file, 720);
      setConfig(prev => ({
        ...prev,
        posterProductImages: {
          ...(prev.posterProductImages || {}),
          [itemKey]: dataUrl,
        },
      }));
      setFeedback({
        tone: 'success',
        text: 'Poster product image updated (original inventory image stays untouched).',
      });
    } catch (err: any) {
      setFeedback({ tone: 'error', text: err?.message || 'Image upload failed.' });
    }
  };

  const handleUploadCustomModelPhoto = async (file: File | null) => {
    if (!file) return;
    const validation = validateImageFile(file);
    if (!validation.valid) {
      setFeedback({ tone: 'error', text: validation.error || 'Invalid model image file.' });
      return;
    }
    try {
      const dataUrl = await compressPosterOverrideImage(file, 1080);
      setConfig(prev => ({
        ...prev,
        customModelImageUrl: dataUrl,
        aiGeneratedModelUrl: undefined,
      }));
      setFeedback({
        tone: 'success',
        text: 'Custom model image uploaded cleanly for this combo poster.',
      });
    } catch (err: any) {
      setFeedback({ tone: 'error', text: err?.message || 'Model image upload failed.' });
    }
  };

  const handleGeminiAiOutfitRender = async () => {
    setAiGenerating(true);
    try {
      const token = (await supabase.auth.getSession()).data?.session?.access_token;

      const refParts: Array<{ mimeType: string; data: string }> = [];
      for (const item of resolvedItems.slice(0, 3)) {
        if (item.imageUrl) {
          const part = await imageUrlToBase64Part(item.imageUrl);
          if (part) refParts.push(part);
        }
      }

      const res = await fetch('/api/posters/ai-generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          businessId: offer.businessId,
          comboName: offer.name,
          modelCategory:
            resolvedModel.effectivePersona === 'custom' || resolvedModel.effectivePersona === 'none'
              ? 'male'
              : resolvedModel.effectivePersona,
          productNames: resolvedItems.map(i => i.productName),
          referenceImages: refParts,
        }),
      });

      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFeedback({
          tone: res.status === 501 || payload?.code === 'GEMINI_API_KEY_NOT_CONFIGURED' ? 'warning' : 'error',
          text:
            payload?.error ||
            'AI Outfit Generation requires a server GEMINI_API_KEY. Use the built-in 6 Fashion Models or upload your own model image anytime.',
        });
        return;
      }

      if (payload?.imageDataUrl) {
        setConfig(prev => ({
          ...prev,
          aiGeneratedModelUrl: payload.imageDataUrl,
        }));
        setFeedback({
          tone: 'success',
          text: 'Gemini AI Outfit Model rendered using your combo products!',
        });
      }
    } catch (err: any) {
      setFeedback({
        tone: 'error',
        text: err?.message || 'Unable to reach AI Outfit Rendering endpoint.',
      });
    } finally {
      setAiGenerating(false);
    }
  };

  const handleResetPosterItemOverride = (itemKey: string) => {
    setConfig(prev => {
      const nextMap = { ...(prev.posterProductImages || {}) };
      delete nextMap[itemKey];
      return { ...prev, posterProductImages: nextMap };
    });
  };

  const ensureReadyForFinalOutput = (): boolean => {
    if (studioMode === 'custom_studio' && config.customDesign) {
      if (config.customDesign.layers.length === 0) {
        setFeedback({
          tone: 'warning',
          text: 'Custom canvas has no objects yet. Add items or click "Import AI Poster".',
        });
        return false;
      }
      return true;
    }
    if (!rendered || rendered.canvases.length === 0) {
      setFeedback({ tone: 'warning', text: 'Poster preview is still rendering. Please wait a second.' });
      return false;
    }
    if (missingImageItems.length > 0) {
      setFeedback({
        tone: 'warning',
        text: `${missingImageItems.length} product image(s) missing (${missingImageItems.map(i => i.productName).join(', ')}). Upload missing product images before final export.`,
      });
      return false;
    }
    return true;
  };

  const handleSavePosterOnly = async () => {
    const exported = await buildExportCanvases();
    if (!exported || exported.canvases.length === 0) return;
    setSavingAction('save_poster');
    try {
      const compactPosterUrl = buildCompactPosterDataUrl(exported.canvases[0], 720);
      const nextConfig: ComboPosterConfig = {
        ...config,
        mode: studioMode === 'custom_studio' ? 'custom_studio' : config.mode,
        updatedAt: new Date().toISOString(),
      };
      await onSaveOfferPosterData({
        posterImageUrl: compactPosterUrl,
        posterConfig: nextConfig,
      });
      clearPosterStudioDraft(offer.id);
      setAvailableDraft(null);
      setFeedback({
        tone: 'success',
        text:
          studioMode === 'custom_studio'
            ? 'Editable Custom Design Studio project saved! Reopen anytime to keep editing.'
            : 'Combo Poster saved cleanly (existing Master Image & inventory remain untouched).',
      });
    } catch (err: any) {
      setFeedback({ tone: 'error', text: err?.message || 'Failed to save poster configuration.' });
    } finally {
      setSavingAction(null);
    }
  };

  const commitMasterImageUpdate = async (
    nextImage: string,
    nextType: MasterImageType,
    label: string
  ) => {
    setSavingAction('master_image');
    try {
      const exported = await buildExportCanvases();
      const compactPosterUrl =
        exported && exported.canvases.length > 0
          ? buildCompactPosterDataUrl(exported.canvases[0], 720)
          : offer.posterImageUrl;

      await onSaveOfferPosterData({
        image: nextImage || undefined,
        masterImageType: nextImage ? nextType : undefined,
        posterImageUrl: compactPosterUrl,
        posterConfig: {
          ...config,
          updatedAt: new Date().toISOString(),
        },
      });
      setMasterConfirmPending(null);
      setFeedback({ tone: 'success', text: label });
    } catch (err: any) {
      setFeedback({ tone: 'error', text: err?.message || 'Failed to update Combo Master Image.' });
    } finally {
      setSavingAction(null);
    }
  };

  const requestMasterImageAction = (
    nextImage: string,
    nextType: MasterImageType,
    actionLabel: string
  ) => {
    if (offer.image && offer.image.trim().length > 0) {
      setMasterConfirmPending({ actionLabel, nextImage, nextType });
    } else {
      commitMasterImageUpdate(nextImage, nextType, actionLabel);
    }
  };

  const handleCustomMasterUpload = async (file: File | null) => {
    if (!file) return;
    const validation = validateImageFile(file);
    if (!validation.valid) {
      setFeedback({ tone: 'error', text: validation.error || 'Invalid image file.' });
      return;
    }
    try {
      const dataUrl = await compressPosterOverrideImage(file, 720);
      requestMasterImageAction(
        dataUrl,
        'custom',
        'Custom image applied as Combo Master Image.'
      );
    } catch (err: any) {
      setFeedback({ tone: 'error', text: err?.message || 'Could not process master image file.' });
    }
  };

  const handleDownloadPng = async () => {
    if (!ensureReadyForFinalOutput()) return;
    const exported = await buildExportCanvases();
    if (!exported) return;
    downloadPosterCanvasesAsImages(
      exported.canvases,
      'png',
      buildPosterFilename(offer.name, config.dimensionPreset)
    );
    setFeedback({ tone: 'success', text: 'High-resolution PNG poster downloaded.' });
  };

  const handleDownloadJpg = async () => {
    if (!ensureReadyForFinalOutput()) return;
    const exported = await buildExportCanvases();
    if (!exported) return;
    downloadPosterCanvasesAsImages(
      exported.canvases,
      'jpeg',
      buildPosterFilename(offer.name, config.dimensionPreset)
    );
    setFeedback({ tone: 'success', text: 'High-resolution JPG poster downloaded.' });
  };

  const handleDownloadPdf = async () => {
    if (!ensureReadyForFinalOutput()) return;
    const exported = await buildExportCanvases();
    if (!exported) return;
    downloadPosterCanvasesAsPdf(
      exported.canvases,
      config.dimensionPreset,
      exported.widthPx,
      exported.heightPx,
      buildPosterFilename(offer.name, config.dimensionPreset)
    );
    setFeedback({
      tone: 'success',
      text:
        exported.canvases.length > 1
          ? `Multi-page PDF (${exported.canvases.length} pages) downloaded with all ${resolvedItems.length} products.`
          : 'Print-ready PDF poster downloaded.',
    });
  };

  const handlePrintPoster = async () => {
    if (!ensureReadyForFinalOutput()) return;
    const exported = await buildExportCanvases();
    if (!exported) return;
    const res = printPosterCanvases(
      exported.canvases,
      config.dimensionPreset,
      exported.widthPx,
      exported.heightPx,
      `${offer.name} — Combo Poster`
    );
    if (!res.opened && !res.cancelled) {
      setFeedback({ tone: 'error', text: res.error || 'Failed to open print dialog.' });
    }
  };

  const handleSaveAsUserTemplate = async (name: string, category: string) => {
    if (!config.customDesign) return;
    const canvas = await renderCustomPosterProjectToCanvas(config.customDesign);
    const thumb = buildCompactPosterDataUrl(canvas, 320);
    const tpl: PosterUserTemplate = {
      id: `utpl_${Date.now().toString(36)}`,
      name,
      category,
      thumbnailDataUrl: thumb,
      project: config.customDesign,
      createdAt: new Date().toISOString(),
    };
    const nextList = saveCustomPosterTemplate(offer.businessId || 'default', tpl);
    setUserTemplates(nextList);
    setFeedback({
      tone: 'success',
      text: `Saved "${name}" to your Reusable Template Library!`,
    });
  };

  const activeCustomProject: PosterCustomProject = useMemo(() => {
    if (config.customDesign) return config.customDesign;
    return generateEditableLayersFromStyleZoneConfig({
      offer,
      products,
      settings,
      activeBranch,
      config,
      modelImageUrl: resolvedModel.imageUrl,
    });
  }, [config, offer, products, settings, activeBranch, resolvedModel.imageUrl]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-xs p-1 sm:p-3">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-[1520px] h-[95vh] flex flex-col overflow-hidden">
        {/* TOP HEADER + 2-MODE SWITCHER + EXPORT BAR */}
        <div className="px-3 sm:px-5 py-2.5 border-b border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-2.5 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-[#D91E2A] text-[#FFD21F] flex items-center justify-center shrink-0 shadow-xs">
              <Sparkles className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-extrabold text-slate-900 truncate">
                PROTIVA Combo Poster Studio — {offer.name}
              </h2>
              <p className="text-[11px] text-slate-500">
                {resolvedItems.length} item(s) · {dims.widthPx}×{dims.heightPx}px ·{' '}
                <strong className="text-slate-800 font-mono-num">
                  {formatCurrency(offer.finalComboPrice, lang)}
                </strong>
              </p>
            </div>
          </div>

          {/* 2 DESIGN MODES SWITCHER */}
          <div className="inline-flex p-1 rounded-xl bg-slate-200/80 border border-slate-300">
            <button
              type="button"
              onClick={() => handleModeSwitch('ai_creative')}
              className={`px-3 py-1.5 rounded-lg text-xs font-extrabold inline-flex items-center gap-1.5 transition-all cursor-pointer whitespace-nowrap ${
                studioMode === 'ai_creative'
                  ? 'bg-[#101B3F] text-white shadow-xs'
                  : 'text-slate-700 hover:text-slate-950'
              }`}
            >
              <Wand2 className="w-3.5 h-3.5 text-[#FFD21F]" />
              <span>1. AI Creative Design</span>
            </button>
            <button
              type="button"
              onClick={() => handleModeSwitch('custom_studio')}
              className={`px-3 py-1.5 rounded-lg text-xs font-extrabold inline-flex items-center gap-1.5 transition-all cursor-pointer whitespace-nowrap ${
                studioMode === 'custom_studio'
                  ? 'bg-[#D91E2A] text-white shadow-xs'
                  : 'text-slate-700 hover:text-slate-950'
              }`}
            >
              <PenTool className="w-3.5 h-3.5 text-[#FFD21F]" />
              <span>2. Custom Design Studio</span>
            </button>
          </div>

          {/* EXPORT & SAVE TOOLBAR */}
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              disabled={savingAction === 'save_poster' || (studioMode === 'ai_creative' && rendering)}
              onClick={handleSavePosterOnly}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-slate-800 text-xs font-bold whitespace-nowrap cursor-pointer disabled:opacity-50"
            >
              {savingAction === 'save_poster' ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Save className="w-3.5 h-3.5" />
              )}
              <span>Save Project</span>
            </button>

            <button
              type="button"
              onClick={handleDownloadPng}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-900 text-white text-xs font-bold whitespace-nowrap cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>PNG</span>
            </button>

            <button
              type="button"
              onClick={handleDownloadJpg}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-800 text-white text-xs font-bold whitespace-nowrap cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>JPG</span>
            </button>

            <button
              type="button"
              onClick={handleDownloadPdf}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-xs font-bold whitespace-nowrap cursor-pointer"
            >
              <FileDown className="w-3.5 h-3.5" />
              <span>PDF</span>
            </button>

            <button
              type="button"
              onClick={handlePrintPoster}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#101B3F] hover:bg-[#19295c] text-white text-xs font-bold whitespace-nowrap cursor-pointer"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Print</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              aria-label="Close Poster Studio"
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200/70 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* AUTO-SAVE DRAFT RECOVERY BANNER */}
        {availableDraft && (
          <div className="px-4 py-2 bg-cyan-50 border-b border-cyan-200 text-xs flex flex-wrap items-center justify-between gap-2 shrink-0 text-cyan-950">
            <span>
              Unsaved auto-saved draft found from{' '}
              <strong>{new Date(availableDraft.savedAt).toLocaleString()}</strong>.
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setConfig(availableDraft.config);
                  if (availableDraft.config.mode === 'custom_studio') {
                    setStudioMode('custom_studio');
                  }
                  setAvailableDraft(null);
                  setFeedback({ tone: 'success', text: 'Restored auto-saved studio draft.' });
                }}
                className="px-2.5 py-1 rounded-lg bg-cyan-700 text-white font-bold cursor-pointer"
              >
                Restore Draft
              </button>
              <button
                type="button"
                onClick={() => {
                  clearPosterStudioDraft(offer.id);
                  setAvailableDraft(null);
                }}
                className="px-2 py-1 rounded-lg text-cyan-800 hover:bg-cyan-100 font-semibold cursor-pointer"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        {/* NOTIFICATION / STATUS STRIP */}
        {feedback && (
          <div
            className={`px-5 py-2 border-b text-xs font-semibold flex items-center justify-between gap-3 shrink-0 ${
              feedback.tone === 'success'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                : feedback.tone === 'warning'
                ? 'bg-amber-50 border-amber-200 text-amber-950'
                : 'bg-rose-50 border-rose-200 text-rose-900'
            }`}
          >
            <div className="flex items-center gap-2">
              {feedback.tone === 'success' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              ) : (
                <AlertTriangle className="w-4 h-4 shrink-0" />
              )}
              <span>{feedback.text}</span>
            </div>
            <button
              type="button"
              onClick={() => setFeedback(null)}
              className="p-0.5 rounded hover:bg-black/5 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* MAIN CONTENT AREA: MODE 1 VS MODE 2 */}
        {studioMode === 'custom_studio' ? (
          <CustomPosterEditor
            project={activeCustomProject}
            offer={offer}
            products={products}
            settings={settings}
            activeBranch={activeBranch}
            dimensionPreset={config.dimensionPreset}
            posterProductImages={config.posterProductImages}
            onChangeProject={nextProject =>
              setConfig(prev => ({
                ...prev,
                mode: 'custom_studio',
                customDesign: nextProject,
              }))
            }
            onChangeDimensionPreset={(nextPreset, w, h) =>
              setConfig(prev => ({
                ...prev,
                dimensionPreset: nextPreset,
                customWidthPx: nextPreset === 'custom' ? w : prev.customWidthPx,
                customHeightPx: nextPreset === 'custom' ? h : prev.customHeightPx,
                customDesign: prev.customDesign
                  ? { ...prev.customDesign, canvasWidth: w, canvasHeight: h }
                  : prev.customDesign,
              }))
            }
            onResetFromAiDesign={() => openInCustomStudio(true)}
            onSaveAsTemplate={handleSaveAsUserTemplate}
            onNotify={(tone, text) => setFeedback({ tone, text })}
          />
        ) : (
          <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 overflow-hidden">
            {/* LEFT MODE 1 CONTROLS SIDEBAR */}
            <div className="lg:col-span-5 xl:col-span-4 border-r border-slate-200 bg-white overflow-y-auto p-4 space-y-5 text-xs">
              {/* OPEN IN CUSTOM DESIGN STUDIO CALLOUT */}
              <div className="p-3 rounded-xl bg-slate-900 text-white flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-extrabold text-xs text-[#FFD21F]">
                    Want full drag-and-drop editing?
                  </div>
                  <div className="text-[11px] text-slate-300">
                    Convert this poster into editable layers, crop photos, change fonts, or move any object.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => openInCustomStudio(true)}
                  className="px-3 py-2 rounded-lg bg-[#FFD21F] hover:bg-amber-300 text-slate-950 font-extrabold text-[11px] shrink-0 whitespace-nowrap cursor-pointer"
                >
                  Open in Studio
                </button>
              </div>

              {/* BUSINESS COMPLETENESS CHECK */}
              {(bizIssues.missingFields.length > 0 || !bizIssues.hasMarketplaceUrl) && (
                <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-amber-900 flex items-center gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                      Business Settings Notice
                    </span>
                    {onOpenSettings && (
                      <button
                        type="button"
                        onClick={() => {
                          onClose();
                          onOpenSettings();
                        }}
                        className="text-[11px] font-bold text-teal-700 hover:underline inline-flex items-center gap-1 cursor-pointer"
                      >
                        <span>Open Settings</span>
                        <ExternalLink className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                  {bizIssues.missingFields.length > 0 && (
                    <p className="text-[11px] text-amber-800">
                      Incomplete store details: <strong>{bizIssues.missingFields.join(', ')}</strong>.
                    </p>
                  )}
                  {!bizIssues.hasMarketplaceUrl && (
                    <p className="text-[11px] text-amber-800">
                      Marketplace URL not configured yet — add one below or in Settings for a scannable QR code.
                    </p>
                  )}
                </div>
              )}

              {/* MODEL SELECTION (AUTO / MALE / FEMALE / COUPLE / FAMILY / BOYS / GIRLS / CUSTOM UPLOAD) */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-slate-900 flex items-center gap-1.5">
                    <UserCheck className="w-4 h-4 text-[#D91E2A]" />
                    <span>Fashion Model Showcase</span>
                  </h3>
                  <span className="text-[10px] font-bold text-slate-500">
                    Active: {resolvedModel.label}
                  </span>
                </div>

                <div className="grid grid-cols-4 gap-1.5">
                  <button
                    type="button"
                    onClick={() =>
                      setConfig(prev => ({
                        ...prev,
                        modelCategory: 'auto',
                        customModelImageUrl: undefined,
                        aiGeneratedModelUrl: undefined,
                      }))
                    }
                    className={`p-2 rounded-xl border text-center text-[11px] font-bold cursor-pointer ${
                      (config.modelCategory || 'auto') === 'auto' &&
                      !config.customModelImageUrl &&
                      !config.aiGeneratedModelUrl
                        ? 'border-[#D91E2A] bg-rose-50 text-[#D91E2A]'
                        : 'border-slate-200 bg-slate-50 text-slate-700'
                    }`}
                  >
                    Auto
                  </button>

                  {POSTER_MODEL_PRESETS.map(m => {
                    const selected =
                      config.modelCategory === m.id &&
                      !config.customModelImageUrl &&
                      !config.aiGeneratedModelUrl;
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() =>
                          setConfig(prev => ({
                            ...prev,
                            modelCategory: m.id as PosterModelCategory,
                            customModelImageUrl: undefined,
                            aiGeneratedModelUrl: undefined,
                          }))
                        }
                        className={`p-1.5 rounded-xl border text-center cursor-pointer transition-all ${
                          selected
                            ? 'border-[#D91E2A] bg-rose-50 ring-2 ring-[#D91E2A]/20'
                            : 'border-slate-200 bg-white hover:border-slate-300'
                        }`}
                      >
                        <div className="aspect-[3/4] rounded-lg overflow-hidden bg-slate-100 mb-1">
                          <img src={m.imageUrl} alt={m.label} className="w-full h-full object-cover" />
                        </div>
                        <div className="text-[10px] font-bold text-slate-800 truncate">
                          {m.shortLabel}
                        </div>
                      </button>
                    );
                  })}

                  <button
                    type="button"
                    onClick={() =>
                      setConfig(prev => ({
                        ...prev,
                        modelCategory: 'none',
                        customModelImageUrl: undefined,
                        aiGeneratedModelUrl: undefined,
                      }))
                    }
                    className={`p-2 rounded-xl border text-center text-[11px] font-bold cursor-pointer ${
                      config.modelCategory === 'none'
                        ? 'border-slate-800 bg-slate-900 text-white'
                        : 'border-slate-200 bg-slate-50 text-slate-600'
                    }`}
                  >
                    No Model
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <label className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-[11px] font-bold inline-flex items-center gap-1.5 cursor-pointer">
                    <Upload className="w-3.5 h-3.5" />
                    <span>Upload Your Model Photo</span>
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      className="hidden"
                      onChange={e => {
                        handleUploadCustomModelPhoto(e.target.files?.[0] || null);
                        e.target.value = '';
                      }}
                    />
                  </label>

                  <label className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={config.removeModelBg !== false}
                      onChange={e =>
                        setConfig(prev => ({ ...prev, removeModelBg: e.target.checked }))
                      }
                      className="rounded text-[#D91E2A]"
                    />
                    <span>Clean White Bg Cutout</span>
                  </label>
                </div>

                {/* OPTIONAL GEMINI AI OUTFIT RENDER (SERVER SECRET KEY READY — NEVER FAKE) */}
                <div className="p-2.5 rounded-xl border border-slate-200 bg-slate-50 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-slate-800 flex items-center gap-1">
                      <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                      <span>AI Outfit Synthesis (Gemini)</span>
                    </span>
                    <button
                      type="button"
                      disabled={aiGenerating}
                      onClick={handleGeminiAiOutfitRender}
                      className="px-2.5 py-1 rounded-lg bg-[#101B3F] hover:bg-[#19295c] text-white text-[10px] font-bold cursor-pointer disabled:opacity-50 inline-flex items-center gap-1"
                    >
                      {aiGenerating ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <Wand2 className="w-3 h-3" />
                      )}
                      <span>{aiGenerating ? 'Generating...' : 'Generate AI Model'}</span>
                    </button>
                  </div>
                  {aiStatus.checked && !aiStatus.configured && (
                    <p className="text-[10px] text-amber-800">
                      Requires <code>GEMINI_API_KEY</code> in server environment secrets. Style Zone generator, 6 built-in models, and Custom Design Studio work without any API key.
                    </p>
                  )}
                </div>
              </div>

              {/* COMBO PRODUCT IMAGES */}
              <div className="space-y-2 pt-2 border-t border-slate-200">
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-slate-900 flex items-center gap-1.5">
                    <ImageIcon className="w-4 h-4 text-teal-600" />
                    <span>Combo Product Images ({resolvedItems.length})</span>
                  </h3>
                  {missingImageItems.length === 0 ? (
                    <span className="text-[11px] font-bold text-emerald-700 flex items-center gap-1">
                      <Check className="w-3.5 h-3.5" />
                      All Ready
                    </span>
                  ) : (
                    <span className="text-[11px] font-bold text-rose-600">
                      {missingImageItems.length} Missing
                    </span>
                  )}
                </div>

                <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                  {resolvedItems.map(item => (
                    <div
                      key={item.itemKey}
                      className={`p-2 rounded-xl border flex items-center justify-between gap-2 ${
                        item.hasMissingImage
                          ? 'bg-rose-50/70 border-rose-200'
                          : 'bg-slate-50 border-slate-200'
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="w-9 h-9 rounded-lg bg-white border border-slate-200 flex items-center justify-center overflow-hidden shrink-0">
                          {item.imageUrl ? (
                            <img src={item.imageUrl} alt={item.productName} className="w-full h-full object-contain" />
                          ) : (
                            <span className="text-[9px] font-bold text-rose-500">MISSING</span>
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className="font-bold text-slate-900 truncate">
                            {item.quantity}× {item.productName}
                          </div>
                          <div className="text-[10px] text-slate-500 truncate">
                            {item.variantDetails || item.category}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        <label className="px-2 py-1 rounded-lg bg-white hover:bg-slate-100 border border-slate-300 text-[10px] font-bold text-slate-700 cursor-pointer whitespace-nowrap inline-flex items-center gap-1">
                          <Upload className="w-3 h-3" />
                          <span>{item.hasMissingImage ? 'Upload' : 'Swap'}</span>
                          <input
                            type="file"
                            accept="image/png,image/jpeg,image/webp"
                            className="hidden"
                            onChange={e => {
                              handleUploadPosterItemImage(item.itemKey, e.target.files?.[0] || null);
                              e.target.value = '';
                            }}
                          />
                        </label>
                        {item.imageSource === 'poster_override' && (
                          <button
                            type="button"
                            onClick={() => handleResetPosterItemOverride(item.itemKey)}
                            title="Revert to DB product photo"
                            className="p-1 text-slate-400 hover:text-rose-600 rounded cursor-pointer"
                          >
                            <RefreshCw className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* TEMPLATE LIBRARY + USER SAVED TEMPLATES */}
              <div className="space-y-2.5 pt-2 border-t border-slate-200">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-900 flex items-center gap-1.5">
                    <Palette className="w-4 h-4 text-[#D91E2A]" />
                    <span>Template Library ({POSTER_TEMPLATES.length})</span>
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 max-h-60 overflow-y-auto pr-1">
                  {POSTER_TEMPLATES.map(tpl => {
                    const selected = config.templateId === tpl.id;
                    return (
                      <button
                        key={tpl.id}
                        type="button"
                        onClick={() =>
                          applyTemplatePreset(
                            tpl.id,
                            tpl.id === 'style_zone_reference' ? 'ai_creative' : 'template'
                          )
                        }
                        className={`p-2 rounded-xl border text-left transition-all cursor-pointer ${
                          selected
                            ? 'border-[#D91E2A] ring-2 ring-[#D91E2A]/20 bg-rose-50/40'
                            : 'border-slate-200 hover:border-slate-300 bg-white'
                        }`}
                      >
                        <div
                          className="h-6 rounded-lg mb-1 flex items-center justify-between px-2 border border-black/10"
                          style={{
                            background: `linear-gradient(135deg, ${tpl.backgroundColor}, ${tpl.secondaryColor})`,
                          }}
                        >
                          <span
                            className="text-[8px] font-extrabold uppercase tracking-wider truncate"
                            style={{ color: tpl.textColor }}
                          >
                            {tpl.badgeText}
                          </span>
                          <span
                            className="w-2.5 h-2.5 rounded-full shrink-0 border border-white/40"
                            style={{ backgroundColor: tpl.accentColor }}
                          />
                        </div>
                        <div className="font-bold text-[11px] text-slate-900 truncate">
                          {tpl.name}
                        </div>
                      </button>
                    );
                  })}
                </div>

                {userTemplates.length > 0 && (
                  <div className="space-y-1.5 pt-2">
                    <div className="font-bold text-slate-800 text-[11px]">
                      Saved Custom Studio Templates ({userTemplates.length})
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {userTemplates.map(ut => (
                        <div
                          key={ut.id}
                          className="p-2 rounded-xl border border-slate-200 bg-slate-50 flex flex-col gap-1.5"
                        >
                          {ut.thumbnailDataUrl && (
                            <img
                              src={ut.thumbnailDataUrl}
                              alt={ut.name}
                              className="w-full h-16 object-cover rounded-lg border border-slate-200"
                            />
                          )}
                          <div className="font-bold text-[11px] text-slate-900 truncate">{ut.name}</div>
                          <div className="flex items-center justify-between gap-1">
                            <button
                              type="button"
                              onClick={() => applyCustomUserTemplate(ut)}
                              className="px-2 py-1 rounded bg-[#101B3F] text-white text-[10px] font-bold cursor-pointer"
                            >
                              Use Template
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setUserTemplates(
                                  deleteCustomPosterTemplate(offer.businessId || 'default', ut.id)
                                )
                              }
                              className="p-1 text-slate-400 hover:text-rose-600 cursor-pointer"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* DIMENSIONS & PRINT FORMAT */}
              <div className="space-y-2 pt-2 border-t border-slate-200">
                <label className="block font-bold text-slate-800">Poster Size &amp; Print Format</label>
                <select
                  aria-label="Poster Dimension Preset"
                  value={config.dimensionPreset}
                  onChange={e =>
                    setConfig(prev => ({
                      ...prev,
                      dimensionPreset: e.target.value as PosterDimensionPreset,
                    }))
                  }
                  className="w-full p-2 border border-slate-200 rounded-lg font-medium text-slate-800 bg-slate-50"
                >
                  {Object.values(POSTER_DIMENSION_PRESETS).map(preset => (
                    <option key={preset.id} value={preset.id}>
                      {preset.label}
                    </option>
                  ))}
                </select>
                {config.dimensionPreset === 'custom' && (
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="number"
                      min={480}
                      max={3600}
                      value={config.customWidthPx || 1080}
                      onChange={e =>
                        setConfig(prev => ({
                          ...prev,
                          customWidthPx: Number(e.target.value) || 1080,
                        }))
                      }
                      className="p-2 border border-slate-200 rounded-lg font-mono-num"
                    />
                    <input
                      type="number"
                      min={480}
                      max={3600}
                      value={config.customHeightPx || 1350}
                      onChange={e =>
                        setConfig(prev => ({
                          ...prev,
                          customHeightPx: Number(e.target.value) || 1350,
                        }))
                      }
                      className="p-2 border border-slate-200 rounded-lg font-mono-num"
                    />
                  </div>
                )}
              </div>

              {/* STYLE ZONE COPY, COLORS & SHOP OVERRIDES */}
              <div className="space-y-2.5 pt-2 border-t border-slate-200">
                <h3 className="font-bold text-slate-900">Poster Copy, Slogan &amp; Branding</h3>
                <div>
                  <label className="block text-[10px] font-semibold text-slate-500 mb-1">
                    Fashion Slogan
                  </label>
                  <input
                    type="text"
                    value={config.fashionSlogan || ''}
                    onChange={e => setConfig(prev => ({ ...prev, fashionSlogan: e.target.value }))}
                    className="w-full p-2 border border-slate-200 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-semibold text-slate-500 mb-1">
                    Combo Offer Headline
                  </label>
                  <input
                    type="text"
                    value={config.headline}
                    onChange={e => setConfig(prev => ({ ...prev, headline: e.target.value }))}
                    className="w-full p-2 border border-slate-200 rounded-lg"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] font-semibold text-slate-500 mb-1">
                      CTA Button Text
                    </label>
                    <input
                      type="text"
                      value={config.ctaText || ''}
                      onChange={e => setConfig(prev => ({ ...prev, ctaText: e.target.value }))}
                      className="w-full p-2 border border-slate-200 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold text-slate-500 mb-1">
                      Promo Pill
                    </label>
                    <input
                      type="text"
                      value={config.promoText}
                      onChange={e => setConfig(prev => ({ ...prev, promoText: e.target.value }))}
                      className="w-full p-2 border border-slate-200 rounded-lg"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-semibold text-slate-500 mb-1">
                    Trust &amp; Quality Line
                  </label>
                  <input
                    type="text"
                    value={config.trustLine || ''}
                    onChange={e => setConfig(prev => ({ ...prev, trustLine: e.target.value }))}
                    className="w-full p-2 border border-slate-200 rounded-lg"
                  />
                </div>

                <div className="grid grid-cols-4 gap-2">
                  {[
                    { key: 'backgroundColor' as const, label: 'Bg Start' },
                    { key: 'secondaryColor' as const, label: 'Brand Red' },
                    { key: 'accentColor' as const, label: 'Highlight' },
                    { key: 'textColor' as const, label: 'Text' },
                  ].map(c => (
                    <div key={c.key}>
                      <label className="block text-[10px] text-slate-500 mb-1">{c.label}</label>
                      <input
                        type="color"
                        value={config[c.key]}
                        onChange={e =>
                          setConfig(prev => ({
                            ...prev,
                            [c.key]: e.target.value,
                          }))
                        }
                        className="w-full h-8 p-0.5 border border-slate-200 rounded-lg cursor-pointer"
                      />
                    </div>
                  ))}
                </div>

                {/* REAL QR CODE SETTINGS */}
                <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-800 flex items-center gap-1">
                      <QrCode className="w-3.5 h-3.5 text-teal-600" />
                      <span>Scannable QR Code</span>
                    </span>
                    <input
                      type="checkbox"
                      checked={config.includeQrCode}
                      onChange={e =>
                        setConfig(prev => ({ ...prev, includeQrCode: e.target.checked }))
                      }
                      className="rounded text-teal-600"
                    />
                  </div>
                  <input
                    type="url"
                    value={config.customQrUrl || ''}
                    onChange={e => setConfig(prev => ({ ...prev, customQrUrl: e.target.value }))}
                    placeholder={
                      qrResolved.url ? qrResolved.url : 'https://yourstore.com/combo/...'
                    }
                    className="w-full p-1.5 border border-slate-200 bg-white rounded-lg text-[11px]"
                  />
                </div>
              </div>

              {/* COMBO MASTER IMAGE OPTIONS (ALL 5 PRESERVED ACTIONS) */}
              <div className="space-y-2 pt-2 border-t border-slate-200 pb-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-slate-900 flex items-center gap-1.5">
                    <Layers className="w-4 h-4 text-[#D6AD60]" />
                    <span>Combo Master Image Options</span>
                  </h3>
                  <span className="text-[10px] font-bold text-slate-500">
                    {offer.image ? 'Active' : 'Not Set'}
                  </span>
                </div>

                <div className="grid grid-cols-1 gap-1.5">
                  <button
                    type="button"
                    disabled={!rendered || rendered.canvases.length === 0 || savingAction === 'master_image'}
                    onClick={() => {
                      if (!ensureReadyForFinalOutput() || !rendered) return;
                      const compact = buildCompactPosterDataUrl(rendered.canvases[0], 720);
                      requestMasterImageAction(compact, 'poster', 'Poster applied as Combo Master Image.');
                    }}
                    className="w-full py-2 px-3 rounded-lg bg-[#101B3F] hover:bg-[#19295c] text-white text-[11px] font-bold text-left flex items-center justify-between cursor-pointer disabled:opacity-50"
                  >
                    <span>1. Set Poster as Combo Master Image</span>
                    <Check className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    disabled={!compositionPreviewUrl || savingAction === 'master_image'}
                    onClick={() => {
                      if (!ensureReadyForFinalOutput() || !compositionPreviewUrl) return;
                      requestMasterImageAction(
                        compositionPreviewUrl,
                        'product_composition',
                        'Product-Only Composition applied as Combo Master Image.'
                      );
                    }}
                    className="w-full py-2 px-3 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-[11px] font-bold text-left flex items-center justify-between cursor-pointer disabled:opacity-50"
                  >
                    <span>2. Use Product-Only Composition as Master</span>
                    <ImageIcon className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setFeedback({ tone: 'success', text: 'Kept current Combo Master Image unchanged.' })
                    }
                    className="w-full py-2 px-3 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 text-[11px] font-bold text-left cursor-pointer"
                  >
                    3. Keep Current Master Image
                  </button>
                  <label className="w-full py-2 px-3 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-[11px] font-bold flex items-center justify-between cursor-pointer">
                    <span>4. Upload Custom Master Image</span>
                    <Upload className="w-3.5 h-3.5" />
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      className="hidden"
                      onChange={e => {
                        handleCustomMasterUpload(e.target.files?.[0] || null);
                        e.target.value = '';
                      }}
                    />
                  </label>
                  {offer.image && (
                    <button
                      type="button"
                      disabled={savingAction === 'master_image'}
                      onClick={() => commitMasterImageUpdate('', 'custom', 'Combo Master Image removed.')}
                      className="w-full py-2 px-3 rounded-lg border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700 text-[11px] font-bold text-left flex items-center justify-between cursor-pointer"
                    >
                      <span>5. Remove Master Image</span>
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* RIGHT MODE 1 LIVE PREVIEW VIEWPORT */}
            <div className="lg:col-span-7 xl:col-span-8 bg-slate-100 flex flex-col overflow-hidden">
              <div className="px-4 py-2.5 bg-white border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 shrink-0">
                <div className="inline-flex p-0.5 rounded-lg bg-slate-100 border border-slate-200">
                  <button
                    type="button"
                    onClick={() => setPreviewTab('poster')}
                    className={`px-3 py-1 rounded-md text-xs font-bold cursor-pointer ${
                      previewTab === 'poster'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Style Zone AI Poster Preview
                  </button>
                  <button
                    type="button"
                    onClick={() => setPreviewTab('product_composition')}
                    className={`px-3 py-1 rounded-md text-xs font-bold cursor-pointer ${
                      previewTab === 'product_composition'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Product-Only Master Composition
                  </button>
                </div>

                {previewTab === 'poster' && rendered && rendered.canvases.length > 1 && (
                  <div className="flex items-center gap-1.5 text-xs">
                    <span className="text-slate-500 font-semibold">
                      Page {activePageIdx + 1}/{rendered.canvases.length}
                    </span>
                    {rendered.canvases.map((_, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => setActivePageIdx(idx)}
                        className={`w-6 h-6 rounded font-bold text-xs cursor-pointer ${
                          activePageIdx === idx
                            ? 'bg-[#101B3F] text-white'
                            : 'bg-slate-200 text-slate-700'
                        }`}
                      >
                        {idx + 1}
                      </button>
                    ))}
                  </div>
                )}

                <div className="text-[11px] text-slate-500 font-mono-num flex items-center gap-2">
                  {rendering && (
                    <span className="inline-flex items-center gap-1 text-teal-700 font-semibold">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" /> Rendering...
                    </span>
                  )}
                  <span>
                    {dims.widthPx} × {dims.heightPx}px
                  </span>
                </div>
              </div>

              <div className="flex-1 overflow-auto p-4 sm:p-6 flex items-center justify-center">
                {previewTab === 'poster' ? (
                  <div className="relative shadow-2xl rounded-xl overflow-hidden border border-slate-300 bg-white max-w-full max-h-full flex items-center justify-center">
                    <canvas
                      ref={previewImgCanvasRef}
                      className="max-w-full max-h-[76vh] w-auto h-auto block object-contain"
                    />
                  </div>
                ) : (
                  <div className="max-w-lg w-full bg-white p-5 rounded-2xl border border-slate-200 shadow-lg text-center space-y-3">
                    <div className="text-xs font-bold text-slate-800">
                      Clean Product-Only Composition (Master Image Preview)
                    </div>
                    <p className="text-[11px] text-slate-500">
                      Shows all combo products on a clean studio backdrop with zero promo badges or price clutter.
                    </p>
                    {compositionPreviewUrl && (
                      <img
                        src={compositionPreviewUrl}
                        alt="Product Only Composition"
                        className="w-full max-h-[55vh] object-contain rounded-xl border border-slate-200 mx-auto"
                      />
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* MASTER IMAGE OVERWRITE CONFIRMATION DIALOG */}
        {masterConfirmPending && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/60 p-4">
            <div className="bg-white rounded-2xl border border-amber-200 shadow-2xl max-w-md w-full p-5 space-y-4">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center shrink-0">
                  <AlertTriangle className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-slate-900">
                    Replace Existing Combo Master Image?
                  </h4>
                  <p className="text-xs text-slate-600 mt-1">
                    This combo offer already has a Master Image. Confirm if you want to replace it—you can also keep the existing Master Image instead.
                  </p>
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setMasterConfirmPending(null)}
                  className="px-3.5 py-2 rounded-lg text-xs font-semibold text-slate-700 hover:bg-slate-100 cursor-pointer"
                >
                  Keep Current Image
                </button>
                <button
                  type="button"
                  disabled={savingAction === 'master_image'}
                  onClick={() =>
                    commitMasterImageUpdate(
                      masterConfirmPending.nextImage,
                      masterConfirmPending.nextType,
                      masterConfirmPending.actionLabel
                    )
                  }
                  className="px-4 py-2 rounded-lg text-xs font-bold bg-[#101B3F] text-white hover:bg-[#19295c] cursor-pointer"
                >
                  {savingAction === 'master_image' ? 'Updating...' : 'Replace Master Image'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
