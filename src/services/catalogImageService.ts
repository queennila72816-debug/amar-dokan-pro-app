import { supabase, isSupabaseConfigured, isValidUuid } from '../lib/supabase';
import { ProductColor, ProductColorImage } from '../types';
import { inferColorHex, normalizeColorKey, sortColorImages } from '../utils/productImageResolver';

export const PRODUCT_IMAGES_BUCKET = 'product-images';
export const MAX_IMAGE_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB
export const ALLOWED_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
const ALLOWED_IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp'];

export interface ImageValidationResult {
  valid: boolean;
  error?: string;
  extension?: 'jpg' | 'png' | 'webp';
  mimeType?: 'image/jpeg' | 'image/png' | 'image/webp';
}

export function validateImageFile(file: File): ImageValidationResult {
  if (!file) {
    return { valid: false, error: 'No image file selected.' };
  }

  const ext = (file.name.split('.').pop() || '').toLowerCase();
  const mime = (file.type || '').toLowerCase();

  const validExt = ALLOWED_IMAGE_EXTENSIONS.includes(ext);
  const validMime = (ALLOWED_IMAGE_MIME_TYPES as readonly string[]).includes(mime);

  if (!validMime && !validExt) {
    return {
      valid: false,
      error: `Unsupported format "${file.name}". Allowed: JPG, JPEG, PNG, WEBP.`,
    };
  }

  let normalizedMime: 'image/jpeg' | 'image/png' | 'image/webp' = 'image/jpeg';
  let normalizedExt: 'jpg' | 'png' | 'webp' = 'jpg';

  if (mime === 'image/png' || ext === 'png') {
    normalizedMime = 'image/png';
    normalizedExt = 'png';
  } else if (mime === 'image/webp' || ext === 'webp') {
    normalizedMime = 'image/webp';
    normalizedExt = 'webp';
  } else if (mime === 'image/jpeg' || ext === 'jpg' || ext === 'jpeg') {
    normalizedMime = 'image/jpeg';
    normalizedExt = 'jpg';
  } else {
    return {
      valid: false,
      error: `Unsupported file type for "${file.name}". Allowed: JPG, JPEG, PNG, WEBP.`,
    };
  }

  if (file.size <= 0) {
    return { valid: false, error: `"${file.name}" is empty (0 bytes).` };
  }

  if (file.size > MAX_IMAGE_FILE_SIZE_BYTES) {
    const sizeMb = (file.size / (1024 * 1024)).toFixed(2);
    return {
      valid: false,
      error: `"${file.name}" is ${sizeMb} MB. Maximum allowed image size is 5 MB.`,
    };
  }

  return {
    valid: true,
    extension: normalizedExt,
    mimeType: normalizedMime,
  };
}

