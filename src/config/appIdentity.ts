import { Branch, ShopSettings } from '../types';

/**
 * Permanent Software / Application Identity.
 * Must NEVER be overwritten by shop/business settings.
 */
export const APP_IDENTITY = Object.freeze({
  name: 'PROTIVA',
  subtitle: 'Innovation Beyond Limits.',
  fullTitle: 'PROTIVA - Innovation Beyond Limits.',
  shortName: 'PROTIVA',
  logoPath: '/protiva-logo.png',
  symbolPath: '/protiva-symbol.png',
} as const);

export interface ResolvedBusinessProfile {
  shopName: string;
  tagline: string;
  address: string;
  mobile: string;
  email: string;
  logoUrl: string;
  websiteUrl: string;
  marketplaceUrl: string;
  socialMedia: string;
  vatTaxRate: number;
  vatRegistrationNo: string;
  branchName: string;
}

/**
 * Returns the editable business/shop display name without ever falling back
 * to the software application name ("PROTIVA").
 */
export function getBusinessDisplayName(
  settings?: Partial<ShopSettings> | null,
  fallback = 'My Shop'
): string {
  const trimmed = settings?.shopName?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : fallback;
}

/**
 * Resolves business profile fields for the currently active shop & branch.
 * Keeps application identity strictly separate from business identity.
 */
export function resolveBusinessProfile(
  settings?: Partial<ShopSettings> | null,
  activeBranch?: Branch | null
): ResolvedBusinessProfile {
  const isSecondaryBranch = Boolean(activeBranch && !activeBranch.isMain);

  const address = isSecondaryBranch && activeBranch?.location?.trim()
    ? activeBranch.location.trim()
    : settings?.address?.trim() || activeBranch?.location?.trim() || '';

  const mobile = isSecondaryBranch && activeBranch?.mobile?.trim()
    ? activeBranch.mobile.trim()
    : settings?.mobile?.trim() || activeBranch?.mobile?.trim() || '';

  return {
    shopName: getBusinessDisplayName(settings, 'My Shop'),
    tagline: settings?.tagline?.trim() || '',
    address,
    mobile,
    email: settings?.email?.trim() || '',
    logoUrl: settings?.logoUrl?.trim() || '',
    websiteUrl: settings?.websiteUrl?.trim() || '',
    marketplaceUrl: settings?.marketplaceUrl?.trim() || '',
    socialMedia: settings?.socialMedia?.trim() || '',
    vatTaxRate: Number(settings?.vatTaxRate || 0),
    vatRegistrationNo: settings?.vatRegistrationNo?.trim() || '',
    branchName: activeBranch?.name?.trim() || '',
  };
}
