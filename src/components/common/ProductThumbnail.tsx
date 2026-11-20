import React, { useEffect, useState } from 'react';
import { Shirt } from 'lucide-react';

interface ProductThumbnailProps {
  src?: string | null;
  alt: string;
  colorHex?: string;
  colorName?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  className?: string;
  roundedClassName?: string;
}

const SIZE_MAP = {
  xs: 'w-8 h-8',
  sm: 'w-10 h-10',
  md: 'w-14 h-14',
  lg: 'w-20 h-20',
};

const ICON_SIZE_MAP = {
  xs: 'w-3.5 h-3.5',
  sm: 'w-4 h-4',
  md: 'w-5 h-5',
  lg: 'w-7 h-7',
};

export const ProductThumbnail: React.FC<ProductThumbnailProps> = ({
  src,
  alt,
  colorHex,
  colorName,
  size = 'sm',
  className = '',
  roundedClassName = 'rounded-lg',
}) => {
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    setHasError(false);
  }, [src]);

  const showImage = Boolean(src && src.trim() && !hasError);

  return (
    <div
      className={`relative shrink-0 overflow-hidden bg-slate-100 dark:bg-[#0E182E] border border-slate-200 dark:border-[#1F3158] flex items-center justify-center ${SIZE_MAP[size]} ${roundedClassName} ${className}`}
      title={colorName ? `${alt} (${colorName})` : alt}
    >
      {showImage ? (
        <img
          src={src!}
          alt={alt}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setHasError(true)}
          className="w-full h-full object-cover"
        />
      ) : (
        <div className="flex flex-col items-center justify-center text-slate-400 dark:text-slate-500">
          <Shirt className={ICON_SIZE_MAP[size]} strokeWidth={1.6} />
        </div>
      )}

      {colorHex && (
        <span
          aria-label={colorName ? `Color: ${colorName}` : 'Color swatch'}
          className="absolute bottom-0.5 right-0.5 w-2.5 h-2.5 rounded-full border border-white dark:border-[#0E182E] shadow-xs"
          style={{ backgroundColor: colorHex }}
        />
      )}
    </div>
  );
};