export function mapDbProductColor(row: any): ProductColor {
  return {
    id: row.id,
    businessId: row.business_id,
    productId: row.product_id,
    colorName: row.color_name,
    normalizedName: row.normalized_name || normalizeColorKey(row.color_name),
    colorHex: inferColorHex(row.color_name, row.color_hex),
    sortOrder: Number(row.sort_order || 0),
    isActive: row.is_active !== false,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapDbProductImage(row: any): ProductColorImage {
  return {
    id: row.id,
    businessId: row.business_id,
    productId: row.product_id,
    colorId: row.color_id,
    imageUrl: row.image_url,
    storagePath: row.storage_path,
    fileName: row.file_name || undefined,
    fileSize: row.file_size != null ? Number(row.file_size) : undefined,
    mimeType: row.mime_type || undefined,
    isPrimary: Boolean(row.is_primary),
    sortOrder: Number(row.sort_order || 0),
    uploadedBy: row.uploaded_by || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function getSupabaseRestConfig(): { url: string; anonKey: string } {
  const url = String(import.meta.env.VITE_SUPABASE_URL || '')
    .trim()
    .replace(/\/rest\/v1\/?$/, '')
    .replace(/\/+$/, '');
  const anonKey = String(import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim();
  return { url, anonKey };
}

function isMissingSchemaTableError(err: any): boolean {
  const code = String(err?.code || '');
  const msg = String(err?.message || '').toLowerCase();
  return (
    code === '42P01' ||
    code === 'PGRST205' ||
    msg.includes('could not find the table') ||
    (msg.includes('relation') && msg.includes('does not exist'))
  );
}

function xhrUpload(
  endpoint: string,
  file: File,
  headers: Record<string, string>,
  onProgress?: (pct: number) => void,
  method: 'POST' | 'PUT' = 'POST'
): Promise<{ status: number; responseText: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, endpoint, true);
    Object.entries(headers).forEach(([k, v]) => xhr.setRequestHeader(k, v));

    xhr.upload.onprogress = evt => {
      if (evt.lengthComputable && onProgress) {
        const pct = Math.min(92, Math.max(5, Math.round((evt.loaded / evt.total) * 90)));
        onProgress(pct);
      }
    };

    xhr.onload = () => {
      resolve({ status: xhr.status, responseText: xhr.responseText || '' });
    };

    xhr.onerror = () => {
      reject(new Error('Network error while uploading image to cloud storage.'));
    };

    xhr.ontimeout = () => {
      reject(new Error('Image upload timed out. Please try again.'));
    };

    xhr.timeout = 60000;
    xhr.send(file);
  });
}

async function uploadFileToStorage(params: {
  businessId: string;
  storagePath: string;
  file: File;
  mimeType: string;
  onProgress?: (pct: number) => void;
}): Promise<{ publicUrl: string; storagePath: string }> {
  const { businessId, storagePath, file, mimeType, onProgress } = params;
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const accessToken = session?.access_token;
  if (!accessToken) {
    throw new Error('Your session has expired. Please log in again before uploading images.');
  }

  const { url: supabaseUrl, anonKey } = getSupabaseRestConfig();
  const encodedPath = storagePath
    .split('/')
    .map(seg => encodeURIComponent(seg))
    .join('/');

  const tryDirectStorageXhr = async () => {
    if (!supabaseUrl || !anonKey) {
      throw new Error('Supabase configuration is incomplete.');
    }
    const endpoint = `${supabaseUrl}/storage/v1/object/${PRODUCT_IMAGES_BUCKET}/${encodedPath}`;
    return xhrUpload(
      endpoint,
      file,
      {
        Authorization: `Bearer ${accessToken}`,
        apikey: anonKey,
        'Content-Type': mimeType,
        'x-upsert': 'true',
        'cache-control': '3600',
      },
      onProgress,
      'POST'
    );
  };

  let res = await tryDirectStorageXhr();

  if (res.status >= 200 && res.status < 300) {
    const { data: pub } = supabase.storage.from(PRODUCT_IMAGES_BUCKET).getPublicUrl(storagePath);
    return { publicUrl: pub.publicUrl, storagePath };
  }

  // Attempt automatic bucket provisioning + server-assisted storage upload if direct RLS/bucket failed
  let ensureAttempted = false;
  try {
    const ensureResp = await fetch('/api/catalog/ensure-bucket', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ businessId }),
    });
    if (ensureResp.ok) {
      ensureAttempted = true;
      res = await tryDirectStorageXhr();
      if (res.status >= 200 && res.status < 300) {
        const { data: pub } = supabase.storage.from(PRODUCT_IMAGES_BUCKET).getPublicUrl(storagePath);
        return { publicUrl: pub.publicUrl, storagePath };
      }
    }
  } catch {
    // Ignore and evaluate fallback below
  }

  // Fallback through Express storage upload route (still stores only in Supabase Storage, never DB)
  try {
    const fallbackRes = await xhrUpload(
      '/api/catalog/upload-image',
      file,
      {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': mimeType,
        'x-business-id': businessId,
        'x-storage-path': storagePath,
        'x-file-mime': mimeType,
      },
      onProgress,
      'POST'
    );

    if (fallbackRes.status >= 200 && fallbackRes.status < 300) {
      const parsed = JSON.parse(fallbackRes.responseText || '{}');
      if (parsed.publicUrl) {
        return {
          publicUrl: parsed.publicUrl,
          storagePath: parsed.storagePath || storagePath,
        };
      }
    } else if (fallbackRes.responseText) {
      try {
        const parsedErr = JSON.parse(fallbackRes.responseText);
        if (parsedErr.error && fallbackRes.status !== 501) {
          throw new Error(parsedErr.error);
        }
      } catch (e: any) {
        if (e instanceof Error && e.message && !e.message.startsWith('Unexpected')) {
          throw e;
        }
      }
    }
  } catch (fallbackErr: any) {
    if (
      fallbackErr instanceof Error &&
      !fallbackErr.message.includes('Network error') &&
      !fallbackErr.message.includes('501')
    ) {
      throw fallbackErr;
    }
  }

  let detail = '';
  try {
    const parsed = JSON.parse(res.responseText || '{}');
    detail = parsed.message || parsed.error || '';
  } catch {
    detail = res.responseText || '';
  }

  throw new Error(
    detail ||
      (ensureAttempted
        ? 'Cloud storage upload was rejected by storage permissions.'
        : 'Storage bucket "product-images" is missing. Please run migration 20261123_apparel_photo_catalog_colors_and_images.sql in Supabase SQL Editor.')
  );
}

