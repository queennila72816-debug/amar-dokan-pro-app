import maleModelUrl from '../assets/images/model_male_fashion_1795709005379.jpg';
import femaleModelUrl from '../assets/images/model_female_fashion_1795709004746.jpg';
import coupleModelUrl from '../assets/images/model_couple_fashion_1795709006288.jpg';
import familyModelUrl from '../assets/images/model_family_fashion_1795709007660.jpg';
import boyModelUrl from '../assets/images/model_boy_fashion_1795709008177.jpg';
import girlModelUrl from '../assets/images/model_girl_fashion_1795709007046.jpg';
import { ComboOffer, PosterModelCategory } from '../types';

export interface PosterModelPreset {
  id: Exclude<PosterModelCategory, 'auto' | 'none'>;
  label: string;
  shortLabel: string;
  description: string;
  imageUrl: string;
}

export const POSTER_MODEL_PRESETS: PosterModelPreset[] = [
  {
    id: 'male',
    label: 'Male Model',
    shortLabel: 'Male',
    description: "Men's smart casual & formal lookbook showcase",
    imageUrl: maleModelUrl,
  },
  {
    id: 'female',
    label: 'Female Model',
    shortLabel: 'Female',
    description: "Women's boutique & ethnic lifestyle showcase",
    imageUrl: femaleModelUrl,
  },
  {
    id: 'couple',
    label: 'Couple Models',
    shortLabel: 'Couple',
    description: 'Coordinated festive or paired fashion duo',
    imageUrl: coupleModelUrl,
  },
  {
    id: 'family',
    label: 'Family Models',
    shortLabel: 'Family',
    description: 'Complete family value pack & Eid/festive set',
    imageUrl: familyModelUrl,
  },
  {
    id: 'boys',
    label: 'Boys Model',
    shortLabel: 'Boys',
    description: "Boys' casual fashion & junior combo look",
    imageUrl: boyModelUrl,
  },
  {
    id: 'girls',
    label: 'Girls Model',
    shortLabel: 'Girls',
    description: "Girls' boutique dress & kids festive set",
    imageUrl: girlModelUrl,
  },
];

export type ResolvedModelPersona = Exclude<PosterModelCategory, 'auto' | 'none'>;

export function inferComboModelCategory(
  offer: Pick<ComboOffer, 'name' | 'comboCategory' | 'description'>,
  items: Array<{ productName?: string; category?: string; variantDetails?: string }>
): ResolvedModelPersona {
  const combined = [
    offer.name || '',
    offer.comboCategory || '',
    offer.description || '',
    ...items.map(it => `${it.productName || ''} ${it.category || ''} ${it.variantDetails || ''}`),
  ]
    .join(' ')
    .toLowerCase();

  const hasAny = (words: string[]) => words.some(w => combined.includes(w));

  if (hasAny(['family', 'parents', 'household', 'eid family', 'all member'])) return 'family';
  if (hasAny(['couple', 'his & hers', 'his and hers', 'husband', 'wife', 'bridal', 'duo set'])) {
    return 'couple';
  }
  if (hasAny(['girl', 'girls', 'frock', 'baby girl', 'junior girl', 'princess'])) return 'girls';
  if (hasAny(['boy', 'boys', 'baby boy', 'junior boy'])) return 'boys';

  const hasWomenCues = hasAny([
    'women',
    'woman',
    'ladies',
    'female',
    'three-piece',
    'three piece',
    'burqa',
    'hijab',
    'saree',
    'kurti',
    'abaya',
    'lehenga',
    'salwar',
    'lipstick',
    'cosmetic',
    'handbag',
  ]);
  const hasMenCues = hasAny([
    "men's",
    'mens',
    'men ',
    'male',
    'gents',
    'panjabi',
    'chino',
    'polo',
    'formal shirt',
    'denim jacket',
    'wallet',
    'belt',
    'trouser',
  ]);

  if (hasWomenCues && hasMenCues) return 'couple';
  if (hasWomenCues) return 'female';
  if (hasAny(['kid', 'kids', 'child', 'toddler', 'junior'])) return 'boys';
  return 'male';
}

export function resolveModelAssetSelection(params: {
  modelCategory?: PosterModelCategory;
  customModelImageUrl?: string;
  aiGeneratedModelUrl?: string;
  offer: Pick<ComboOffer, 'name' | 'comboCategory' | 'description'>;
  items: Array<{ productName?: string; category?: string; variantDetails?: string }>;
}): {
  persona: PosterModelCategory;
  effectivePersona: ResolvedModelPersona | 'custom' | 'none';
  imageUrl: string | null;
  label: string;
} {
  if (params.modelCategory === 'none') {
    return { persona: 'none', effectivePersona: 'none', imageUrl: null, label: 'No Model' };
  }
  if (params.aiGeneratedModelUrl?.trim()) {
    return {
      persona: params.modelCategory || 'auto',
      effectivePersona: 'custom',
      imageUrl: params.aiGeneratedModelUrl.trim(),
      label: 'AI Generated Model',
    };
  }
  if (params.customModelImageUrl?.trim()) {
    return {
      persona: params.modelCategory || 'auto',
      effectivePersona: 'custom',
      imageUrl: params.customModelImageUrl.trim(),
      label: 'Uploaded Custom Model',
    };
  }

  const chosenPersona: ResolvedModelPersona =
    params.modelCategory && params.modelCategory !== 'auto'
      ? params.modelCategory
      : inferComboModelCategory(params.offer, params.items);

  const preset = POSTER_MODEL_PRESETS.find(p => p.id === chosenPersona) || POSTER_MODEL_PRESETS[0];
  return {
    persona: params.modelCategory || 'auto',
    effectivePersona: chosenPersona,
    imageUrl: preset.imageUrl,
    label: preset.label,
  };
}

export {
  loadRawImageElement,
  loadProcessedLayerImage,
  removeLightBackgroundToDataUrl,
} from './posterCanvasEffects';
