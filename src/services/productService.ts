import { supabase, isSupabaseConfigured, sanitizeUuid, isValidUuid } from '../lib/supabase';
import { Product, ProductColor, ProductColorImage, ProductVariant } from '../types';
import { catalogImageService } from './catalogImageService';
import { normalizeColorKey, sortColorImages } from '../utils/productImageResolver';

const mapDbProductToProduct = (
  p: any,
  colorsByProduct?: Map<string, ProductColor[]>,
  imagesByProduct?: Map<string, ProductColorImage[]>
): Product => {
  const colors = colorsByProduct?.get(p.id) || [];
  const images = sortColorImages(imagesByProduct?.get(p.id) || []);
  const colorByNorm = new Map(colors.map(c => [normalizeColorKey(c.normalizedName || c.colorName), c.id]));

  const primaryImg =
    images.find(i => i.isPrimary)?.imageUrl ||
    images[0]?.imageUrl ||
    p.image_url ||
    undefined;

  return {
    id: p.id,
    name: p.name,
    code: p.sku,
    barcode: p.barcode || '',
    category: p.category_name || 'General',
    subcategory: p.subcategory || undefined,
    brand: p.brand || undefined,
    description: p.description || undefined,
    image: primaryImg,
    primaryImageUrl: primaryImg,
    images: images.length > 0 ? images.map(i => i.imageUrl) : p.image_url ? [p.image_url] : undefined,
    productColors: colors,
    productImages: images,
    purchasePrice: Number(p.purchase_price || 0),
    salePrice: Number(p.sale_price || 0),
    wholesalePrice: p.wholesale_price != null ? Number(p.wholesale_price) : undefined,
    minSalePrice: p.min_sale_price != null ? Number(p.min_sale_price) : undefined,
    currentStock: Number(p.current_stock || 0),
    minStockAlert: Number(p.min_stock_alert || 5),
    unit: p.unit || 'pcs',
    businessType: p.business_type,
    hasVariants: Boolean(p.has_variants),
    variants: Array.isArray(p.product_variants)
      ? p.product_variants.map((v: any): ProductVariant => ({
          id: v.id,
          colorId: v.color_id || (v.color ? colorByNorm.get(normalizeColorKey(v.color)) : undefined),
          color: v.color || undefined,
          colorHex: v.color_hex || undefined,
          size: v.size || undefined,
          sku: v.sku,
          barcode: v.barcode || undefined,
          stock: Number(v.stock || 0),
          additionalPrice: Number(v.additional_price || 0),
          purchasePrice: v.purchase_price != null ? Number(v.purchase_price) : undefined,
          salePrice: v.sale_price != null ? Number(v.sale_price) : undefined,
          minStockAlert: v.min_stock_alert != null ? Number(v.min_stock_alert) : undefined,
          status: v.is_active === false ? 'inactive' : 'active',
        }))
      : undefined,
  landedCostPerUnit: p.landed_cost_per_unit != null ? Number(p.landed_cost_per_unit) : undefined,
  allocatedOpExPerUnit: p.allocated_opex_per_unit != null ? Number(p.allocated_opex_per_unit) : undefined,
  totalUnitCost: p.total_unit_cost != null ? Number(p.total_unit_cost) : undefined,
  recommendedSellingPrice: p.recommended_selling_price != null ? Number(p.recommended_selling_price) : undefined,
  qualityTier: p.quality_tier || undefined,
  supplierId: p.supplier_id || undefined,
  supplierName: p.supplier_name || undefined,
  leadTimeDays: p.lead_time_days != null ? Number(p.lead_time_days) : undefined,
  model: p.model || undefined,
  serialNumber: p.serial_number || undefined,
  warrantyPeriod: p.warranty_period || undefined,
  expiryDate: p.expiry_date || undefined,
  batchNumber: p.batch_number || undefined,
  createdAt: p.created_at,
  updatedAt: p.updated_at,
  isActive: p.is_active !== false,
  };
};

async function syncVariantColorsSafely(
  businessId: string,
  productId: string,
  variants: ProductVariant[]
): Promise<Map<string, string>> {
  const colorIdByNorm = new Map<string, string>();
  const seen = new Set<string>();

  for (const v of variants) {
    const cleanColor = (v.color || '').trim();
    const key = normalizeColorKey(cleanColor);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    try {
      const ensured = await catalogImageService.ensureProductColor({
        businessId,
        productId,
        colorName: cleanColor,
        colorHex: v.colorHex,
      });
      colorIdByNorm.set(key, ensured.id);
    } catch {
      // Non-fatal if product_colors migration hasn't been applied yet
      break;
    }
  }
  return colorIdByNorm;
}

