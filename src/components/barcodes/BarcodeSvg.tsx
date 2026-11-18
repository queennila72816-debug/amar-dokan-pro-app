import React, { useMemo } from 'react';
import { BarcodeFormat, generateBarcodeSvgElements } from '../../utils/barcodeGenerator';

interface BarcodeSvgProps {
  value: string;
  width?: number; // width in px or viewbox width
  height?: number; // barcode bar height in px
  showText?: boolean;
  textColor?: string;
  format?: BarcodeFormat;
  className?: string;
}

export const BarcodeSvg: React.FC<BarcodeSvgProps> = React.memo(({
  value,
  width = 180,
  height = 50,
  showText = true,
  textColor = '#1e293b',
  format = 'CODE128',
  className = '',
}) => {
  const cleanValue = value ? value.trim() : '000000';

  const { pathData, displayText } = useMemo(() => {
    return generateBarcodeSvgElements(cleanValue, width, height, '#000000', format);
  }, [cleanValue, width, height, format]);

  const totalSvgHeight = showText ? height + 16 : height;

  return (
    <div className={`inline-flex flex-col items-center select-none ${className}`}>
      <svg
        viewBox={`0 0 ${width} ${totalSvgHeight}`}
        width="100%"
        height="100%"
        preserveAspectRatio="xMidYMid meet"
        className="overflow-visible"
        style={{ shapeRendering: 'crispEdges' }}
      >
        <path fill="#000000" d={pathData} />
        {showText && (
          <text
            x={width / 2}
            y={height + 12}
            textAnchor="middle"
            fill={textColor}
            fontSize="10"
            fontFamily="monospace"
            fontWeight="bold"
            letterSpacing="2"
          >
            {displayText}
          </text>
        )}
      </svg>
    </div>
  );
});

BarcodeSvg.displayName = 'BarcodeSvg';
