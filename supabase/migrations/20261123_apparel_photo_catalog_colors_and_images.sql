-- ============================================================================
-- Amar Dokan Pro: Apparel Photo Catalog — Product Colors & Color-Linked Images
-- Idempotent, Data-Safe Migration
--
-- Features:
-- 1. Permanent UUID-keyed `public.product_colors` per (business_id, product_id).
-- 2. Links `public.product_variants.color_id` -> `public.product_colors(id)`.
-- 3. Backfills existing variant colors idempotently without modifying user data.
-- 4. Creates `public.product_images` referencing permanent (product_id, color_id)
--    with partial unique index enforcing max 1 primary image per color.
-- 5. Configures non-recursive RLS using existing 20261122 security helpers.
-- 6. Configures `product-images` Supabase Storage bucket & folder-scoped policies.
-- 7. Provides atomic RPCs for primary-image selection & image reordering.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ----------------------------------------------------------------------------
-- 1. Product Colors Table (Permanent Color IDs per Product)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.product_colors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  color_name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  color_hex TEXT DEFAULT '#0F172A',
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_product_colors_product_normalized
  ON public.product_colors (product_id, normalized_name);

CREATE INDEX IF NOT EXISTS idx_product_colors_business_product
  ON public.product_colors (business_id, product_id, sort_order);

-- Add nullable permanent color_id FK to product_variants
ALTER TABLE public.product_variants
  ADD COLUMN IF NOT EXISTS color_id UUID REFERENCES public.product_colors(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_product_variants_product_color
  ON public.product_variants (product_id, color_id);

-- Backfill existing variant colors into product_colors safely (idempotent)
INSERT INTO public.product_colors (
  business_id,
  product_id,
  color_name,
  normalized_name,
  color_hex,
  sort_order
)
SELECT DISTINCT ON (pv.product_id, LOWER(TRIM(pv.color)))
  pv.business_id,
  pv.product_id,
  TRIM(pv.color) AS color_name,
  LOWER(TRIM(pv.color)) AS normalized_name,
  COALESCE(NULLIF(TRIM(pv.color_hex), ''), '#0F172A') AS color_hex,
  0 AS sort_order
FROM public.product_variants pv
WHERE NULLIF(TRIM(COALESCE(pv.color, '')), '') IS NOT NULL
ORDER BY pv.product_id, LOWER(TRIM(pv.color)), pv.created_at ASC
ON CONFLICT (product_id, normalized_name) DO NOTHING;

-- Link existing variants to their permanent color_id
UPDATE public.product_variants pv
SET color_id = pc.id
FROM public.product_colors pc
WHERE pv.product_id = pc.product_id
  AND LOWER(TRIM(COALESCE(pv.color, ''))) = pc.normalized_name
  AND pv.color_id IS NULL;

-- ----------------------------------------------------------------------------
-- 2. Product Images Table (Cloud Storage URLs linked to Product + Color ID)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.product_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  color_id UUID NOT NULL REFERENCES public.product_colors(id) ON DELETE CASCADE,
  image_url TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  file_name TEXT,
  file_size BIGINT,
  mime_type TEXT,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  uploaded_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enforce max one primary image per (product_id, color_id) atomically
CREATE UNIQUE INDEX IF NOT EXISTS ux_product_images_one_primary_per_color
  ON public.product_images (product_id, color_id)
  WHERE is_primary = TRUE;

CREATE INDEX IF NOT EXISTS idx_product_images_lookup
  ON public.product_images (business_id, product_id, color_id, sort_order);

-- ----------------------------------------------------------------------------
-- 3. Enable Non-Recursive Row Level Security
-- ----------------------------------------------------------------------------
ALTER TABLE public.product_colors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_images ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.product_colors NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.product_images NO FORCE ROW LEVEL SECURITY;

-- Clean drop before recreate so re-running migration stays idempotent
DROP POLICY IF EXISTS product_colors_select ON public.product_colors;
DROP POLICY IF EXISTS product_colors_insert ON public.product_colors;
DROP POLICY IF EXISTS product_colors_update ON public.product_colors;
DROP POLICY IF EXISTS product_colors_delete ON public.product_colors;

CREATE POLICY product_colors_select ON public.product_colors
  FOR SELECT TO authenticated
  USING (public.is_active_staff_member(business_id));

CREATE POLICY product_colors_insert ON public.product_colors
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_module_permission(business_id, 'product_management', 'create')
    OR public.has_module_permission(business_id, 'product_management', 'edit')
  );

CREATE POLICY product_colors_update ON public.product_colors
  FOR UPDATE TO authenticated
  USING (
    public.has_module_permission(business_id, 'product_management', 'edit')
    OR public.has_module_permission(business_id, 'product_management', 'create')
  )
  WITH CHECK (
    public.has_module_permission(business_id, 'product_management', 'edit')
    OR public.has_module_permission(business_id, 'product_management', 'create')
  );

CREATE POLICY product_colors_delete ON public.product_colors
  FOR DELETE TO authenticated
  USING (
    public.has_module_permission(business_id, 'product_management', 'delete')
    OR public.has_module_permission(business_id, 'product_management', 'edit')
  );

DROP POLICY IF EXISTS product_images_select ON public.product_images;
DROP POLICY IF EXISTS product_images_insert ON public.product_images;
DROP POLICY IF EXISTS product_images_update ON public.product_images;
DROP POLICY IF EXISTS product_images_delete ON public.product_images;

CREATE POLICY product_images_select ON public.product_images
  FOR SELECT TO authenticated
  USING (public.is_active_staff_member(business_id));

