import React, { useMemo } from 'react';
import { generateQrSvgElements } from '../../utils/barcodeGenerator';

interface QrCodeSvgProps {
  value: string;
  size?: number;
  showCaption?: boolean;
  caption?: string;
  className?: string;
}

export const QrCodeSvg: React.FC<QrCodeSvgProps> = React.memo(({
  value,
  size = 96,
  showCaption = false,
  caption,
  className = '',
}) => {
  const cleanValue = (value || 'PROTIVA').trim() || 'PROTIVA';

  const { pathData, moduleCount } = useMemo(() => {
    return generateQrSvgElements(cleanValue);
  }, [cleanValue]);

  const quietModules = 2;
  const totalUnits = moduleCount + quietModules * 2;
  const displayCaption = (caption ?? cleanValue).slice(0, 32);

  return (
    <div className={`inline-flex flex-col items-center select-none ${className}`}>
      <div
        className="bg-white rounded-sm flex items-center justify-center overflow-hidden"
        style={{ width: `${size}px`, height: `${size}px` }}
      >
        <svg
          viewBox={`0 0 ${totalUnits} ${totalUnits}`}
          width="100%"
          height="100%"
          preserveAspectRatio="xMidYMid meet"
          style={{ shapeRendering: 'crispEdges', display: 'block' }}
          aria-label={`QR Code for ${displayCaption}`}
        >
          <rect width={totalUnits} height={totalUnits} fill="#ffffff" />
          <g transform={`translate(${quietModules}, ${quietModules})`}>
            <path fill="#000000" d={pathData} />
          </g>
        </svg>
      </div>
      {showCaption && displayCaption && (
        <span className="mt-1 text-[10px] font-mono font-bold text-slate-900 truncate max-w-full">
          {displayCaption}
        </span>
      )}
    </div>
  );
});

QrCodeSvg.displayName = 'QrCodeSvg';
