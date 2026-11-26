import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignStartVertical,
  ArrowDown,
  ArrowUp,
  Copy,
  CopyPlus,
  Crop,
  Eraser,
  Eye,
  EyeOff,
  Grid,
  Group,
  Image as ImageIcon,
  Layers,
  Lock,
  MoveDown,
  MoveUp,
  Palette,
  Plus,
  QrCode,
  Redo2,
  RotateCw,
  Shapes,
  Sliders,
  Sparkles,
  Trash2,
  Type,
  Undo2,
  Ungroup,
  Unlock,
  Upload,
  UserCheck,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  Branch,
  ComboOffer,
  PosterBadgeLayer,
  PosterCanvasLayer,
  PosterCustomProject,
  PosterDimensionPreset,
  PosterFontFamily,
  PosterImageLayer,
  PosterQrLayer,
  PosterShapeLayer,
  PosterStickerLayer,
  PosterTextLayer,
  Product,
  ShopSettings,
} from '../../types';
import {
  POSTER_DIMENSION_PRESETS,
  computePosterPricingSummary,
  resolveComboMarketplaceQrUrl,
  resolvePosterProductItems,
} from '../../utils/comboPosterEngine';
import {
  LayerAlignmentKind,
  alignSelectedLayers,
  distributeSelectedLayers,
  duplicateSelectedLayers,
  groupSelectedLayers,
  makeLayerId,
  normalizeLayerZIndexes,
  reorderLayerZIndex,
  ungroupLayers,
} from '../../utils/customPosterProjectEngine';
import { POSTER_MODEL_PRESETS } from '../../utils/posterModelAssets';
import { removeLightBackgroundToDataUrl } from '../../utils/posterCanvasEffects';
import { validateImageFile } from '../../services/catalogImageService';
import { formatCurrency } from '../../utils/formatters';
import { resolveBusinessProfile } from '../../config/appIdentity';

const FONT_OPTIONS: Array<{ value: PosterFontFamily; label: string }> = [
  { value: 'Plus Jakarta Sans', label: 'Plus Jakarta Sans (Modern)' },
  { value: 'Oswald', label: 'Oswald (Bold Poster Display)' },
  { value: 'Playfair Display', label: 'Playfair Display (Luxury Serif)' },
  { value: 'Hind Siliguri', label: 'Hind Siliguri (Bangla + En)' },
  { value: 'Noto Sans Bengali', label: 'Noto Sans Bengali (বাংলা)' },
  { value: 'JetBrains Mono', label: 'JetBrains Mono (Price Mono)' },
];

const fileToOptimizedDataUrl = (file: File, maxEdge = 1280): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const rawUrl = String(reader.result);
      // Preserve PNG alpha transparency cleanly when PNG or WEBP
      const img = new Image();
      img.onload = () => {
        let w = img.naturalWidth || 800;
        let h = img.naturalHeight || 800;
        if (w > maxEdge || h > maxEdge) {
          const r = Math.min(maxEdge / w, maxEdge / h);
          w = Math.max(1, Math.round(w * r));
          h = Math.max(1, Math.round(h * r));
        }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(rawUrl);
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        const keepPng = file.type === 'image/png' || file.type === 'image/webp';
        resolve(keepPng ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', 0.9));
      };
      img.onerror = () => reject(new Error('Could not decode uploaded image.'));
      img.src = rawUrl;
    };
    reader.onerror = () => reject(new Error('Failed to read uploaded image file.'));
    reader.readAsDataURL(file);
  });

export interface CustomPosterEditorProps {
  project: PosterCustomProject;
  offer: ComboOffer;
  products: Product[];
  settings: ShopSettings;
  activeBranch?: Branch | null;
  dimensionPreset: PosterDimensionPreset;
  posterProductImages?: Record<string, string>;
  onChangeProject: (next: PosterCustomProject) => void;
  onChangeDimensionPreset: (preset: PosterDimensionPreset, w: number, h: number) => void;
  onResetFromAiDesign: () => void;
  onSaveAsTemplate: (name: string, category: string) => void;
  onNotify: (tone: 'success' | 'warning' | 'error', text: string) => void;
}

type LeftDrawerTab = 'combo' | 'models' | 'text' | 'elements';
type RightInspectorTab = 'properties' | 'layers';

type DragState =
  | {
      kind: 'move';
      startX: number;
      startY: number;
      initialPositions: Record<string, { x: number; y: number }>;
    }
  | {
      kind: 'resize';
      handle: 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
      layerId: string;
      startX: number;
      startY: number;
      origX: number;
      origY: number;
      origW: number;
      origH: number;
    }
  | {
      kind: 'rotate';
      layerId: string;
      cx: number;
      cy: number;
    };