async function removeStorageObjectSafely(businessId: string, storagePath?: string | null) {
  if (!storagePath) return;
  try {
    const { error } = await supabase.storage.from(PRODUCT_IMAGES_BUCKET).remove([storagePath]);
    if (!error) return;
  } catch {
    // Fallback below
  }

  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.access_token) return;
    await fetch('/api/catalog/delete-storage-object', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ businessId, storagePath }),
    });
  } catch {
    // Non-blocking storage cleanup
  }
}

export const catalogImageService = {
  async fetchCatalogMedia(businessId: string): Promise<{
    colors: ProductColor[];
    images: ProductColorImage[];
    schemaReady: boolean;
  }> {
    if (!isSupabaseConfigured || !isValidUuid(businessId)) {
      return { colors: [], images: [], schemaReady: true };
    }

    const [colorsRes, imagesRes] = await Promise.all([
      supabase
        .from('product_colors')
        .select('*')
        .eq('business_id', businessId)
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true }),
      supabase
        .from('product_images')
        .select('*')
        .eq('business_id', businessId)
        .order('is_primary', { ascending: false })
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true }),
    ]);

    if (colorsRes.error && isMissingSchemaTableError(colorsRes.error)) {
      return { colors: [], images: [], schemaReady: false };
    }
    if (imagesRes.error && isMissingSchemaTableError(imagesRes.error)) {
      return { colors: [], images: [], schemaReady: false };
    }

    if (colorsRes.error) throw colorsRes.error;
    if (imagesRes.error) throw imagesRes.error;

    return {
      colors: (colorsRes.data || []).map(mapDbProductColor),
      images: sortColorImages((imagesRes.data || []).map(mapDbProductImage)),
      schemaReady: true,
    };
  },

  async ensureProductColor(params: {
    businessId: string;
    productId: string;
    colorName: string;
    colorHex?: string;
  }): Promise<ProductColor> {
    const { businessId, productId, colorName, colorHex } = params;
    const cleanName = colorName.trim();
    const norm = normalizeColorKey(cleanName);
    if (!cleanName || !norm) {
      throw new Error('Color name is required.');
    }

    const resolvedHex = inferColorHex(cleanName, colorHex);

    const { data: existing, error: findErr } = await supabase
      .from('product_colors')
      .select('*')
      .eq('product_id', productId)
      .eq('normalized_name', norm)
      .maybeSingle();

    if (findErr) {
      if (isMissingSchemaTableError(findErr)) {
        throw new Error(
          'Catalog database tables not found. Please apply migration 20261123_apparel_photo_catalog_colors_and_images.sql in Supabase first.'
        );
      }
      throw findErr;
    }

    if (existing) {
      // Link any unlinked matching variants cleanly
      await supabase
        .from('product_variants')
        .update({ color_id: existing.id })
        .eq('product_id', productId)
        .is('color_id', null)
        .ilike('color', cleanName);

      return mapDbProductColor(existing);
    }

    const { count } = await supabase
      .from('product_colors')
      .select('id', { count: 'exact', head: true })
      .eq('product_id', productId);

    const { data: inserted, error: insErr } = await supabase
      .from('product_colors')
      .insert({
        business_id: businessId,
        product_id: productId,
        color_name: cleanName,
        normalized_name: norm,
        color_hex: resolvedHex,
        sort_order: Number(count || 0),
        is_active: true,
      })
      .select('*')
      .single();

    if (insErr) {
      // Handle race condition on unique index cleanly
      if (insErr.code === '23505') {
        const { data: raced } = await supabase
          .from('product_colors')
          .select('*')
          .eq('product_id', productId)
          .eq('normalized_name', norm)
          .single();
        if (raced) return mapDbProductColor(raced);
      }
      throw insErr;
    }

    // Link existing variants matching this color name
    await supabase
      .from('product_variants')
      .update({ color_id: inserted.id, color_hex: resolvedHex })
      .eq('product_id', productId)
      .ilike('color', cleanName);

    return mapDbProductColor(inserted);
  },

  async updateProductColor(params: {
    businessId: string;
    productId: string;
    colorId: string;
    colorName: string;
    colorHex?: string;
  }): Promise<ProductColor> {
    const { businessId, productId, colorId, colorName, colorHex } = params;
    const cleanName = colorName.trim();
    const norm = normalizeColorKey(cleanName);
    if (!cleanName || !norm) {
      throw new Error('Color name cannot be empty.');
    }

    const resolvedHex = inferColorHex(cleanName, colorHex);

    const { data, error } = await supabase
      .from('product_colors')
      .update({
        color_name: cleanName,
        normalized_name: norm,
        color_hex: resolvedHex,
        updated_at: new Date().toISOString(),
      })
      .eq('id', colorId)
      .eq('business_id', businessId)
      .eq('product_id', productId)
      .select('*')
      .single();

    if (error) {
      if (error.code === '23505') {
        throw new Error(`Color "${cleanName}" already exists for this product.`);
      }
      throw error;
    }

    // Synchronize variant labels while keeping the permanent color_id intact
    await supabase
      .from('product_variants')
      .update({
        color: cleanName,
        color_hex: resolvedHex,
        updated_at: new Date().toISOString(),
      })
      .eq('product_id', productId)
      .eq('color_id', colorId);

    return mapDbProductColor(data);
  },

  async deleteProductColor(params: {
    businessId: string;
    productId: string;
    colorId: string;
  }): Promise<void> {
    const { businessId, productId, colorId } = params;
    const { data: imgs } = await supabase
      .from('product_images')
      .select('storage_path')
      .eq('business_id', businessId)
      .eq('product_id', productId)
      .eq('color_id', colorId);

    const { error } = await supabase
      .from('product_colors')
      .delete()
      .eq('id', colorId)
      .eq('business_id', businessId)
      .eq('product_id', productId);

    if (error) throw error;

    await Promise.all((imgs || []).map(i => removeStorageObjectSafely(businessId, i.storage_path)));
  },

  async uploadColorImage(params: {
    businessId: string;
    productId: string;
    colorId: string;
    file: File;
    makePrimary?: boolean;
    onProgress?: (pct: number) => void;
  }): Promise<ProductColorImage> {
    const { businessId, productId, colorId, file, makePrimary, onProgress } = params;
    const validation = validateImageFile(file);
    if (!validation.valid || !validation.extension || !validation.mimeType) {
      throw new Error(validation.error || 'Invalid image file.');
    }

    onProgress?.(3);

    const uniqueName = `${crypto.randomUUID()}.${validation.extension}`;
    const storagePath = `${businessId}/${productId}/${colorId}/${uniqueName}`;

    const uploaded = await uploadFileToStorage({
      businessId,
      storagePath,
      file,
      mimeType: validation.mimeType,
      onProgress,
    });

    onProgress?.(94);

    // Inspect existing images for this color to determine primary + next sort order
    const { data: existingImgs, error: listErr } = await supabase
      .from('product_images')
      .select('id, is_primary, sort_order')
      .eq('business_id', businessId)
      .eq('product_id', productId)
      .eq('color_id', colorId)
      .order('sort_order', { ascending: true });

    if (listErr) {
      await removeStorageObjectSafely(businessId, uploaded.storagePath);
      throw listErr;
    }

    const existingList = existingImgs || [];
    const hasExistingPrimary = existingList.some(i => i.is_primary);
    const shouldBePrimary = Boolean(makePrimary || existingList.length === 0 || !hasExistingPrimary);
    const nextSortOrder =
      existingList.length === 0
        ? 0
        : Math.max(...existingList.map(i => Number(i.sort_order || 0))) + 1;

    if (shouldBePrimary && hasExistingPrimary) {
      await supabase
        .from('product_images')
        .update({ is_primary: false, updated_at: new Date().toISOString() })
        .eq('business_id', businessId)
        .eq('product_id', productId)
        .eq('color_id', colorId)
        .eq('is_primary', true);
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();

    const { data: inserted, error: insErr } = await supabase
      .from('product_images')
      .insert({
        business_id: businessId,
        product_id: productId,
        color_id: colorId,
        image_url: uploaded.publicUrl,
        storage_path: uploaded.storagePath,
        file_name: file.name,
        file_size: file.size,
        mime_type: validation.mimeType,
        is_primary: shouldBePrimary,
        sort_order: nextSortOrder,
        uploaded_by: user?.id || null,
      })
      .select('*')
      .single();

    if (insErr) {
      await removeStorageObjectSafely(businessId, uploaded.storagePath);
      throw insErr;
    }

    // Populate fallback image_url on products if currently blank
    await supabase
      .from('products')
      .update({ image_url: uploaded.publicUrl, updated_at: new Date().toISOString() })
      .eq('id', productId)
      .eq('business_id', businessId)
      .or('image_url.is.null,image_url.eq.');

    onProgress?.(100);
    return mapDbProductImage(inserted);
  },

  async replaceColorImage(params: {
    businessId: string;
    productId: string;
    image: ProductColorImage;
    file: File;
    onProgress?: (pct: number) => void;
  }): Promise<ProductColorImage> {
    const { businessId, productId, image, file, onProgress } = params;
    const validation = validateImageFile(file);
    if (!validation.valid || !validation.extension || !validation.mimeType) {
      throw new Error(validation.error || 'Invalid image file.');
    }

    onProgress?.(4);
    const newPath = `${businessId}/${productId}/${image.colorId}/${crypto.randomUUID()}.${validation.extension}`;

    const uploaded = await uploadFileToStorage({
      businessId,
      storagePath: newPath,
      file,
      mimeType: validation.mimeType,
      onProgress,
    });

    onProgress?.(95);

    const { data: updated, error } = await supabase
      .from('product_images')
      .update({
        image_url: uploaded.publicUrl,
        storage_path: uploaded.storagePath,
        file_name: file.name,
        file_size: file.size,
        mime_type: validation.mimeType,
        updated_at: new Date().toISOString(),
      })
      .eq('id', image.id)
      .eq('business_id', businessId)
      .eq('product_id', productId)
      .select('*')
      .single();

    if (error) {
      await removeStorageObjectSafely(businessId, uploaded.storagePath);
      throw error;
    }

    // Sync products.image_url if it pointed to the replaced image URL
    await supabase
      .from('products')
      .update({ image_url: uploaded.publicUrl, updated_at: new Date().toISOString() })
      .eq('id', productId)
      .eq('business_id', businessId)
      .eq('image_url', image.imageUrl);

    if (image.storagePath && image.storagePath !== uploaded.storagePath) {
      await removeStorageObjectSafely(businessId, image.storagePath);
    }

    onProgress?.(100);
    return mapDbProductImage(updated);
  },

  async setPrimaryColorImage(params: {
    businessId: string;
    productId: string;
    colorId: string;
    imageId: string;
  }): Promise<void> {
    const { businessId, productId, colorId, imageId } = params;
    const { error } = await supabase.rpc('set_primary_product_color_image', {
      p_business_id: businessId,
      p_product_id: productId,
      p_color_id: colorId,
      p_image_id: imageId,
    });

    if (!error) return;

    // Fallback sequential update if RPC isn't present yet
    await supabase
      .from('product_images')
      .update({ is_primary: false, updated_at: new Date().toISOString() })
      .eq('business_id', businessId)
      .eq('product_id', productId)
      .eq('color_id', colorId)
      .eq('is_primary', true)
      .neq('id', imageId);

    const { error: updErr } = await supabase
      .from('product_images')
      .update({ is_primary: true, updated_at: new Date().toISOString() })
      .eq('id', imageId)
      .eq('business_id', businessId)
      .eq('product_id', productId)
      .eq('color_id', colorId);

    if (updErr) throw updErr;
  },

  async reorderColorImages(params: {
    businessId: string;
    productId: string;
    colorId: string;
    orderedImageIds: string[];
  }): Promise<void> {
    const { businessId, productId, colorId, orderedImageIds } = params;
    const { error } = await supabase.rpc('reorder_product_color_images', {
      p_business_id: businessId,
      p_product_id: productId,
      p_color_id: colorId,
      p_image_ids: orderedImageIds,
    });

    if (!error) return;

    await Promise.all(
      orderedImageIds.map((id, idx) =>
        supabase
          .from('product_images')
          .update({ sort_order: idx, updated_at: new Date().toISOString() })
          .eq('id', id)
          .eq('business_id', businessId)
          .eq('product_id', productId)
          .eq('color_id', colorId)
      )
    );
  },

  async reassignImageColor(params: {
    businessId: string;
    productId: string;
    imageId: string;
    targetColorId: string;
  }): Promise<ProductColorImage> {
    const { businessId, productId, imageId, targetColorId } = params;
    const { data: targetImgs } = await supabase
      .from('product_images')
      .select('id, is_primary, sort_order')
      .eq('business_id', businessId)
      .eq('product_id', productId)
      .eq('color_id', targetColorId);

    const existingList = targetImgs || [];
    const targetHasPrimary = existingList.some(i => i.is_primary);
    const nextSort =
      existingList.length === 0
        ? 0
        : Math.max(...existingList.map(i => Number(i.sort_order || 0))) + 1;

    const { data: updated, error } = await supabase
      .from('product_images')
      .update({
        color_id: targetColorId,
        is_primary: !targetHasPrimary,
        sort_order: nextSort,
        updated_at: new Date().toISOString(),
      })
      .eq('id', imageId)
      .eq('business_id', businessId)
      .eq('product_id', productId)
      .select('*')
      .single();

    if (error) throw error;
    return mapDbProductImage(updated);
  },

  async deleteColorImage(params: {
    businessId: string;
    productId: string;
    image: ProductColorImage;
  }): Promise<void> {
    const { businessId, productId, image } = params;
    const { error } = await supabase
      .from('product_images')
      .delete()
      .eq('id', image.id)
      .eq('business_id', businessId)
      .eq('product_id', productId);

    if (error) throw error;

    await removeStorageObjectSafely(businessId, image.storagePath);

    // Promote next image if deleted one was primary for its color
    if (image.isPrimary) {
      const { data: remaining } = await supabase
        .from('product_images')
        .select('id, image_url')
        .eq('business_id', businessId)
        .eq('product_id', productId)
        .eq('color_id', image.colorId)
        .order('sort_order', { ascending: true })
        .limit(1);

      if (remaining && remaining.length > 0) {
        await supabase
          .from('product_images')
          .update({ is_primary: true, updated_at: new Date().toISOString() })
          .eq('id', remaining[0].id);
      }
    }

    // Clear or update products.image_url if it pointed to deleted image
    const { data: prodRow } = await supabase
      .from('products')
      .select('image_url')
      .eq('id', productId)
      .maybeSingle();

    if (prodRow?.image_url === image.imageUrl) {
      const { data: anyRemaining } = await supabase
        .from('product_images')
        .select('image_url')
        .eq('business_id', businessId)
        .eq('product_id', productId)
        .order('is_primary', { ascending: false })
        .order('sort_order', { ascending: true })
        .limit(1);

      await supabase
        .from('products')
        .update({
          image_url: anyRemaining?.[0]?.image_url || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', productId)
        .eq('business_id', businessId);
    }
  },
};