CREATE POLICY product_images_insert ON public.product_images
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_module_permission(business_id, 'product_management', 'create')
    OR public.has_module_permission(business_id, 'product_management', 'edit')
  );

CREATE POLICY product_images_update ON public.product_images
  FOR UPDATE TO authenticated
  USING (
    public.has_module_permission(business_id, 'product_management', 'edit')
    OR public.has_module_permission(business_id, 'product_management', 'create')
  )
  WITH CHECK (
    public.has_module_permission(business_id, 'product_management', 'edit')
    OR public.has_module_permission(business_id, 'product_management', 'create')
  );

CREATE POLICY product_images_delete ON public.product_images
  FOR DELETE TO authenticated
  USING (
    public.has_module_permission(business_id, 'product_management', 'delete')
    OR public.has_module_permission(business_id, 'product_management', 'edit')
  );

-- ----------------------------------------------------------------------------
-- 4. Atomic Concurrency-Safe RPCs for Primary & Reordering
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_primary_product_color_image(
  p_business_id UUID,
  p_product_id UUID,
  p_color_id UUID,
  p_image_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_image_url TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT (
    public.has_module_permission(p_business_id, 'product_management', 'edit')
    OR public.has_module_permission(p_business_id, 'product_management', 'create')
  ) THEN
    RAISE EXCEPTION 'Permission denied to update product images';
  END IF;

  SELECT image_url INTO v_image_url
  FROM public.product_images
  WHERE id = p_image_id
    AND business_id = p_business_id
    AND product_id = p_product_id
    AND color_id = p_color_id;

  IF v_image_url IS NULL THEN
    RAISE EXCEPTION 'Target product color image not found';
  END IF;

  UPDATE public.product_images
  SET is_primary = FALSE,
      updated_at = NOW()
  WHERE business_id = p_business_id
    AND product_id = p_product_id
    AND color_id = p_color_id
    AND is_primary = TRUE
    AND id <> p_image_id;

  UPDATE public.product_images
  SET is_primary = TRUE,
      updated_at = NOW()
  WHERE id = p_image_id
    AND business_id = p_business_id
    AND product_id = p_product_id
    AND color_id = p_color_id;

  -- Set product fallback image_url only when missing
  UPDATE public.products
  SET image_url = v_image_url,
      updated_at = NOW()
  WHERE id = p_product_id
    AND business_id = p_business_id
    AND NULLIF(TRIM(COALESCE(image_url, '')), '') IS NULL;

  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.reorder_product_color_images(
  p_business_id UUID,
  p_product_id UUID,
  p_color_id UUID,
  p_image_ids UUID[]
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_idx INTEGER := 0;
  v_img_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT (
    public.has_module_permission(p_business_id, 'product_management', 'edit')
    OR public.has_module_permission(p_business_id, 'product_management', 'create')
  ) THEN
    RAISE EXCEPTION 'Permission denied to reorder product images';
  END IF;

  IF p_image_ids IS NULL OR array_length(p_image_ids, 1) IS NULL THEN
    RETURN TRUE;
  END IF;

  FOREACH v_img_id IN ARRAY p_image_ids LOOP
    UPDATE public.product_images
    SET sort_order = v_idx,
        updated_at = NOW()
    WHERE id = v_img_id
      AND business_id = p_business_id
      AND product_id = p_product_id
      AND color_id = p_color_id;
    v_idx := v_idx + 1;
  END LOOP;

  RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_primary_product_color_image(UUID, UUID, UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reorder_product_color_images(UUID, UUID, UUID, UUID[]) TO authenticated;

-- ----------------------------------------------------------------------------
-- 5. Supabase Storage Bucket (`product-images`) & Folder-Scoped Policies
-- ----------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'product-images',
  'product-images',
  TRUE,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public = TRUE,
  file_size_limit = 5242880,
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp'];

DROP POLICY IF EXISTS product_images_storage_public_read ON storage.objects;
DROP POLICY IF EXISTS product_images_storage_auth_insert ON storage.objects;
DROP POLICY IF EXISTS product_images_storage_auth_update ON storage.objects;
DROP POLICY IF EXISTS product_images_storage_auth_delete ON storage.objects;

CREATE POLICY product_images_storage_public_read ON storage.objects
  FOR SELECT
  USING (bucket_id = 'product-images');

CREATE POLICY product_images_storage_auth_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'product-images'
    AND (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND (
      public.has_module_permission(((storage.foldername(name))[1])::uuid, 'product_management', 'create')
      OR public.has_module_permission(((storage.foldername(name))[1])::uuid, 'product_management', 'edit')
    )
  );

CREATE POLICY product_images_storage_auth_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'product-images'
    AND (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND (
      public.has_module_permission(((storage.foldername(name))[1])::uuid, 'product_management', 'edit')
      OR public.has_module_permission(((storage.foldername(name))[1])::uuid, 'product_management', 'create')
    )
  )
  WITH CHECK (
    bucket_id = 'product-images'
    AND (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND (
      public.has_module_permission(((storage.foldername(name))[1])::uuid, 'product_management', 'edit')
      OR public.has_module_permission(((storage.foldername(name))[1])::uuid, 'product_management', 'create')
    )
  );

CREATE POLICY product_images_storage_auth_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'product-images'
    AND (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND (
      public.has_module_permission(((storage.foldername(name))[1])::uuid, 'product_management', 'delete')
      OR public.has_module_permission(((storage.foldername(name))[1])::uuid, 'product_management', 'edit')
    )
  );