export const productService = {
  async fetchProducts(businessId?: string): Promise<Product[]> {
    if (!isSupabaseConfigured) {
      throw new Error('Supabase client is not configured.');
    }

    let query = supabase
      .from('products')
      .select('*, product_variants(*)')
      .order('created_at', { ascending: false });

    if (businessId) {
      query = query.eq('business_id', businessId);
    }

    const [{ data, error }, media] = await Promise.all([
      query,
      businessId
        ? catalogImageService.fetchCatalogMedia(businessId).catch(() => ({
            colors: [] as ProductColor[],
            images: [] as ProductColorImage[],
            schemaReady: false,
          }))
        : Promise.resolve({
            colors: [] as ProductColor[],
            images: [] as ProductColorImage[],
            schemaReady: false,
          }),
    ]);

    if (error) throw error;

    const colorsByProduct = new Map<string, ProductColor[]>();
    media.colors.forEach(c => {
      const list = colorsByProduct.get(c.productId) || [];
      list.push(c);
      colorsByProduct.set(c.productId, list);
    });

    const imagesByProduct = new Map<string, ProductColorImage[]>();
    media.images.forEach(img => {
      const list = imagesByProduct.get(img.productId) || [];
      list.push(img);
      imagesByProduct.set(img.productId, list);
    });

    return (data || []).map(p => mapDbProductToProduct(p, colorsByProduct, imagesByProduct));
  },

  async insertProduct(
    product: Omit<Product, 'id' | 'createdAt' | 'updatedAt'>,
    businessId: string
  ): Promise<Product> {
    if (!isSupabaseConfigured) {
      throw new Error('Supabase client is not configured.');
    }

    const payload: any = {
      business_id: businessId,
      name: product.name,
      sku: product.code,
      barcode: product.barcode || '',
      category_name: product.category || 'General',
      subcategory: product.subcategory || null,
      brand: product.brand || null,
      description: product.description || null,
      image_url: product.image || null,
      purchase_price: product.purchasePrice,
      sale_price: product.salePrice,
      wholesale_price: product.wholesalePrice ?? null,
      min_sale_price: product.minSalePrice ?? null,
      current_stock: product.currentStock,
      min_stock_alert: product.minStockAlert,
      unit: product.unit || 'pcs',
      business_type: product.businessType || 'general',
      has_variants: Boolean(product.hasVariants),
      landed_cost_per_unit: product.landedCostPerUnit ?? null,
      allocated_opex_per_unit: product.allocatedOpExPerUnit ?? null,
      total_unit_cost: product.totalUnitCost ?? null,
      recommended_selling_price: product.recommendedSellingPrice ?? null,
      quality_tier: product.qualityTier || null,
      supplier_id: sanitizeUuid(product.supplierId),
      supplier_name: product.supplierName || null,
      lead_time_days: product.leadTimeDays ?? null,
      model: product.model || null,
      serial_number: product.serialNumber || null,
      warranty_period: product.warrantyPeriod || null,
      expiry_date: product.expiryDate || null,
      batch_number: product.batchNumber || null,
      is_active: product.isActive !== false,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from('products')
      .insert(payload)
      .select('*, product_variants(*)')
      .single();

    if (error) throw error;

    if (product.hasVariants && product.variants && product.variants.length > 0) {
      const colorIdMap = await syncVariantColorsSafely(businessId, data.id, product.variants);
      const variantPayloads = product.variants.map((v, idx) => {
        const syncedColorId =
          v.colorId && isValidUuid(v.colorId)
            ? v.colorId
            : v.color
            ? colorIdMap.get(normalizeColorKey(v.color))
            : undefined;
        return {
          product_id: data.id,
          business_id: businessId,
          color: v.color || null,
          color_hex: v.colorHex || null,
          ...(syncedColorId ? { color_id: syncedColorId } : {}),
          size: v.size || null,
          sku: v.sku || `${product.code}-V${idx + 1}`,
          barcode: v.barcode || null,
          stock: Number(v.stock || 0),
          additional_price: Number(v.additionalPrice || 0),
          purchase_price: v.purchasePrice ?? null,
          sale_price: v.salePrice ?? null,
          min_stock_alert: v.minStockAlert ?? null,
          is_active: v.status !== 'inactive',
        };
      });

      const { data: insertedVariants, error: variantErr } = await supabase
        .from('product_variants')
        .insert(variantPayloads)
        .select('*');

      if (variantErr) {
        // Clean up orphan product row if variant insertion fails
        await supabase.from('products').delete().eq('id', data.id);
        throw variantErr;
      }
      data.product_variants = insertedVariants || [];
    }

    const media = await catalogImageService
      .fetchCatalogMedia(businessId)
      .catch(() => ({ colors: [] as ProductColor[], images: [] as ProductColorImage[] }));
    const cMap = new Map<string, ProductColor[]>([
      [data.id, media.colors.filter(c => c.productId === data.id)],
    ]);
    const iMap = new Map<string, ProductColorImage[]>([
      [data.id, media.images.filter(i => i.productId === data.id)],
    ]);
    return mapDbProductToProduct(data, cMap, iMap);
  },

  async updateProduct(
    id: string,
    productData: Partial<Product>,
    businessId?: string
  ): Promise<Product> {
    if (!isSupabaseConfigured) {
      throw new Error('Supabase client is not configured.');
    }

    const payload: any = {
      updated_at: new Date().toISOString(),
    };

    if ('name' in productData && productData.name !== undefined) payload.name = productData.name;
    if ('code' in productData && productData.code !== undefined) payload.sku = productData.code;
    if ('barcode' in productData && productData.barcode !== undefined) payload.barcode = productData.barcode;
    if ('category' in productData && productData.category !== undefined) payload.category_name = productData.category;
    if ('subcategory' in productData) payload.subcategory = productData.subcategory || null;
    if ('brand' in productData) payload.brand = productData.brand || null;
    if ('description' in productData) payload.description = productData.description || null;
    if ('image' in productData) payload.image_url = productData.image || null;
    if ('purchasePrice' in productData && productData.purchasePrice !== undefined) payload.purchase_price = productData.purchasePrice;
    if ('salePrice' in productData && productData.salePrice !== undefined) payload.sale_price = productData.salePrice;
    if ('wholesalePrice' in productData) payload.wholesale_price = productData.wholesalePrice ?? null;
    if ('minSalePrice' in productData) payload.min_sale_price = productData.minSalePrice ?? null;
    if ('currentStock' in productData && productData.currentStock !== undefined) payload.current_stock = productData.currentStock;
    if ('minStockAlert' in productData && productData.minStockAlert !== undefined) payload.min_stock_alert = productData.minStockAlert;
    if ('unit' in productData && productData.unit !== undefined) payload.unit = productData.unit;
    if ('businessType' in productData && productData.businessType !== undefined) payload.business_type = productData.businessType;
    if ('hasVariants' in productData && productData.hasVariants !== undefined) payload.has_variants = productData.hasVariants;
    if ('landedCostPerUnit' in productData) payload.landed_cost_per_unit = productData.landedCostPerUnit ?? null;
    if ('allocatedOpExPerUnit' in productData) payload.allocated_opex_per_unit = productData.allocatedOpExPerUnit ?? null;
    if ('totalUnitCost' in productData) payload.total_unit_cost = productData.totalUnitCost ?? null;
    if ('recommendedSellingPrice' in productData) payload.recommended_selling_price = productData.recommendedSellingPrice ?? null;
    if ('qualityTier' in productData) payload.quality_tier = productData.qualityTier || null;
    if ('supplierId' in productData) payload.supplier_id = sanitizeUuid(productData.supplierId);
    if ('supplierName' in productData) payload.supplier_name = productData.supplierName || null;
    if ('leadTimeDays' in productData) payload.lead_time_days = productData.leadTimeDays ?? null;
    if ('model' in productData) payload.model = productData.model || null;
    if ('serialNumber' in productData) payload.serial_number = productData.serialNumber || null;
    if ('warrantyPeriod' in productData) payload.warranty_period = productData.warrantyPeriod || null;
    if ('expiryDate' in productData) payload.expiry_date = productData.expiryDate || null;
    if ('batchNumber' in productData) payload.batch_number = productData.batchNumber || null;
    if ('isActive' in productData && productData.isActive !== undefined) payload.is_active = productData.isActive;

    let query = supabase.from('products').update(payload).eq('id', id);
    if (businessId) {
      query = query.eq('business_id', businessId);
    }

    const { data, error } = await query.select('*, product_variants(*)').single();
    if (error) throw error;

    // Sync variants if caller provided variants array or explicitly disabled hasVariants
    if (productData.variants !== undefined || productData.hasVariants === false) {
      const targetBizId = businessId || data.business_id;
      const incoming = productData.hasVariants === false ? [] : (productData.variants || []);
      const existingIds: string[] = (data.product_variants || []).map((v: any) => v.id);
      const keepUuidIds = incoming.map(v => v.id).filter(isValidUuid);
      const removedIds = existingIds.filter(eid => !keepUuidIds.includes(eid));

      if (removedIds.length > 0) {
        const { error: delErr } = await supabase
          .from('product_variants')
          .delete()
          .in('id', removedIds)
          .eq('product_id', id);
        if (delErr) throw delErr;
      }

      const colorIdMap = await syncVariantColorsSafely(targetBizId, id, incoming);

      for (let i = 0; i < incoming.length; i++) {
        const v = incoming[i];
        const syncedColorId =
          v.colorId && isValidUuid(v.colorId)
            ? v.colorId
            : v.color
            ? colorIdMap.get(normalizeColorKey(v.color))
            : undefined;
        const vPayload: any = {
          product_id: id,
          business_id: targetBizId,
          color: v.color || null,
          color_hex: v.colorHex || null,
          size: v.size || null,
          sku: v.sku || `${data.sku}-V${i + 1}`,
          barcode: v.barcode || null,
          stock: Number(v.stock || 0),
          additional_price: Number(v.additionalPrice || 0),
          purchase_price: v.purchasePrice ?? null,
          sale_price: v.salePrice ?? null,
          min_stock_alert: v.minStockAlert ?? null,
          is_active: v.status !== 'inactive',
          updated_at: new Date().toISOString(),
        };
        if (syncedColorId) {
          vPayload.color_id = syncedColorId;
        }

        if (isValidUuid(v.id) && existingIds.includes(v.id)) {
          const { error: updVErr } = await supabase
            .from('product_variants')
            .update(vPayload)
            .eq('id', v.id);
          if (updVErr) throw updVErr;
        } else {
          const { error: insVErr } = await supabase
            .from('product_variants')
            .insert(vPayload);
          if (insVErr) throw insVErr;
        }
      }

      const { data: refreshed, error: refErr } = await supabase
        .from('products')
        .select('*, product_variants(*)')
        .eq('id', id)
        .single();
      if (refErr) throw refErr;
      const media = await catalogImageService
        .fetchCatalogMedia(targetBizId)
        .catch(() => ({ colors: [] as ProductColor[], images: [] as ProductColorImage[] }));
      const cMap = new Map<string, ProductColor[]>([
        [id, media.colors.filter(c => c.productId === id)],
      ]);
      const iMap = new Map<string, ProductColorImage[]>([
        [id, media.images.filter(i => i.productId === id)],
      ]);
      return mapDbProductToProduct(refreshed, cMap, iMap);
    }

    const media = await catalogImageService
      .fetchCatalogMedia(businessId || data.business_id)
      .catch(() => ({ colors: [] as ProductColor[], images: [] as ProductColorImage[] }));
    const cMap = new Map<string, ProductColor[]>([
      [id, media.colors.filter(c => c.productId === id)],
    ]);
    const iMap = new Map<string, ProductColorImage[]>([
      [id, media.images.filter(i => i.productId === id)],
    ]);
    return mapDbProductToProduct(data, cMap, iMap);
  },

  async softDeleteProduct(productId: string, businessId?: string): Promise<boolean> {
    if (!isSupabaseConfigured) {
      throw new Error('Supabase client is not configured.');
    }

    let query = supabase
      .from('products')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', productId);

    if (businessId) {
      query = query.eq('business_id', businessId);
    }

    const { error } = await query;
    if (error) throw error;
    return true;
  },

  async permanentDeleteProduct(productId: string, businessId?: string): Promise<boolean> {
    if (!isSupabaseConfigured) {
      throw new Error('Supabase client is not configured.');
    }

    let query = supabase.from('products').delete().eq('id', productId);
    if (businessId) {
      query = query.eq('business_id', businessId);
    }

    const { error } = await query;
    if (error) throw error;
    return true;
  },
};