export const CustomPosterEditor: React.FC<CustomPosterEditorProps> = ({
  project,
  offer,
  products,
  settings,
  activeBranch,
  dimensionPreset,
  posterProductImages,
  onChangeProject,
  onChangeDimensionPreset,
  onResetFromAiDesign,
  onSaveAsTemplate,
  onNotify,
}) => {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [leftTab, setLeftTab] = useState<LeftDrawerTab>('combo');
  const [rightTab, setRightTab] = useState<RightInspectorTab>('properties');
  const [zoom, setZoom] = useState<number>(0.42);
  const [showGrid, setShowGrid] = useState<boolean>(true);
  const [snapGuides, setSnapGuides] = useState<{ x: number | null; y: number | null }>({
    x: null,
    y: null,
  });
  const [inlineEditLayerId, setInlineEditLayerId] = useState<string | null>(null);
  const [clipboard, setClipboard] = useState<PosterCanvasLayer[]>([]);
  const [historyPast, setHistoryPast] = useState<PosterCustomProject[]>([]);
  const [historyFuture, setHistoryFuture] = useState<PosterCustomProject[]>([]);
  const [processedImgUrls, setProcessedImgUrls] = useState<Record<string, string>>({});
  const [qrDataUrls, setQrDataUrls] = useState<Record<string, string>>({});
  const [showSaveTplModal, setShowSaveTplModal] = useState(false);
  const [tplName, setTplName] = useState(`${offer.name} Layout`);
  const [tplCategory, setTplCategory] = useState(offer.comboCategory || 'Custom');

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const latestProjectRef = useRef<PosterCustomProject>(project);
  latestProjectRef.current = project;

  const resolvedItems = useMemo(
    () => resolvePosterProductItems(offer, products, posterProductImages),
    [offer, products, posterProductImages]
  );
  const pricing = useMemo(
    () => computePosterPricingSummary(offer, resolvedItems),
    [offer, resolvedItems]
  );
  const biz = useMemo(
    () => resolveBusinessProfile(settings, activeBranch),
    [settings, activeBranch]
  );
  const qrResolved = useMemo(
    () => resolveComboMarketplaceQrUrl(offer, settings),
    [offer, settings]
  );
  const currency = settings.currency || '৳';
  const formatMoney = useCallback(
    (v: number) => formatCurrency(Math.round(v * 100) / 100, 'en').replace('৳', currency),
    [currency]
  );

  // Auto-fit zoom once on viewport resize or canvas preset change
  const fitCanvasToViewport = useCallback(() => {
    const el = viewportRef.current;
    if (!el) return;
    const availW = Math.max(260, el.clientWidth - 48);
    const availH = Math.max(260, el.clientHeight - 48);
    const scale = Math.min(availW / project.canvasWidth, availH / project.canvasHeight, 1);
    setZoom(Math.max(0.18, Math.round(scale * 100) / 100));
  }, [project.canvasWidth, project.canvasHeight]);

  useEffect(() => {
    fitCanvasToViewport();
  }, [fitCanvasToViewport]);

  // Process white background removal asynchronously for preview parity
  useEffect(() => {
    let cancelled = false;
    const imgLayers = project.layers.filter(
      (l): l is PosterImageLayer => l.type === 'image' && Boolean(l.removeLightBg)
    );
    imgLayers.forEach(async layer => {
      const tol = layer.bgRemovalTolerance ?? 36;
      const cacheKey = `${layer.id}::${layer.src.slice(0, 64)}::${layer.src.length}::${tol}`;
      if (processedImgUrls[cacheKey]) return;
      const cleaned = await removeLightBackgroundToDataUrl(layer.src, tol);
      if (!cancelled && cleaned) {
        setProcessedImgUrls(prev => ({ ...prev, [cacheKey]: cleaned }));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [project.layers, processedImgUrls]);

  // Render QR code data URLs for live interactive QR layers
  useEffect(() => {
    let cancelled = false;
    const qrLayers = project.layers.filter((l): l is PosterQrLayer => l.type === 'qr');
    qrLayers.forEach(async layer => {
      const key = `${layer.qrValue}::${layer.foregroundColor || '#0F172A'}::${layer.backgroundColor || '#FFFFFF'}`;
      if (qrDataUrls[key] || !layer.qrValue) return;
      try {
        const QRCode = (await import('qrcode')).default;
        const url = await QRCode.toDataURL(layer.qrValue, {
          width: 240,
          margin: 1,
          color: {
            dark: layer.foregroundColor || '#0F172A',
            light: layer.backgroundColor || '#FFFFFF',
          },
        });
        if (!cancelled) {
          setQrDataUrls(prev => ({ ...prev, [key]: url }));
        }
      } catch {
        // ignore invalid qr
      }
    });
    return () => {
      cancelled = true;
    };
  }, [project.layers, qrDataUrls]);

  const commitProject = useCallback(
    (next: PosterCustomProject, pushHistory = true) => {
      if (pushHistory) {
        setHistoryPast(prev => [...prev.slice(-39), latestProjectRef.current]);
        setHistoryFuture([]);
      }
      onChangeProject({
        ...next,
        layers: normalizeLayerZIndexes(next.layers),
        updatedAt: new Date().toISOString(),
      });
    },
    [onChangeProject]
  );

  const handleUndo = useCallback(() => {
    setHistoryPast(prev => {
      if (prev.length === 0) return prev;
      const target = prev[prev.length - 1];
      setHistoryFuture(f => [latestProjectRef.current, ...f.slice(0, 39)]);
      onChangeProject(target);
      setSelectedIds([]);
      return prev.slice(0, -1);
    });
  }, [onChangeProject]);

  const handleRedo = useCallback(() => {
    setHistoryFuture(prev => {
      if (prev.length === 0) return prev;
      const target = prev[0];
      setHistoryPast(p => [...p.slice(-39), latestProjectRef.current]);
      onChangeProject(target);
      setSelectedIds([]);
      return prev.slice(1);
    });
  }, [onChangeProject]);

  const primarySelectedLayer = useMemo(() => {
    if (selectedIds.length === 0) return null;
    return project.layers.find(l => l.id === selectedIds[0]) || null;
  }, [project.layers, selectedIds]);

  const updateSelectedLayer = useCallback(
    (patch: Partial<PosterCanvasLayer>, pushHistory = false) => {
      if (selectedIds.length === 0) return;
      const targetId = selectedIds[0];
      const nextLayers = project.layers.map(l =>
        l.id === targetId ? ({ ...l, ...patch } as PosterCanvasLayer) : l
      );
      commitProject({ ...project, layers: nextLayers }, pushHistory);
    },
    [project, selectedIds, commitProject]
  );

  const addLayer = useCallback(
    (layer: PosterCanvasLayer) => {
      const nextZ = project.layers.reduce((m, l) => Math.max(m, l.zIndex), 0) + 1;
      const ready = { ...layer, zIndex: nextZ };
      commitProject({ ...project, layers: [...project.layers, ready] }, true);
      setSelectedIds([ready.id]);
      setRightTab('properties');
    },
    [project, commitProject]
  );

  const deleteSelected = useCallback(() => {
    if (selectedIds.length === 0) return;
    const remaining = project.layers.filter(l => !selectedIds.includes(l.id));
    commitProject({ ...project, layers: remaining }, true);
    setSelectedIds([]);
  }, [project, selectedIds, commitProject]);

  const handleDuplicateSelected = useCallback(() => {
    if (selectedIds.length === 0) return;
    const res = duplicateSelectedLayers(project.layers, selectedIds);
    commitProject({ ...project, layers: res.layers }, true);
    setSelectedIds(res.newIds);
  }, [project, selectedIds, commitProject]);

  const handleCopy = useCallback(() => {
    const chosen = project.layers.filter(l => selectedIds.includes(l.id));
    if (chosen.length === 0) return;
    setClipboard(chosen);
    onNotify('success', `Copied ${chosen.length} layer(s). Press Paste or Ctrl+V.`);
  }, [project.layers, selectedIds, onNotify]);

  const handlePaste = useCallback(() => {
    if (clipboard.length === 0) return;
    let nextZ = project.layers.reduce((m, l) => Math.max(m, l.zIndex), 0);
    const pastedIds: string[] = [];
    const pasted = clipboard.map(item => {
      const id = makeLayerId(item.type);
      pastedIds.push(id);
      return {
        ...item,
        id,
        name: `${item.name} (Copy)`,
        x: Math.min(project.canvasWidth - 40, item.x + 28),
        y: Math.min(project.canvasHeight - 40, item.y + 28),
        locked: false,
        zIndex: ++nextZ,
      };
    });
    commitProject({ ...project, layers: [...project.layers, ...pasted] }, true);
    setSelectedIds(pastedIds);
  }, [clipboard, project, commitProject]);

  // Keyboard shortcuts (Ctrl+Z, Ctrl+Y, Ctrl+C, Ctrl+V, Ctrl+D, Delete, Arrows)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || inlineEditLayerId) {
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) handleRedo();
        else handleUndo();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        handleRedo();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'c') {
        e.preventDefault();
        handleCopy();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'v') {
        e.preventDefault();
        handlePaste();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        handleDuplicateSelected();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedIds.length > 0) {
          e.preventDefault();
          deleteSelected();
        }
      } else if (
        ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key) &&
        selectedIds.length > 0
      ) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 2;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        commitProject(
          {
            ...project,
            layers: project.layers.map(l =>
              selectedIds.includes(l.id) && !l.locked
                ? { ...l, x: l.x + dx, y: l.y + dy }
                : l
            ),
          },
          false
        );
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    inlineEditLayerId,
    selectedIds,
    project,
    handleUndo,
    handleRedo,
    handleCopy,
    handlePaste,
    handleDuplicateSelected,
    deleteSelected,
    commitProject,
  ]);

  // Global pointer drag/resize/rotate handler
  useEffect(() => {
    const onPointerMove = (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const cur = latestProjectRef.current;

      if (drag.kind === 'move') {
        const dx = (e.clientX - drag.startX) / zoom;
        const dy = (e.clientY - drag.startY) / zoom;
        const movedIds = Object.keys(drag.initialPositions);

        // Calculate snapping for primary dragged layer against canvas center/edges
        let snapDx = dx;
        let snapDy = dy;
        let guideX: number | null = null;
        let guideY: number | null = null;

        if (movedIds.length > 0) {
          const primaryId = movedIds[0];
          const primaryLayer = cur.layers.find(l => l.id === primaryId);
          const init = drag.initialPositions[primaryId];
          if (primaryLayer && init) {
            const rawX = init.x + dx;
            const rawY = init.y + dy;
            const canvasCx = cur.canvasWidth / 2;
            const canvasCy = cur.canvasHeight / 2;
            const layerCx = rawX + primaryLayer.width / 2;
            const layerCy = rawY + primaryLayer.height / 2;

            if (Math.abs(layerCx - canvasCx) < 8) {
              snapDx = canvasCx - primaryLayer.width / 2 - init.x;
              guideX = canvasCx;
            } else if (Math.abs(rawX - 48) < 8) {
              snapDx = 48 - init.x;
              guideX = 48;
            }
            if (Math.abs(layerCy - canvasCy) < 8) {
              snapDy = canvasCy - primaryLayer.height / 2 - init.y;
              guideY = canvasCy;
            }
          }
        }
        setSnapGuides({ x: guideX, y: guideY });

        onChangeProject({
          ...cur,
          layers: cur.layers.map(l => {
            const init = drag.initialPositions[l.id];
            if (!init) return l;
            return {
              ...l,
              x: Math.round(init.x + snapDx),
              y: Math.round(init.y + snapDy),
            };
          }),
        });
      } else if (drag.kind === 'resize') {
        const dx = (e.clientX - drag.startX) / zoom;
        const dy = (e.clientY - drag.startY) / zoom;
        let nx = drag.origX;
        let ny = drag.origY;
        let nw = drag.origW;
        let nh = drag.origH;

        if (drag.handle.includes('e')) nw = Math.max(24, drag.origW + dx);
        if (drag.handle.includes('s')) nh = Math.max(18, drag.origH + dy);
        if (drag.handle.includes('w')) {
          const possibleW = Math.max(24, drag.origW - dx);
          nx = drag.origX + (drag.origW - possibleW);
          nw = possibleW;
        }
        if (drag.handle.includes('n')) {
          const possibleH = Math.max(18, drag.origH - dy);
          ny = drag.origY + (drag.origH - possibleH);
          nh = possibleH;
        }

        onChangeProject({
          ...cur,
          layers: cur.layers.map(l =>
            l.id === drag.layerId
              ? {
                  ...l,
                  x: Math.round(nx),
                  y: Math.round(ny),
                  width: Math.round(nw),
                  height: Math.round(nh),
                }
              : l
          ),
        });
      } else if (drag.kind === 'rotate') {
        const angleRad = Math.atan2(e.clientY - drag.cy, e.clientX - drag.cx);
        const angleDeg = Math.round((angleRad * 180) / Math.PI + 90);
        const snappedDeg = Math.abs(angleDeg) < 4 ? 0 : angleDeg;
        onChangeProject({
          ...cur,
          layers: cur.layers.map(l =>
            l.id === drag.layerId ? { ...l, rotation: snappedDeg } : l
          ),
        });
      }
    };

    const onPointerUp = () => {
      if (dragRef.current) {
        dragRef.current = null;
        setSnapGuides({ x: null, y: null });
      }
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };
  }, [zoom, onChangeProject]);

  const startMoveDrag = (e: React.PointerEvent, layer: PosterCanvasLayer) => {
    e.stopPropagation();
    if (inlineEditLayerId === layer.id) return;

    // Expand group members cleanly unless Shift single-toggling
    let nextSelected: string[];
    if (e.shiftKey) {
      nextSelected = selectedIds.includes(layer.id)
        ? selectedIds.filter(id => id !== layer.id)
        : [...selectedIds, layer.id];
    } else if (selectedIds.includes(layer.id)) {
      nextSelected = selectedIds;
    } else if (layer.groupId) {
      nextSelected = project.layers.filter(l => l.groupId === layer.groupId).map(l => l.id);
    } else {
      nextSelected = [layer.id];
    }
    setSelectedIds(nextSelected);

    if (layer.locked) return;

    const initialPositions: Record<string, { x: number; y: number }> = {};
    project.layers.forEach(l => {
      if (nextSelected.includes(l.id) && !l.locked) {
        initialPositions[l.id] = { x: l.x, y: l.y };
      }
    });
    if (Object.keys(initialPositions).length === 0) return;

    setHistoryPast(prev => [...prev.slice(-39), latestProjectRef.current]);
    setHistoryFuture([]);
    dragRef.current = {
      kind: 'move',
      startX: e.clientX,
      startY: e.clientY,
      initialPositions,
    };
  };

  const startResizeDrag = (
    e: React.PointerEvent,
    layer: PosterCanvasLayer,
    handle: 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'
  ) => {
    e.stopPropagation();
    if (layer.locked) return;
    setHistoryPast(prev => [...prev.slice(-39), latestProjectRef.current]);
    setHistoryFuture([]);
    dragRef.current = {
      kind: 'resize',
      handle,
      layerId: layer.id,
      startX: e.clientX,
      startY: e.clientY,
      origX: layer.x,
      origY: layer.y,
      origW: layer.width,
      origH: layer.height,
    };
  };

  const startRotateDrag = (e: React.PointerEvent, layer: PosterCanvasLayer) => {
    e.stopPropagation();
    if (layer.locked) return;
    const el = document.getElementById(`canvas-layer-${layer.id}`);
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setHistoryPast(prev => [...prev.slice(-39), latestProjectRef.current]);
    setHistoryFuture([]);
    dragRef.current = {
      kind: 'rotate',
      layerId: layer.id,
      cx: rect.left + rect.width / 2,
      cy: rect.top + rect.height / 2,
    };
  };

  // Upload handlers (PC & Android support)
  const handleUploadImageLayer = async (
    file: File | null,
    role: 'model' | 'product' | 'uploaded' | 'background'
  ) => {
    if (!file) return;
    const validation = validateImageFile(file);
    if (!validation.valid) {
      onNotify('error', validation.error || 'Unsupported image format.');
      return;
    }
    try {
      const dataUrl = await fileToOptimizedDataUrl(file, 1400);
      if (role === 'background') {
        commitProject({ ...project, backgroundImageUrl: dataUrl }, true);
        onNotify('success', 'Custom background image added to canvas.');
        return;
      }
      const w = role === 'model' ? Math.round(project.canvasWidth * 0.52) : Math.round(project.canvasWidth * 0.34);
      const h = role === 'model' ? Math.round(project.canvasHeight * 0.44) : Math.round(project.canvasWidth * 0.34);
      const newLayer: PosterImageLayer = {
        id: makeLayerId(role),
        name: file.name.replace(/\.[^.]+$/, '').slice(0, 28) || 'Uploaded Image',
        type: 'image',
        src: dataUrl,
        fit: 'contain',
        removeLightBg: role === 'model',
        bgRemovalTolerance: 36,
        brightness: 100,
        contrast: 100,
        x: Math.round((project.canvasWidth - w) / 2),
        y: Math.round((project.canvasHeight - h) / 2),
        width: w,
        height: h,
        rotation: 0,
        opacity: 1,
        visible: true,
        locked: false,
        zIndex: 99,
        tagRole: role,
      };
      addLayer(newLayer);
      onNotify('success', 'Image inserted onto canvas.');
    } catch (err: any) {
      onNotify('error', err?.message || 'Failed to upload image.');
    }
  };

  const insertPresetModel = (preset: (typeof POSTER_MODEL_PRESETS)[number]) => {
    const w = Math.round(project.canvasWidth * 0.56);
    const h = Math.round(project.canvasHeight * 0.42);
    const newLayer: PosterImageLayer = {
      id: makeLayerId('model'),
      name: preset.label,
      type: 'image',
      src: preset.imageUrl,
      fit: 'contain',
      removeLightBg: true,
      bgRemovalTolerance: 36,
      brightness: 100,
      contrast: 100,
      x: Math.round((project.canvasWidth - w) / 2),
      y: Math.round(project.canvasHeight * 0.22),
      width: w,
      height: h,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      zIndex: 99,
      tagRole: 'model',
    };
    addLayer(newLayer);
  };

  const insertTextPreset = (preset: 'headline' | 'bangla' | 'price' | 'body') => {
    const textLayer: PosterTextLayer = {
      id: makeLayerId('text'),
      name:
        preset === 'headline'
          ? 'Offer Headline'
          : preset === 'bangla'
          ? 'Bangla Offer Copy'
          : preset === 'price'
          ? 'Highlight Price'
          : 'Promo Description',
      type: 'text',
      text:
        preset === 'headline'
          ? 'MEGA COMBO OFFER'
          : preset === 'bangla'
          ? 'স্পেশাল কম্বো অফার — সীমিত সময়ের জন্য!'
          : preset === 'price'
          ? formatMoney(pricing.finalComboPrice)
          : 'Premium Quality · Best Discount · Limited Stock',
      fontFamily:
        preset === 'bangla'
          ? 'Hind Siliguri'
          : preset === 'price' || preset === 'headline'
          ? 'Oswald'
          : 'Plus Jakarta Sans',
      fontSize: preset === 'headline' || preset === 'price' ? 54 : 28,
      fontWeight: preset === 'body' ? '600' : '800',
      fontStyle: 'normal',
      textAlign: 'center',
      color: preset === 'price' ? '#FFD21F' : '#FFFFFF',
      x: Math.round(project.canvasWidth * 0.14),
      y: Math.round(project.canvasHeight * 0.42),
      width: Math.round(project.canvasWidth * 0.72),
      height: preset === 'headline' || preset === 'price' ? 78 : 54,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      zIndex: 99,
    };
    addLayer(textLayer);
  };

  const insertShape = (kind: PosterShapeLayer['shapeKind']) => {
    const isLine = kind === 'line' || kind === 'divider';
    const w = isLine ? Math.round(project.canvasWidth * 0.65) : 240;
    const h = isLine ? 6 : 160;
    const shape: PosterShapeLayer = {
      id: makeLayerId('shape'),
      name: kind === 'circle' ? 'Circle Shape' : isLine ? 'Divider Line' : 'Rectangle Box',
      type: 'shape',
      shapeKind: kind,
      fillColor: '#DC2626',
      x: Math.round((project.canvasWidth - w) / 2),
      y: Math.round((project.canvasHeight - h) / 2),
      width: w,
      height: h,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      zIndex: 99,
      borderRadius: kind === 'rounded_rect' ? 18 : 0,
      borderColor: '#FFD21F',
      borderWidth: isLine ? 0 : 2,
    };
    addLayer(shape);
  };

  const insertBadge = (style: PosterBadgeLayer['badgeStyle']) => {
    const size = style === 'starburst' ? 190 : 220;
    const h = style === 'starburst' ? 190 : 58;
    const badge: PosterBadgeLayer = {
      id: makeLayerId('badge'),
      name: style === 'starburst' ? 'Savings Starburst' : 'Promo Pill Badge',
      type: 'badge',
      badgeStyle: style,
      primaryText:
        style === 'starburst'
          ? `${Math.round(pricing.discountPercent)}% OFF`
          : 'SAVE ' + formatMoney(pricing.savingsAmount),
      secondaryText: style === 'starburst' ? `SAVE ${formatMoney(pricing.savingsAmount)}` : undefined,
      fillColor: '#FFD21F',
      textColor: '#0D0E14',
      fontFamily: style === 'starburst' ? 'Oswald' : 'Plus Jakarta Sans',
      x: Math.round((project.canvasWidth - size) / 2),
      y: Math.round(project.canvasHeight * 0.35),
      width: size,
      height: h,
      rotation: style === 'starburst' ? -8 : 0,
      opacity: 1,
      visible: true,
      locked: false,
      zIndex: 99,
      borderRadius: 999,
      borderWidth: 2,
      borderColor: '#D91E2A',
    };
    addLayer(badge);
  };

  const insertSticker = (kind: PosterStickerLayer['stickerKind']) => {
    const size = kind === 'plus_sign' ? 56 : 110;
    const sticker: PosterStickerLayer = {
      id: makeLayerId('sticker'),
      name:
        kind === 'plus_sign'
          ? 'Plus (+) Sign'
          : kind === 'quality_seal'
          ? 'Premium Quality Seal'
          : kind === 'star_icon'
          ? 'Star Sticker'
          : 'Arrow Element',
      type: 'sticker',
      stickerKind: kind,
      fillColor: kind === 'quality_seal' ? '#D91E2A' : '#FFD21F',
      accentColor: kind === 'quality_seal' ? '#FFD21F' : '#0D0E14',
      textColor: kind === 'quality_seal' ? '#FFFFFF' : '#0D0E14',
      label: '100% PREMIUM',
      x: Math.round((project.canvasWidth - size) / 2),
      y: Math.round((project.canvasHeight - size) / 2),
      width: size,
      height: kind === 'arrow_right' || kind === 'arrow_down' ? 76 : size,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      zIndex: 99,
    };
    addLayer(sticker);
  };

  const insertComboProductCardGroup = (itemIdx: number) => {
    const item = resolvedItems[itemIdx];
    if (!item) return;
    const gid = makeLayerId('prodcard');
    const cardW = 240;
    const cardH = 260;
    const cx = Math.round((project.canvasWidth - cardW) / 2);
    const cy = Math.round((project.canvasHeight - cardH) / 2);
    let nextZ = project.layers.reduce((m, l) => Math.max(m, l.zIndex), 0) + 1;

    const cardLayers: PosterCanvasLayer[] = [
      {
        id: makeLayerId('cbg'),
        name: `Card — ${item.productName}`,
        type: 'shape',
        shapeKind: 'rounded_rect',
        fillColor: '#FFFFFF',
        borderColor: '#FFD21F',
        borderWidth: 2,
        borderRadius: 14,
        x: cx,
        y: cy,
        width: cardW,
        height: cardH,
        rotation: 0,
        opacity: 1,
        visible: true,
        locked: false,
        groupId: gid,
        zIndex: nextZ++,
      },
      ...(item.imageUrl
        ? [
            {
              id: makeLayerId('cimg'),
              name: `Photo — ${item.productName}`,
              type: 'image' as const,
              src: item.imageUrl,
              fit: 'contain' as const,
              x: cx + 14,
              y: cy + 12,
              width: cardW - 28,
              height: 150,
              rotation: 0,
              opacity: 1,
              visible: true,
              locked: false,
              groupId: gid,
              zIndex: nextZ++,
              borderRadius: 10,
              tagRole: 'product' as const,
              linkedProductId: item.productId,
            },
          ]
        : []),
      {
        id: makeLayerId('cname'),
        name: `Title — ${item.productName}`,
        type: 'text',
        text: `${item.quantity}× ${item.productName}`,
        fontFamily: 'Plus Jakarta Sans',
        fontSize: 18,
        fontWeight: '800',
        fontStyle: 'normal',
        textAlign: 'center',
        color: '#0F172A',
        x: cx + 12,
        y: cy + 170,
        width: cardW - 24,
        height: 44,
        rotation: 0,
        opacity: 1,
        visible: true,
        locked: false,
        groupId: gid,
        zIndex: nextZ++,
      },
      {
        id: makeLayerId('cprice'),
        name: `Price — ${item.productName}`,
        type: 'text',
        text: item.isFree ? 'FREE GIFT' : formatMoney(item.lineRegularTotal),
        fontFamily: 'JetBrains Mono',
        fontSize: 16,
        fontWeight: '700',
        fontStyle: 'normal',
        textAlign: 'center',
        color: item.isFree ? '#059669' : '#B91C1C',
        x: cx + 12,
        y: cy + 218,
        width: cardW - 24,
        height: 28,
        rotation: 0,
        opacity: 1,
        visible: true,
        locked: false,
        groupId: gid,
        zIndex: nextZ++,
      },
    ];

    commitProject({ ...project, layers: [...project.layers, ...cardLayers] }, true);
    setSelectedIds(cardLayers.map(l => l.id));
    onNotify('success', `Inserted grouped product card for "${item.productName}".`);
  };

  const insertQrCodeLayer = () => {
    const val = qrResolved.url || window.location.origin;
    const qr: PosterQrLayer = {
      id: makeLayerId('qr'),
      name: 'Scannable QR Code',
      type: 'qr',
      qrValue: val,
      foregroundColor: '#0F172A',
      backgroundColor: '#FFFFFF',
      x: project.canvasWidth - 190,
      y: project.canvasHeight - 190,
      width: 140,
      height: 140,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      zIndex: 99,
      borderRadius: 10,
    };
    addLayer(qr);
  };

  const sortedLayersTopFirst = useMemo(
    () => [...project.layers].sort((a, b) => b.zIndex - a.zIndex),
    [project.layers]
  );

  const sortedLayersBottomFirst = useMemo(
    () => [...project.layers].sort((a, b) => a.zIndex - b.zIndex),
    [project.layers]
  );

  const handleAlign = (kind: LayerAlignmentKind) => {
    if (selectedIds.length === 0) return;
    commitProject(
      {
        ...project,
        layers: alignSelectedLayers(
          project.layers,
          selectedIds,
          kind,
          project.canvasWidth,
          project.canvasHeight
        ),
      },
      true
    );
  };

  const handleDistribute = (axis: 'horizontal' | 'vertical') => {
    if (selectedIds.length < 3) {
      onNotify('warning', 'Select 3 or more objects (Shift+Click) to distribute evenly.');
      return;
    }
    commitProject(
      { ...project, layers: distributeSelectedLayers(project.layers, selectedIds, axis) },
      true
    );
  };

  const renderLiveStageLayer = (layer: PosterCanvasLayer) => {
    if (!layer.visible) return null;
    const isSelected = selectedIds.includes(layer.id);
    const isPrimary = selectedIds[0] === layer.id;
    const isEditingInline = inlineEditLayerId === layer.id && layer.type === 'text';

    const commonStyle: React.CSSProperties = {
      position: 'absolute',
      left: `${layer.x}px`,
      top: `${layer.y}px`,
      width: `${layer.width}px`,
      height: `${layer.height}px`,
      transform: layer.rotation ? `rotate(${layer.rotation}deg)` : undefined,
      opacity: layer.opacity ?? 1,
      cursor: layer.locked ? 'not-allowed' : 'move',
      userSelect: isEditingInline ? 'text' : 'none',
      boxSizing: 'border-box',
    };

    const shadowCss =
      layer.shadowBlur && layer.shadowBlur > 0
        ? `${layer.shadowOffsetX || 0}px ${layer.shadowOffsetY || 0}px ${layer.shadowBlur}px ${layer.shadowColor || 'rgba(0,0,0,0.45)'}`
        : undefined;

    let body: React.ReactNode = null;

    if (layer.type === 'shape') {
      const bg = layer.gradientEndColor
        ? `linear-gradient(135deg, ${layer.fillColor}, ${layer.gradientEndColor})`
        : layer.fillColor;
      if (layer.shapeKind === 'line' || layer.shapeKind === 'divider') {
        body = (
          <div
            className="w-full flex items-center h-full"
            style={{ filter: shadowCss ? `drop-shadow(${shadowCss})` : undefined }}
          >
            <div
              className="w-full rounded-full"
              style={{ height: Math.max(2, layer.height), backgroundColor: layer.fillColor }}
            />
          </div>
        );
      } else {
        body = (
          <div
            className="w-full h-full"
            style={{
              background: bg,
              borderRadius:
                layer.shapeKind === 'circle'
                  ? '9999px'
                  : `${layer.shapeKind === 'rounded_rect' ? layer.borderRadius ?? 16 : 0}px`,
              border:
                layer.borderWidth && layer.borderWidth > 0
                  ? `${layer.borderWidth}px solid ${layer.borderColor || '#FFFFFF'}`
                  : undefined,
              boxShadow: shadowCss,
            }}
          />
        );
      }
    } else if (layer.type === 'image') {
      const tol = layer.bgRemovalTolerance ?? 36;
      const cacheKey = `${layer.id}::${layer.src.slice(0, 64)}::${layer.src.length}::${tol}`;
      const effectiveSrc =
        layer.removeLightBg && processedImgUrls[cacheKey] ? processedImgUrls[cacheKey] : layer.src;
      const cx = layer.cropX ?? 0;
      const cy = layer.cropY ?? 0;
      const cw = layer.cropW ?? 1;
      const ch = layer.cropH ?? 1;
      const hasCrop = cx > 0.001 || cy > 0.001 || cw < 0.999 || ch < 0.999;

      body = (
        <div
          className="w-full h-full overflow-hidden relative"
          style={{
            backgroundColor: layer.backgroundColor || 'transparent',
            borderRadius: `${layer.borderRadius || 0}px`,
            border:
              layer.borderWidth && layer.borderWidth > 0
                ? `${layer.borderWidth}px solid ${layer.borderColor || '#FFD21F'}`
                : undefined,
            boxShadow: shadowCss,
          }}
        >
          <img
            src={effectiveSrc}
            alt={layer.name}
            draggable={false}
            className="w-full h-full pointer-events-none"
            style={{
              objectFit: layer.fit === 'cover' ? 'cover' : 'contain',
              filter: `brightness(${layer.brightness ?? 100}%) contrast(${layer.contrast ?? 100}%)`,
              transform: hasCrop
                ? `scale(${(1 / Math.max(0.1, cw)).toFixed(3)}, ${(1 / Math.max(0.1, ch)).toFixed(3)}) translate(${-cx * 100}%, ${-cy * 100}%)`
                : undefined,
              transformOrigin: 'top left',
            }}
          />
        </div>
      );
    } else if (layer.type === 'text') {
      const txt = layer.uppercase ? (layer.text || '').toUpperCase() : layer.text || '';
      body = (
        <div
          className="w-full h-full overflow-hidden"
          style={{
            backgroundColor: layer.backgroundColor || 'transparent',
            borderRadius: `${layer.borderRadius ?? 8}px`,
            border:
              layer.borderWidth && layer.borderWidth > 0
                ? `${layer.borderWidth}px solid ${layer.borderColor || '#FFFFFF'}`
                : undefined,
            padding: `${layer.backgroundPadding ?? (layer.backgroundColor ? 10 : 2)}px`,
            fontFamily: `'${layer.fontFamily || 'Plus Jakarta Sans'}', 'Hind Siliguri', 'Noto Sans Bengali', sans-serif`,
            fontSize: `${layer.fontSize}px`,
            fontWeight: layer.fontWeight,
            fontStyle: layer.fontStyle,
            textAlign: layer.textAlign,
            color: layer.color,
            lineHeight: layer.lineHeight || 1.18,
            textDecoration: layer.strikethrough ? 'line-through' : undefined,
            textDecorationColor: layer.strikethrough ? '#EF4444' : undefined,
            WebkitTextStroke:
              layer.strokeWidth && layer.strokeWidth > 0
                ? `${Math.max(1, Math.round(layer.strokeWidth * 0.45))}px ${layer.strokeColor || '#000000'}`
                : undefined,
            textShadow: shadowCss,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {isEditingInline ? (
            <textarea
              autoFocus
              value={layer.text}
              onClick={e => e.stopPropagation()}
              onChange={e => updateSelectedLayer({ text: e.target.value }, false)}
              onBlur={() => setInlineEditLayerId(null)}
              className="w-full h-full bg-slate-950/70 text-white border border-amber-400 rounded outline-none resize-none p-1"
              style={{
                fontFamily: 'inherit',
                fontSize: 'inherit',
                fontWeight: 'inherit',
                textAlign: layer.textAlign,
              }}
            />
          ) : (
            txt
          )}
        </div>
      );
    } else if (layer.type === 'badge') {
      if (layer.badgeStyle === 'starburst') {
        body = (
          <div
            className="w-full h-full flex flex-col items-center justify-center text-center p-2"
            style={{
              backgroundColor: layer.fillColor,
              color: layer.textColor,
              borderRadius: '9999px',
              border: `${layer.borderWidth ?? 3}px dashed ${layer.borderColor || '#D91E2A'}`,
              boxShadow: shadowCss,
              fontFamily: `'${layer.fontFamily || 'Oswald'}', 'Plus Jakarta Sans', sans-serif`,
            }}
          >
            <div
              className="font-black leading-none"
              style={{ fontSize: `${Math.max(13, Math.round(Math.min(layer.width, layer.height) * 0.22))}px` }}
            >
              {layer.primaryText}
            </div>
            {layer.secondaryText && (
              <div
                className="font-extrabold mt-1 leading-tight"
                style={{ fontSize: `${Math.max(10, Math.round(Math.min(layer.width, layer.height) * 0.11))}px` }}
              >
                {layer.secondaryText}
              </div>
            )}
          </div>
        );
      } else {
        body = (
          <div
            className="w-full h-full flex flex-col items-center justify-center text-center px-3"
            style={{
              backgroundColor: layer.fillColor,
              color: layer.textColor,
              borderRadius: layer.badgeStyle === 'pill' ? '9999px' : `${layer.borderRadius ?? 12}px`,
              border:
                layer.borderWidth && layer.borderWidth > 0
                  ? `${layer.borderWidth}px solid ${layer.borderColor || '#0D0E14'}`
                  : undefined,
              boxShadow: shadowCss,
              fontFamily: `'${layer.fontFamily || 'Plus Jakarta Sans'}', sans-serif`,
            }}
          >
            <span
              className="font-black leading-none truncate max-w-full"
              style={{ fontSize: `${Math.max(11, Math.round(layer.height * 0.38))}px` }}
            >
              {layer.primaryText}
            </span>
            {layer.secondaryText && (
              <span
                className="font-bold leading-none mt-0.5 truncate max-w-full"
                style={{ fontSize: `${Math.max(9, Math.round(layer.height * 0.22))}px` }}
              >
                {layer.secondaryText}
              </span>
            )}
          </div>
        );
      }
    } else if (layer.type === 'sticker') {
      if (layer.stickerKind === 'plus_sign') {
        body = (
          <div
            className="w-full h-full rounded-full flex items-center justify-center font-black"
            style={{
              backgroundColor: layer.fillColor,
              color: layer.textColor || '#0D0E14',
              border: `3px solid ${layer.accentColor || '#0D0E14'}`,
              fontSize: `${Math.round(Math.min(layer.width, layer.height) * 0.72)}px`,
              boxShadow: shadowCss,
            }}
          >
            +
          </div>
        );
      } else if (layer.stickerKind === 'arrow_right' || layer.stickerKind === 'arrow_down') {
        body = (
          <svg viewBox="0 0 100 70" className="w-full h-full">
            {layer.stickerKind === 'arrow_right' ? (
              <polygon points="0,22 62,22 62,0 100,35 62,70 62,48 0,48" fill={layer.fillColor} />
            ) : (
              <polygon points="30,0 70,0 70,42 100,42 50,70 0,42 30,42" fill={layer.fillColor} />
            )}
          </svg>
        );
      } else if (layer.stickerKind === 'star_icon') {
        body = (
          <svg viewBox="0 0 100 100" className="w-full h-full">
            <polygon
              points="50,5 63,36 96,38 70,59 79,92 50,74 21,92 30,59 4,38 37,36"
              fill={layer.fillColor}
            />
          </svg>
        );
      } else {
        body = (
          <div
            className="w-full h-full rounded-full flex items-center justify-center text-center font-black px-2"
            style={{
              backgroundColor: layer.fillColor,
              color: layer.textColor || '#FFFFFF',
              border: `3px solid ${layer.accentColor || '#FFD21F'}`,
              fontSize: `${Math.max(10, Math.round(Math.min(layer.width, layer.height) * 0.17))}px`,
            }}
          >
            {(layer.label || '100% PREMIUM').toUpperCase()}
          </div>
        );
      }
    } else if (layer.type === 'qr') {
      const key = `${layer.qrValue}::${layer.foregroundColor || '#0F172A'}::${layer.backgroundColor || '#FFFFFF'}`;
      const qrImgUrl = qrDataUrls[key];
      body = (
        <div
          className="w-full h-full flex items-center justify-center p-1.5"
          style={{
            backgroundColor: layer.backgroundColor || '#FFFFFF',
            borderRadius: `${layer.borderRadius ?? 10}px`,
            boxShadow: shadowCss,
          }}
        >
          {qrImgUrl ? (
            <img src={qrImgUrl} alt="QR Code" className="w-full h-full object-contain pointer-events-none" />
          ) : (
            <QrCode className="w-8 h-8 text-slate-800" />
          )}
        </div>
      );
    }

    const resizeHandles: Array<{
      id: 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
      posClass: string;
      cursor: string;
    }> = [
      { id: 'nw', posClass: '-top-1.5 -left-1.5', cursor: 'nwse-resize' },
      { id: 'n', posClass: '-top-1.5 left-1/2 -translate-x-1/2', cursor: 'ns-resize' },
      { id: 'ne', posClass: '-top-1.5 -right-1.5', cursor: 'nesw-resize' },
      { id: 'e', posClass: 'top-1/2 -right-1.5 -translate-y-1/2', cursor: 'ew-resize' },
      { id: 'se', posClass: '-bottom-1.5 -right-1.5', cursor: 'nwse-resize' },
      { id: 's', posClass: '-bottom-1.5 left-1/2 -translate-x-1/2', cursor: 'ns-resize' },
      { id: 'sw', posClass: '-bottom-1.5 -left-1.5', cursor: 'nesw-resize' },
      { id: 'w', posClass: 'top-1/2 -left-1.5 -translate-y-1/2', cursor: 'ew-resize' },
    ];

    return (
      <div
        key={layer.id}
        id={`canvas-layer-${layer.id}`}
        style={commonStyle}
        onPointerDown={e => startMoveDrag(e, layer)}
        onDoubleClick={e => {
          e.stopPropagation();
          if (layer.type === 'text' && !layer.locked) {
            setSelectedIds([layer.id]);
            setInlineEditLayerId(layer.id);
          }
        }}
      >
        {body}

        {isSelected && (
          <div
            className={`absolute inset-0 pointer-events-none ${
              layer.locked
                ? 'ring-2 ring-amber-400'
                : 'ring-2 ring-cyan-400 shadow-[0_0_0_1px_rgba(0,0,0,0.6)]'
            }`}
          />
        )}

        {isPrimary && !layer.locked && (
          <>
            {/* Top Rotation Knob */}
            <button
              type="button"
              onPointerDown={e => startRotateDrag(e, layer)}
              title="Drag to rotate"
              className="absolute -top-8 left-1/2 -translate-x-1/2 w-5 h-5 rounded-full bg-cyan-400 text-slate-950 border border-slate-950 flex items-center justify-center shadow cursor-grab active:cursor-grabbing"
              style={{ transform: `scale(${Math.max(1, 1 / Math.max(0.25, zoom))})` }}
            >
              <RotateCw className="w-3 h-3" />
            </button>

            {resizeHandles.map(h => (
              <div
                key={h.id}
                onPointerDown={e => startResizeDrag(e, layer, h.id)}
                className={`absolute ${h.posClass} w-3 h-3 bg-white border-2 border-cyan-500 rounded-xs shadow`}
                style={{
                  cursor: h.cursor,
                  transform: `scale(${Math.max(1, 0.9 / Math.max(0.28, zoom))})`,
                }}
              />
            ))}
          </>
        )}
      </div>
    );
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-slate-900 text-slate-100 overflow-hidden">
      {/* TOP TOOLBAR */}
      <div className="px-3 py-2 bg-slate-950 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs shrink-0">
        <div className="flex flex-wrap items-center gap-1">
          <button
            type="button"
            disabled={historyPast.length === 0}
            onClick={handleUndo}
            title="Undo (Ctrl+Z)"
            className="px-2 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-35 inline-flex items-center gap-1 whitespace-nowrap cursor-pointer"
          >
            <Undo2 className="w-3.5 h-3.5" />
            <span>Undo</span>
          </button>
          <button
            type="button"
            disabled={historyFuture.length === 0}
            onClick={handleRedo}
            title="Redo (Ctrl+Y)"
            className="px-2 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-35 inline-flex items-center gap-1 whitespace-nowrap cursor-pointer"
          >
            <Redo2 className="w-3.5 h-3.5" />
            <span>Redo</span>
          </button>

          <div className="w-px h-5 bg-slate-700 mx-1" />

          <button
            type="button"
            disabled={selectedIds.length === 0}
            onClick={handleCopy}
            title="Copy (Ctrl+C)"
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-35 cursor-pointer"
          >
            <Copy className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            disabled={clipboard.length === 0}
            onClick={handlePaste}
            title="Paste (Ctrl+V)"
            className="px-2 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-35 text-[11px] font-semibold cursor-pointer whitespace-nowrap"
          >
            Paste
          </button>
          <button
            type="button"
            disabled={selectedIds.length === 0}
            onClick={handleDuplicateSelected}
            title="Duplicate (Ctrl+D)"
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-35 cursor-pointer"
          >
            <CopyPlus className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            disabled={selectedIds.length === 0}
            onClick={deleteSelected}
            title="Delete Selected"
            className="p-1.5 rounded-lg bg-rose-950/70 hover:bg-rose-800 text-rose-200 disabled:opacity-35 cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>

          <div className="w-px h-5 bg-slate-700 mx-1" />

          {/* ALIGNMENT CONTROLS */}
          <button
            type="button"
            disabled={selectedIds.length === 0}
            onClick={() => handleAlign('left')}
            title="Align Left"
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-35 cursor-pointer"
          >
            <AlignStartHorizontal className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            disabled={selectedIds.length === 0}
            onClick={() => handleAlign('center')}
            title="Align Horizontal Center"
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-35 cursor-pointer"
          >
            <AlignCenterHorizontal className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            disabled={selectedIds.length === 0}
            onClick={() => handleAlign('right')}
            title="Align Right"
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-35 cursor-pointer"
          >
            <AlignEndHorizontal className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            disabled={selectedIds.length === 0}
            onClick={() => handleAlign('top')}
            title="Align Top"
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-35 cursor-pointer"
          >
            <AlignStartVertical className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            disabled={selectedIds.length === 0}
            onClick={() => handleAlign('middle')}
            title="Align Vertical Middle"
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-35 cursor-pointer"
          >
            <AlignCenterVertical className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            disabled={selectedIds.length === 0}
            onClick={() => handleAlign('bottom')}
            title="Align Bottom"
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-35 cursor-pointer"
          >
            <AlignEndVertical className="w-3.5 h-3.5" />
          </button>

          {selectedIds.length >= 3 && (
            <>
              <button
                type="button"
                onClick={() => handleDistribute('horizontal')}
                className="px-2 py-1 rounded-lg bg-cyan-900/60 hover:bg-cyan-800 text-[11px] font-semibold cursor-pointer whitespace-nowrap"
              >
                Dist H
              </button>
              <button
                type="button"
                onClick={() => handleDistribute('vertical')}
                className="px-2 py-1 rounded-lg bg-cyan-900/60 hover:bg-cyan-800 text-[11px] font-semibold cursor-pointer whitespace-nowrap"
              >
                Dist V
              </button>
            </>
          )}

          {selectedIds.length >= 2 && (
            <button
              type="button"
              onClick={() =>
                commitProject(
                  { ...project, layers: groupSelectedLayers(project.layers, selectedIds) },
                  true
                )
              }
              title="Group Selected Layers"
              className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 inline-flex items-center gap-1 text-[11px] font-semibold cursor-pointer whitespace-nowrap"
            >
              <Group className="w-3.5 h-3.5" />
              <span>Group</span>
            </button>
          )}
          {primarySelectedLayer?.groupId && (
            <button
              type="button"
              onClick={() =>
                commitProject(
                  { ...project, layers: ungroupLayers(project.layers, selectedIds) },
                  true
                )
              }
              title="Ungroup"
              className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 inline-flex items-center gap-1 text-[11px] font-semibold cursor-pointer whitespace-nowrap"
            >
              <Ungroup className="w-3.5 h-3.5" />
              <span>Ungroup</span>
            </button>
          )}
        </div>

        {/* RIGHT TOOLBAR: ZOOM, GRID, RESET & SAVE TEMPLATE */}
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setShowGrid(g => !g)}
            className={`px-2 py-1.5 rounded-lg inline-flex items-center gap-1 text-[11px] font-semibold cursor-pointer whitespace-nowrap ${
              showGrid ? 'bg-cyan-600 text-white' : 'bg-slate-800 text-slate-300'
            }`}
          >
            <Grid className="w-3.5 h-3.5" />
            <span>Grid</span>
          </button>

          <div className="inline-flex items-center bg-slate-800 rounded-lg p-0.5">
            <button
              type="button"
              onClick={() => setZoom(z => Math.max(0.15, Math.round((z - 0.08) * 100) / 100))}
              className="p-1 hover:bg-slate-700 rounded cursor-pointer"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={fitCanvasToViewport}
              className="px-2 text-[11px] font-mono-num font-bold hover:text-cyan-300 cursor-pointer whitespace-nowrap"
            >
              {Math.round(zoom * 100)}%
            </button>
            <button
              type="button"
              onClick={() => setZoom(z => Math.min(1.5, Math.round((z + 0.08) * 100) / 100))}
              className="p-1 hover:bg-slate-700 rounded cursor-pointer"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
          </div>

          <button
            type="button"
            onClick={onResetFromAiDesign}
            className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-amber-300 text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer whitespace-nowrap"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Import AI Poster</span>
          </button>

          <button
            type="button"
            onClick={() => setShowSaveTplModal(true)}
            className="px-2.5 py-1.5 rounded-lg bg-amber-400 hover:bg-amber-300 text-slate-950 text-[11px] font-extrabold inline-flex items-center gap-1 cursor-pointer whitespace-nowrap"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Save Template</span>
          </button>
        </div>
      </div>

      {/* MAIN 3-COLUMN WORKSPACE */}
      <div className="flex-1 min-h-0 flex overflow-hidden">
        {/* LEFT TOOL & ASSET PANEL */}
        <div className="w-72 shrink-0 bg-slate-950 border-r border-slate-800 flex flex-col overflow-hidden">
          <div className="grid grid-cols-4 border-b border-slate-800 text-[11px] font-bold">
            {[
              { id: 'combo' as const, label: 'Combo', icon: Layers },
              { id: 'models' as const, label: 'Models', icon: UserCheck },
              { id: 'text' as const, label: 'Text', icon: Type },
              { id: 'elements' as const, label: 'Elements', icon: Shapes },
            ].map(tab => {
              const Icon = tab.icon;
              const active = leftTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setLeftTab(tab.id)}
                  className={`py-2.5 px-1 flex flex-col items-center gap-1 cursor-pointer border-b-2 ${
                    active
                      ? 'border-amber-400 text-amber-300 bg-slate-900'
                      : 'border-transparent text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-4 text-xs">
            {leftTab === 'combo' && (
              <>
                <div className="p-2.5 rounded-xl bg-slate-900 border border-slate-800 space-y-2">
                  <div className="font-bold text-amber-300">Live Combo Data (Zero Stock Mutation)</div>
                  <div className="text-[11px] text-slate-300 space-y-0.5">
                    <div>
                      Offer Price: <strong className="text-white">{formatMoney(pricing.finalComboPrice)}</strong>
                    </div>
                    <div>
                      Regular Total: <span className="line-through">{formatMoney(pricing.regularTotalPrice)}</span>
                    </div>
                    <div>
                      Savings: <strong className="text-emerald-400">{formatMoney(pricing.savingsAmount)} ({pricing.discountPercent}%)</strong>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-1.5 pt-1">
                    <button
                      type="button"
                      onClick={() => insertBadge('starburst')}
                      className="px-2 py-1.5 rounded-lg bg-amber-400 text-slate-950 font-bold text-[11px] cursor-pointer"
                    >
                      + Savings Burst
                    </button>
                    <button
                      type="button"
                      onClick={insertQrCodeLayer}
                      className="px-2 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-white font-bold text-[11px] cursor-pointer"
                    >
                      + QR Code
                    </button>
                    {biz.logoUrl && (
                      <button
                        type="button"
                        onClick={() =>
                          addLayer({
                            id: makeLayerId('logo'),
                            name: 'Shop Logo',
                            type: 'image',
                            src: biz.logoUrl!,
                            fit: 'contain',
                            backgroundColor: '#FFFFFF',
                            borderRadius: 12,
                            x: 40,
                            y: 36,
                            width: 84,
                            height: 84,
                            rotation: 0,
                            opacity: 1,
                            visible: true,
                            locked: false,
                            zIndex: 99,
                            tagRole: 'logo',
                          })
                        }
                        className="px-2 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-white font-bold text-[11px] cursor-pointer col-span-2"
                      >
                        + Insert Shop Logo
                      </button>
                    )}
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="font-bold text-slate-200">
                    Insert Product Cards ({resolvedItems.length})
                  </div>
                  {resolvedItems.map((item, idx) => (
                    <div
                      key={item.itemKey}
                      className="p-2 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-between gap-2"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="w-9 h-9 rounded-lg bg-white overflow-hidden shrink-0 flex items-center justify-center">
                          {item.imageUrl ? (
                            <img src={item.imageUrl} alt={item.productName} className="w-full h-full object-contain" />
                          ) : (
                            <ImageIcon className="w-4 h-4 text-slate-400" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className="font-bold text-slate-100 truncate">
                            {item.quantity}× {item.productName}
                          </div>
                          <div className="text-[10px] text-slate-400 truncate">
                            {formatMoney(item.lineRegularTotal)}
                          </div>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => insertComboProductCardGroup(idx)}
                        className="px-2 py-1 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-[10px] font-bold cursor-pointer shrink-0"
                      >
                        + Card
                      </button>
                    </div>
                  ))}
                </div>
              </>
            )}

            {leftTab === 'models' && (
              <>
                <div className="space-y-2">
                  <div className="font-bold text-slate-200">Upload Image (PC &amp; Mobile)</div>
                  <div className="grid grid-cols-1 gap-2">
                    <label className="w-full py-2 px-3 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-extrabold text-[11px] flex items-center justify-center gap-1.5 cursor-pointer">
                      <Upload className="w-3.5 h-3.5" />
                      <span>Upload Model Photo (Auto Cutout)</span>
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        className="hidden"
                        onChange={e => {
                          handleUploadImageLayer(e.target.files?.[0] || null, 'model');
                          e.target.value = '';
                        }}
                      />
                    </label>
                    <label className="w-full py-2 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-100 font-bold text-[11px] flex items-center justify-center gap-1.5 cursor-pointer">
                      <ImageIcon className="w-3.5 h-3.5" />
                      <span>Upload Product / PNG Sticker</span>
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        className="hidden"
                        onChange={e => {
                          handleUploadImageLayer(e.target.files?.[0] || null, 'uploaded');
                          e.target.value = '';
                        }}
                      />
                    </label>
                  </div>
                </div>

                <div className="space-y-2 pt-2 border-t border-slate-800">
                  <div className="font-bold text-slate-200">Fashion Model Library (6 Personas)</div>
                  <div className="grid grid-cols-2 gap-2">
                    {POSTER_MODEL_PRESETS.map(preset => (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => insertPresetModel(preset)}
                        className="p-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-amber-400 text-left cursor-pointer transition-all"
                      >
                        <div className="aspect-[3/4] rounded-lg bg-white overflow-hidden mb-1.5">
                          <img
                            src={preset.imageUrl}
                            alt={preset.label}
                            className="w-full h-full object-cover"
                          />
                        </div>
                        <div className="font-bold text-[11px] text-white truncate">
                          {preset.shortLabel}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}

            {leftTab === 'text' && (
              <div className="space-y-2.5">
                <div className="font-bold text-slate-200">Add Typography Block</div>
                <button
                  type="button"
                  onClick={() => insertTextPreset('headline')}
                  className="w-full p-3 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-left cursor-pointer"
                >
                  <div className="text-base font-black text-amber-300">BOLD HEADLINE</div>
                  <div className="text-[10px] text-slate-400">Oswald Display Title</div>
                </button>
                <button
                  type="button"
                  onClick={() => insertTextPreset('bangla')}
                  className="w-full p-3 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-left cursor-pointer"
                >
                  <div className="text-sm font-bold text-white">স্পেশাল কম্বো অফার (বাংলা)</div>
                  <div className="text-[10px] text-slate-400">Hind Siliguri / Noto Sans Bengali</div>
                </button>
                <button
                  type="button"
                  onClick={() => insertTextPreset('price')}
                  className="w-full p-3 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-left cursor-pointer"
                >
                  <div className="text-lg font-black text-amber-400 font-mono-num">
                    {formatMoney(pricing.finalComboPrice)}
                  </div>
                  <div className="text-[10px] text-slate-400">Combo Price Callout</div>
                </button>
                <button
                  type="button"
                  onClick={() => insertTextPreset('body')}
                  className="w-full p-3 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-left cursor-pointer"
                >
                  <div className="text-xs font-semibold text-slate-200">Promo Tagline &amp; Details</div>
                  <div className="text-[10px] text-slate-400">Clean sans-serif subtitle</div>
                </button>
              </div>
            )}

            {leftTab === 'elements' && (
              <>
                <div className="space-y-2">
                  <div className="font-bold text-slate-200">Shapes &amp; Frames</div>
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      onClick={() => insertShape('rounded_rect')}
                      className="p-2 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 font-semibold cursor-pointer"
                    >
                      Rounded Box
                    </button>
                    <button
                      type="button"
                      onClick={() => insertShape('rectangle')}
                      className="p-2 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 font-semibold cursor-pointer"
                    >
                      Rectangle
                    </button>
                    <button
                      type="button"
                      onClick={() => insertShape('circle')}
                      className="p-2 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 font-semibold cursor-pointer"
                    >
                      Circle
                    </button>
                    <button
                      type="button"
                      onClick={() => insertShape('line')}
                      className="p-2 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 font-semibold cursor-pointer"
                    >
                      Divider Line
                    </button>
                  </div>
                </div>

                <div className="space-y-2 pt-2 border-t border-slate-800">
                  <div className="font-bold text-slate-200">Badges &amp; Retail Stickers</div>
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      onClick={() => insertSticker('plus_sign')}
                      className="p-2 rounded-lg bg-amber-400/20 hover:bg-amber-400/30 border border-amber-400/50 text-amber-300 font-extrabold cursor-pointer"
                    >
                      + Plus Sign
                    </button>
                    <button
                      type="button"
                      onClick={() => insertBadge('starburst')}
                      className="p-2 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 font-semibold cursor-pointer"
                    >
                      Discount Burst
                    </button>
                    <button
                      type="button"
                      onClick={() => insertBadge('pill')}
                      className="p-2 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 font-semibold cursor-pointer"
                    >
                      Promo Pill
                    </button>
                    <button
                      type="button"
                      onClick={() => insertSticker('quality_seal')}
                      className="p-2 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 font-semibold cursor-pointer"
                    >
                      Quality Seal
                    </button>
                    <button
                      type="button"
                      onClick={() => insertSticker('arrow_right')}
                      className="p-2 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 font-semibold cursor-pointer"
                    >
                      Arrow Right
                    </button>
                    <button
                      type="button"
                      onClick={() => insertSticker('star_icon')}
                      className="p-2 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 font-semibold cursor-pointer"
                    >
                      Star Accent
                    </button>
                  </div>
                </div>

                <div className="space-y-2 pt-2 border-t border-slate-800">
                  <div className="font-bold text-slate-200 flex items-center gap-1.5">
                    <Palette className="w-3.5 h-3.5 text-amber-400" />
                    <span>Canvas Size &amp; Background</span>
                  </div>
                  <select
                    value={dimensionPreset}
                    onChange={e => {
                      const nextPreset = e.target.value as PosterDimensionPreset;
                      const spec = POSTER_DIMENSION_PRESETS[nextPreset];
                      onChangeDimensionPreset(nextPreset, spec.widthPx, spec.heightPx);
                    }}
                    className="w-full p-2 rounded-lg bg-slate-900 border border-slate-700 text-slate-100"
                  >
                    {Object.values(POSTER_DIMENSION_PRESETS).map(sp => (
                      <option key={sp.id} value={sp.id}>
                        {sp.label}
                      </option>
                    ))}
                  </select>

                  {dimensionPreset === 'custom' && (
                    <div className="grid grid-cols-2 gap-1.5">
                      <input
                        type="number"
                        min={400}
                        max={3600}
                        value={project.canvasWidth}
                        onChange={e =>
                          onChangeDimensionPreset(
                            'custom',
                            Math.max(400, Number(e.target.value) || 1080),
                            project.canvasHeight
                          )
                        }
                        className="p-1.5 rounded-lg bg-slate-900 border border-slate-700 font-mono-num"
                      />
                      <input
                        type="number"
                        min={400}
                        max={3600}
                        value={project.canvasHeight}
                        onChange={e =>
                          onChangeDimensionPreset(
                            'custom',
                            project.canvasWidth,
                            Math.max(400, Number(e.target.value) || 1350)
                          )
                        }
                        className="p-1.5 rounded-lg bg-slate-900 border border-slate-700 font-mono-num"
                      />
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[10px] text-slate-400 mb-1">Bg Start</label>
                      <input
                        type="color"
                        value={project.backgroundColor}
                        onChange={e =>
                          commitProject({ ...project, backgroundColor: e.target.value }, true)
                        }
                        className="w-full h-8 rounded bg-slate-900 border border-slate-700 cursor-pointer"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-slate-400 mb-1">Gradient End</label>
                      <input
                        type="color"
                        value={project.backgroundGradientEnd || '#991B1B'}
                        onChange={e =>
                          commitProject(
                            {
                              ...project,
                              backgroundGradientEnabled: true,
                              backgroundGradientEnd: e.target.value,
                            },
                            true
                          )
                        }
                        className="w-full h-8 rounded bg-slate-900 border border-slate-700 cursor-pointer"
                      />
                    </div>
                  </div>

                  <label className="w-full py-1.5 px-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 font-semibold text-[11px] flex items-center justify-center gap-1.5 cursor-pointer">
                    <Upload className="w-3.5 h-3.5" />
                    <span>Upload Background Photo</span>
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      className="hidden"
                      onChange={e => {
                        handleUploadImageLayer(e.target.files?.[0] || null, 'background');
                        e.target.value = '';
                      }}
                    />
                  </label>
                  {project.backgroundImageUrl && (
                    <button
                      type="button"
                      onClick={() =>
                        commitProject({ ...project, backgroundImageUrl: undefined }, true)
                      }
                      className="w-full py-1 text-[10px] text-rose-400 hover:underline cursor-pointer"
                    >
                      Remove Background Photo
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        {/* CENTER INTERACTIVE CANVAS STAGE */}
        <div
          ref={viewportRef}
          onPointerDown={() => {
            setSelectedIds([]);
            setInlineEditLayerId(null);
          }}
          className="flex-1 min-w-0 bg-slate-950/85 overflow-auto flex items-center justify-center p-6 relative"
        >
          <div
            style={{
              width: Math.round(project.canvasWidth * zoom),
              height: Math.round(project.canvasHeight * zoom),
              position: 'relative',
              flexShrink: 0,
            }}
            className="shadow-2xl ring-1 ring-white/15"
          >
            <div
              style={{
                width: project.canvasWidth,
                height: project.canvasHeight,
                transform: `scale(${zoom})`,
                transformOrigin: 'top left',
                position: 'relative',
                overflow: 'hidden',
                background:
                  project.backgroundGradientEnabled && project.backgroundGradientEnd
                    ? `linear-gradient(180deg, ${project.backgroundColor}, ${project.backgroundGradientEnd})`
                    : project.backgroundColor,
              }}
            >
              {project.backgroundImageUrl && (
                <img
                  src={project.backgroundImageUrl}
                  alt="Canvas Backdrop"
                  className="absolute inset-0 w-full h-full object-cover pointer-events-none"
                />
              )}

              {showGrid && (
                <div
                  className="absolute inset-0 pointer-events-none opacity-15"
                  style={{
                    backgroundImage:
                      'linear-gradient(to right, rgba(255,255,255,0.22) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.22) 1px, transparent 1px)',
                    backgroundSize: '48px 48px',
                  }}
                />
              )}

              {/* SNAP ALIGNMENT GUIDES */}
              {snapGuides.x !== null && (
                <div
                  className="absolute top-0 bottom-0 w-0.5 bg-cyan-400 pointer-events-none z-50"
                  style={{ left: snapGuides.x }}
                />
              )}
              {snapGuides.y !== null && (
                <div
                  className="absolute left-0 right-0 h-0.5 bg-cyan-400 pointer-events-none z-50"
                  style={{ top: snapGuides.y }}
                />
              )}

              {sortedLayersBottomFirst.map(renderLiveStageLayer)}
            </div>
          </div>
        </div>

        {/* RIGHT INSPECTOR: PROPERTIES & LAYERS */}
        <div className="w-72 shrink-0 bg-slate-950 border-l border-slate-800 flex flex-col overflow-hidden">
          <div className="grid grid-cols-2 border-b border-slate-800 text-xs font-bold">
            <button
              type="button"
              onClick={() => setRightTab('properties')}
              className={`py-2.5 flex items-center justify-center gap-1.5 border-b-2 cursor-pointer ${
                rightTab === 'properties'
                  ? 'border-amber-400 text-amber-300 bg-slate-900'
                  : 'border-transparent text-slate-400'
              }`}
            >
              <Sliders className="w-3.5 h-3.5" />
              <span>Properties</span>
            </button>
            <button
              type="button"
              onClick={() => setRightTab('layers')}
              className={`py-2.5 flex items-center justify-center gap-1.5 border-b-2 cursor-pointer ${
                rightTab === 'layers'
                  ? 'border-amber-400 text-amber-300 bg-slate-900'
                  : 'border-transparent text-slate-400'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Layers ({project.layers.length})</span>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-4 text-xs">
            {rightTab === 'layers' ? (
              <div className="space-y-1.5">
                {sortedLayersTopFirst.length === 0 ? (
                  <p className="text-slate-400 text-center py-6">
                    Canvas is empty. Add products, models, text, or click &ldquo;Import AI Poster&rdquo;.
                  </p>
                ) : (
                  sortedLayersTopFirst.map(layer => {
                    const selected = selectedIds.includes(layer.id);
                    return (
                      <div
                        key={layer.id}
                        onClick={e => {
                          if (e.shiftKey) {
                            setSelectedIds(prev =>
                              prev.includes(layer.id)
                                ? prev.filter(i => i !== layer.id)
                                : [...prev, layer.id]
                            );
                          } else {
                            setSelectedIds([layer.id]);
                          }
                        }}
                        className={`p-2 rounded-lg border flex items-center justify-between gap-1.5 cursor-pointer ${
                          selected
                            ? 'bg-cyan-950/60 border-cyan-500 text-white'
                            : 'bg-slate-900 border-slate-800 text-slate-300 hover:border-slate-700'
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="font-semibold truncate">{layer.name}</div>
                          <div className="text-[10px] text-slate-400 uppercase">
                            {layer.type}
                            {layer.groupId ? ' · Grouped' : ''}
                          </div>
                        </div>
                        <div className="flex items-center gap-0.5 shrink-0">
                          <button
                            type="button"
                            title="Move Forward"
                            onClick={e => {
                              e.stopPropagation();
                              commitProject(
                                {
                                  ...project,
                                  layers: reorderLayerZIndex(project.layers, layer.id, 'forward'),
                                },
                                true
                              );
                            }}
                            className="p-1 hover:bg-slate-800 rounded cursor-pointer"
                          >
                            <ArrowUp className="w-3 h-3" />
                          </button>
                          <button
                            type="button"
                            title="Move Backward"
                            onClick={e => {
                              e.stopPropagation();
                              commitProject(
                                {
                                  ...project,
                                  layers: reorderLayerZIndex(project.layers, layer.id, 'backward'),
                                },
                                true
                              );
                            }}
                            className="p-1 hover:bg-slate-800 rounded cursor-pointer"
                          >
                            <ArrowDown className="w-3 h-3" />
                          </button>
                          <button
                            type="button"
                            title={layer.visible ? 'Hide' : 'Show'}
                            onClick={e => {
                              e.stopPropagation();
                              commitProject(
                                {
                                  ...project,
                                  layers: project.layers.map(l =>
                                    l.id === layer.id ? { ...l, visible: !l.visible } : l
                                  ),
                                },
                                true
                              );
                            }}
                            className="p-1 hover:bg-slate-800 rounded cursor-pointer"
                          >
                            {layer.visible ? (
                              <Eye className="w-3 h-3" />
                            ) : (
                              <EyeOff className="w-3 h-3 text-slate-500" />
                            )}
                          </button>
                          <button
                            type="button"
                            title={layer.locked ? 'Unlock' : 'Lock'}
                            onClick={e => {
                              e.stopPropagation();
                              commitProject(
                                {
                                  ...project,
                                  layers: project.layers.map(l =>
                                    l.id === layer.id ? { ...l, locked: !l.locked } : l
                                  ),
                                },
                                true
                              );
                            }}
                            className="p-1 hover:bg-slate-800 rounded cursor-pointer"
                          >
                            {layer.locked ? (
                              <Lock className="w-3 h-3 text-amber-400" />
                            ) : (
                              <Unlock className="w-3 h-3" />
                            )}
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            ) : !primarySelectedLayer ? (
              <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 text-slate-400 text-center space-y-2">
                <Sliders className="w-6 h-6 mx-auto text-slate-500" />
                <div className="font-semibold text-slate-200">Select an Object on Canvas</div>
                <p className="text-[11px]">
                  Click any text, model, product card, badge, or shape to adjust position, size, crop, background removal, fonts, or colors.
                </p>
              </div>
            ) : (
              <div className="space-y-3.5">
                {/* Layer Title + Z-Order Quick Actions */}
                <div className="p-2.5 rounded-xl bg-slate-900 border border-slate-800 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-amber-300 truncate">
                      {primarySelectedLayer.name}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        updateSelectedLayer({ locked: !primarySelectedLayer.locked }, true)
                      }
                      className="px-2 py-0.5 rounded bg-slate-800 text-[10px] font-bold cursor-pointer"
                    >
                      {primarySelectedLayer.locked ? 'Unlock' : 'Lock'}
                    </button>
                  </div>
                  <div className="grid grid-cols-4 gap-1 text-[10px]">
                    <button
                      type="button"
                      onClick={() =>
                        commitProject(
                          {
                            ...project,
                            layers: reorderLayerZIndex(
                              project.layers,
                              primarySelectedLayer.id,
                              'front'
                            ),
                          },
                          true
                        )
                      }
                      className="py-1 rounded bg-slate-800 hover:bg-slate-700 font-semibold cursor-pointer flex items-center justify-center gap-0.5"
                    >
                      <MoveUp className="w-3 h-3" /> Front
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        commitProject(
                          {
                            ...project,
                            layers: reorderLayerZIndex(
                              project.layers,
                              primarySelectedLayer.id,
                              'forward'
                            ),
                          },
                          true
                        )
                      }
                      className="py-1 rounded bg-slate-800 hover:bg-slate-700 font-semibold cursor-pointer"
                    >
                      Up
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        commitProject(
                          {
                            ...project,
                            layers: reorderLayerZIndex(
                              project.layers,
                              primarySelectedLayer.id,
                              'backward'
                            ),
                          },
                          true
                        )
                      }
                      className="py-1 rounded bg-slate-800 hover:bg-slate-700 font-semibold cursor-pointer"
                    >
                      Down
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        commitProject(
                          {
                            ...project,
                            layers: reorderLayerZIndex(
                              project.layers,
                              primarySelectedLayer.id,
                              'back'
                            ),
                          },
                          true
                        )
                      }
                      className="py-1 rounded bg-slate-800 hover:bg-slate-700 font-semibold cursor-pointer flex items-center justify-center gap-0.5"
                    >
                      <MoveDown className="w-3 h-3" /> Back
                    </button>
                  </div>
                </div>

                {/* Transform Controls */}
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] text-slate-400">X (px)</label>
                    <input
                      type="number"
                      value={Math.round(primarySelectedLayer.x)}
                      onChange={e => updateSelectedLayer({ x: Number(e.target.value) || 0 })}
                      className="w-full p-1.5 rounded bg-slate-900 border border-slate-700 font-mono-num"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-400">Y (px)</label>
                    <input
                      type="number"
                      value={Math.round(primarySelectedLayer.y)}
                      onChange={e => updateSelectedLayer({ y: Number(e.target.value) || 0 })}
                      className="w-full p-1.5 rounded bg-slate-900 border border-slate-700 font-mono-num"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-400">Width</label>
                    <input
                      type="number"
                      min={16}
                      value={Math.round(primarySelectedLayer.width)}
                      onChange={e =>
                        updateSelectedLayer({ width: Math.max(16, Number(e.target.value) || 40) })
                      }
                      className="w-full p-1.5 rounded bg-slate-900 border border-slate-700 font-mono-num"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-400">Height</label>
                    <input
                      type="number"
                      min={12}
                      value={Math.round(primarySelectedLayer.height)}
                      onChange={e =>
                        updateSelectedLayer({ height: Math.max(12, Number(e.target.value) || 40) })
                      }
                      className="w-full p-1.5 rounded bg-slate-900 border border-slate-700 font-mono-num"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-400">
                      Rotation ({Math.round(primarySelectedLayer.rotation)}°)
                    </label>
                    <input
                      type="range"
                      min={-180}
                      max={180}
                      value={primarySelectedLayer.rotation}
                      onChange={e =>
                        updateSelectedLayer({ rotation: Number(e.target.value) })
                      }
                      className="w-full"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-400">
                      Opacity ({Math.round((primarySelectedLayer.opacity ?? 1) * 100)}%)
                    </label>
                    <input
                      type="range"
                      min={10}
                      max={100}
                      value={Math.round((primarySelectedLayer.opacity ?? 1) * 100)}
                      onChange={e =>
                        updateSelectedLayer({ opacity: Number(e.target.value) / 100 })
                      }
                      className="w-full"
                    />
                  </div>
                </div>

                {/* TEXT LAYER PROPERTIES */}
                {primarySelectedLayer.type === 'text' && (
                  <div className="space-y-2.5 pt-2 border-t border-slate-800">
                    <div>
                      <label className="text-[10px] text-slate-400">Text Content</label>
                      <textarea
                        rows={3}
                        value={primarySelectedLayer.text}
                        onChange={e => updateSelectedLayer({ text: e.target.value })}
                        className="w-full p-2 rounded-lg bg-slate-900 border border-slate-700 text-white"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-slate-400">Font Family</label>
                      <select
                        value={primarySelectedLayer.fontFamily}
                        onChange={e => updateSelectedLayer({ fontFamily: e.target.value })}
                        className="w-full p-1.5 rounded bg-slate-900 border border-slate-700"
                      >
                        {FONT_OPTIONS.map(f => (
                          <option key={f.value} value={f.value}>
                            {f.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="grid grid-cols-3 gap-1.5">
                      <div>
                        <label className="text-[10px] text-slate-400">Size</label>
                        <input
                          type="number"
                          min={10}
                          max={220}
                          value={primarySelectedLayer.fontSize}
                          onChange={e =>
                            updateSelectedLayer({
                              fontSize: Math.max(10, Number(e.target.value) || 24),
                            })
                          }
                          className="w-full p-1.5 rounded bg-slate-900 border border-slate-700 font-mono-num"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-slate-400">Color</label>
                        <input
                          type="color"
                          value={primarySelectedLayer.color}
                          onChange={e => updateSelectedLayer({ color: e.target.value })}
                          className="w-full h-8 rounded bg-slate-900 border border-slate-700 cursor-pointer"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-slate-400">Align</label>
                        <select
                          value={primarySelectedLayer.textAlign}
                          onChange={e =>
                            updateSelectedLayer({
                              textAlign: e.target.value as PosterTextLayer['textAlign'],
                            })
                          }
                          className="w-full p-1.5 rounded bg-slate-900 border border-slate-700"
                        >
                          <option value="left">Left</option>
                          <option value="center">Center</option>
                          <option value="right">Right</option>
                        </select>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-1.5">
                      <button
                        type="button"
                        onClick={() =>
                          updateSelectedLayer({
                            fontWeight: primarySelectedLayer.fontWeight === '900' ? '600' : '900',
                          })
                        }
                        className={`px-2.5 py-1 rounded text-[11px] font-bold cursor-pointer ${
                          primarySelectedLayer.fontWeight === '800' ||
                          primarySelectedLayer.fontWeight === '900'
                            ? 'bg-amber-400 text-slate-950'
                            : 'bg-slate-800 text-slate-200'
                        }`}
                      >
                        Bold
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          updateSelectedLayer({
                            fontStyle:
                              primarySelectedLayer.fontStyle === 'italic' ? 'normal' : 'italic',
                          })
                        }
                        className={`px-2.5 py-1 rounded text-[11px] italic cursor-pointer ${
                          primarySelectedLayer.fontStyle === 'italic'
                            ? 'bg-amber-400 text-slate-950 font-bold'
                            : 'bg-slate-800 text-slate-200'
                        }`}
                      >
                        Italic
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          updateSelectedLayer({
                            strikethrough: !primarySelectedLayer.strikethrough,
                          })
                        }
                        className={`px-2.5 py-1 rounded text-[11px] line-through cursor-pointer ${
                          primarySelectedLayer.strikethrough
                            ? 'bg-rose-500 text-white font-bold'
                            : 'bg-slate-800 text-slate-200'
                        }`}
                      >
                        Strike
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          updateSelectedLayer({
                            strokeWidth: primarySelectedLayer.strokeWidth ? 0 : 4,
                            strokeColor: primarySelectedLayer.strokeColor || '#000000',
                          })
                        }
                        className={`px-2.5 py-1 rounded text-[11px] cursor-pointer ${
                          primarySelectedLayer.strokeWidth
                            ? 'bg-cyan-500 text-slate-950 font-bold'
                            : 'bg-slate-800 text-slate-200'
                        }`}
                      >
                        Outline
                      </button>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[10px] text-slate-400">Box Fill</label>
                        <div className="flex items-center gap-1">
                          <input
                            type="color"
                            value={primarySelectedLayer.backgroundColor || '#000000'}
                            onChange={e =>
                              updateSelectedLayer({ backgroundColor: e.target.value })
                            }
                            className="w-10 h-7 rounded bg-slate-900 border border-slate-700 cursor-pointer"
                          />
                          {primarySelectedLayer.backgroundColor && (
                            <button
                              type="button"
                              onClick={() => updateSelectedLayer({ backgroundColor: undefined })}
                              className="text-[10px] text-rose-400 hover:underline cursor-pointer"
                            >
                              Clear
                            </button>
                          )}
                        </div>
                      </div>
                      <div>
                        <label className="text-[10px] text-slate-400">Shadow Blur</label>
                        <input
                          type="number"
                          min={0}
                          max={40}
                          value={primarySelectedLayer.shadowBlur || 0}
                          onChange={e =>
                            updateSelectedLayer({
                              shadowBlur: Math.max(0, Number(e.target.value) || 0),
                              shadowColor: primarySelectedLayer.shadowColor || 'rgba(0,0,0,0.65)',
                            })
                          }
                          className="w-full p-1 rounded bg-slate-900 border border-slate-700 font-mono-num"
                        />
                      </div>
                    </div>
                  </div>
                )}

                {/* IMAGE LAYER PROPERTIES (BG REMOVAL, BRIGHTNESS, CONTRAST, CROP) */}
                {primarySelectedLayer.type === 'image' && (
                  <div className="space-y-2.5 pt-2 border-t border-slate-800">
                    <button
                      type="button"
                      onClick={() =>
                        updateSelectedLayer(
                          { removeLightBg: !primarySelectedLayer.removeLightBg },
                          true
                        )
                      }
                      className={`w-full py-2 px-3 rounded-xl font-bold text-[11px] flex items-center justify-center gap-1.5 cursor-pointer ${
                        primarySelectedLayer.removeLightBg
                          ? 'bg-emerald-500 text-slate-950'
                          : 'bg-slate-800 hover:bg-slate-700 text-amber-300 border border-slate-700'
                      }`}
                    >
                      <Eraser className="w-3.5 h-3.5" />
                      <span>
                        {primarySelectedLayer.removeLightBg
                          ? 'Light Background Removed (On)'
                          : 'Remove White / Light Background'}
                      </span>
                    </button>

                    {primarySelectedLayer.removeLightBg && (
                      <div>
                        <label className="text-[10px] text-slate-400">
                          Cutout Sensitivity ({primarySelectedLayer.bgRemovalTolerance ?? 36})
                        </label>
                        <input
                          type="range"
                          min={12}
                          max={76}
                          value={primarySelectedLayer.bgRemovalTolerance ?? 36}
                          onChange={e =>
                            updateSelectedLayer({ bgRemovalTolerance: Number(e.target.value) })
                          }
                          className="w-full"
                        />
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[10px] text-slate-400">
                          Brightness ({primarySelectedLayer.brightness ?? 100}%)
                        </label>
                        <input
                          type="range"
                          min={60}
                          max={145}
                          value={primarySelectedLayer.brightness ?? 100}
                          onChange={e =>
                            updateSelectedLayer({ brightness: Number(e.target.value) })
                          }
                          className="w-full"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-slate-400">
                          Contrast ({primarySelectedLayer.contrast ?? 100}%)
                        </label>
                        <input
                          type="range"
                          min={60}
                          max={150}
                          value={primarySelectedLayer.contrast ?? 100}
                          onChange={e =>
                            updateSelectedLayer({ contrast: Number(e.target.value) })
                          }
                          className="w-full"
                        />
                      </div>
                    </div>

                    <div className="p-2 rounded-lg bg-slate-900 border border-slate-800 space-y-1.5">
                      <div className="flex items-center justify-between text-[10px] font-bold text-slate-300">
                        <span className="inline-flex items-center gap-1">
                          <Crop className="w-3 h-3 text-cyan-400" /> Crop Window
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            updateSelectedLayer({ cropX: 0, cropY: 0, cropW: 1, cropH: 1 }, true)
                          }
                          className="text-cyan-400 hover:underline cursor-pointer"
                        >
                          Reset
                        </button>
                      </div>
                      <div className="grid grid-cols-2 gap-1.5 text-[10px] text-slate-400">
                        <label>
                          Left {Math.round((primarySelectedLayer.cropX ?? 0) * 100)}%
                          <input
                            type="range"
                            min={0}
                            max={60}
                            value={Math.round((primarySelectedLayer.cropX ?? 0) * 100)}
                            onChange={e =>
                              updateSelectedLayer({ cropX: Number(e.target.value) / 100 })
                            }
                            className="w-full"
                          />
                        </label>
                        <label>
                          Top {Math.round((primarySelectedLayer.cropY ?? 0) * 100)}%
                          <input
                            type="range"
                            min={0}
                            max={60}
                            value={Math.round((primarySelectedLayer.cropY ?? 0) * 100)}
                            onChange={e =>
                              updateSelectedLayer({ cropY: Number(e.target.value) / 100 })
                            }
                            className="w-full"
                          />
                        </label>
                        <label>
                          Width {Math.round((primarySelectedLayer.cropW ?? 1) * 100)}%
                          <input
                            type="range"
                            min={25}
                            max={100}
                            value={Math.round((primarySelectedLayer.cropW ?? 1) * 100)}
                            onChange={e =>
                              updateSelectedLayer({ cropW: Number(e.target.value) / 100 })
                            }
                            className="w-full"
                          />
                        </label>
                        <label>
                          Height {Math.round((primarySelectedLayer.cropH ?? 1) * 100)}%
                          <input
                            type="range"
                            min={25}
                            max={100}
                            value={Math.round((primarySelectedLayer.cropH ?? 1) * 100)}
                            onChange={e =>
                              updateSelectedLayer({ cropH: Number(e.target.value) / 100 })
                            }
                            className="w-full"
                          />
                        </label>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[10px] text-slate-400">Fit Mode</label>
                        <select
                          value={primarySelectedLayer.fit}
                          onChange={e =>
                            updateSelectedLayer({ fit: e.target.value as 'contain' | 'cover' })
                          }
                          className="w-full p-1.5 rounded bg-slate-900 border border-slate-700"
                        >
                          <option value="contain">Contain</option>
                          <option value="cover">Cover Fill</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-[10px] text-slate-400">Corner Radius</label>
                        <input
                          type="number"
                          min={0}
                          max={200}
                          value={primarySelectedLayer.borderRadius || 0}
                          onChange={e =>
                            updateSelectedLayer({
                              borderRadius: Math.max(0, Number(e.target.value) || 0),
                            })
                          }
                          className="w-full p-1.5 rounded bg-slate-900 border border-slate-700 font-mono-num"
                        />
                      </div>
                    </div>
                  </div>
                )}

                {/* SHAPE / BADGE / STICKER PROPERTIES */}
                {(primarySelectedLayer.type === 'shape' ||
                  primarySelectedLayer.type === 'badge' ||
                  primarySelectedLayer.type === 'sticker') && (
                  <div className="space-y-2.5 pt-2 border-t border-slate-800">
                    {primarySelectedLayer.type === 'badge' && (
                      <>
                        <div>
                          <label className="text-[10px] text-slate-400">Primary Badge Text</label>
                          <input
                            type="text"
                            value={primarySelectedLayer.primaryText}
                            onChange={e => updateSelectedLayer({ primaryText: e.target.value })}
                            className="w-full p-1.5 rounded bg-slate-900 border border-slate-700"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] text-slate-400">Secondary Badge Text</label>
                          <input
                            type="text"
                            value={primarySelectedLayer.secondaryText || ''}
                            onChange={e => updateSelectedLayer({ secondaryText: e.target.value })}
                            className="w-full p-1.5 rounded bg-slate-900 border border-slate-700"
                          />
                        </div>
                      </>
                    )}
                    {primarySelectedLayer.type === 'sticker' &&
                      primarySelectedLayer.stickerKind === 'quality_seal' && (
                        <div>
                          <label className="text-[10px] text-slate-400">Sticker Label</label>
                          <input
                            type="text"
                            value={primarySelectedLayer.label || ''}
                            onChange={e => updateSelectedLayer({ label: e.target.value })}
                            className="w-full p-1.5 rounded bg-slate-900 border border-slate-700"
                          />
                        </div>
                      )}

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[10px] text-slate-400">Fill Color</label>
                        <input
                          type="color"
                          value={primarySelectedLayer.fillColor}
                          onChange={e => updateSelectedLayer({ fillColor: e.target.value })}
                          className="w-full h-8 rounded bg-slate-900 border border-slate-700 cursor-pointer"
                        />
                      </div>
                      {primarySelectedLayer.type === 'badge' ? (
                        <div>
                          <label className="text-[10px] text-slate-400">Text Color</label>
                          <input
                            type="color"
                            value={primarySelectedLayer.textColor}
                            onChange={e => updateSelectedLayer({ textColor: e.target.value })}
                            className="w-full h-8 rounded bg-slate-900 border border-slate-700 cursor-pointer"
                          />
                        </div>
                      ) : (
                        <div>
                          <label className="text-[10px] text-slate-400">Border Color</label>
                          <input
                            type="color"
                            value={primarySelectedLayer.borderColor || '#FFD21F'}
                            onChange={e => updateSelectedLayer({ borderColor: e.target.value })}
                            className="w-full h-8 rounded bg-slate-900 border border-slate-700 cursor-pointer"
                          />
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* QR PROPERTIES */}
                {primarySelectedLayer.type === 'qr' && (
                  <div className="space-y-2 pt-2 border-t border-slate-800">
                    <label className="text-[10px] text-slate-400">QR Target URL</label>
                    <input
                      type="url"
                      value={primarySelectedLayer.qrValue}
                      onChange={e => updateSelectedLayer({ qrValue: e.target.value })}
                      className="w-full p-1.5 rounded bg-slate-900 border border-slate-700 text-[11px]"
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* SAVE CUSTOM REUSABLE TEMPLATE MODAL */}
      {showSaveTplModal && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/70 p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-sm w-full p-5 space-y-4 text-xs">
            <h4 className="text-sm font-bold text-white">Save Custom Design as Reusable Template</h4>
            <div>
              <label className="block text-[11px] text-slate-300 mb-1">Template Name</label>
              <input
                type="text"
                value={tplName}
                onChange={e => setTplName(e.target.value)}
                className="w-full p-2 rounded-lg bg-slate-950 border border-slate-700 text-white"
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-300 mb-1">Category Tag</label>
              <input
                type="text"
                value={tplCategory}
                onChange={e => setTplCategory(e.target.value)}
                className="w-full p-2 rounded-lg bg-slate-950 border border-slate-700 text-white"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setShowSaveTplModal(false)}
                className="px-3 py-1.5 rounded-lg bg-slate-800 text-slate-300 font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  onSaveAsTemplate(tplName.trim() || 'Custom Combo Template', tplCategory.trim() || 'Custom');
                  setShowSaveTplModal(false);
                }}
                className="px-4 py-1.5 rounded-lg bg-amber-400 text-slate-950 font-extrabold cursor-pointer"
              >
                Save Template
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
