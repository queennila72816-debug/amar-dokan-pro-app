/**
 * High-performance, lightweight Code 128B and EAN-13 vector barcode generator
 * Generates crisp, scannable single-path SVG barcodes with proper quiet zones
 * and internal memoization caching for fast batch label preview & printing.
 */

// Code 128 Symbol Patterns (Index 0-106)
// Each string represents alternating bar and space widths (1-4 modules)
const CODE128_PATTERNS: string[] = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];

const START_B = 104;
const STOP = 106;

// EAN-13 Bit Encodings (7 modules per digit)
const EAN_L_CODES = [
  '0001101', '0011001', '0010011', '0111101', '0100011',
  '0110001', '0101111', '0111011', '0110111', '0001011',
];
const EAN_G_CODES = [
  '0100111', '0110011', '0011011', '0100001', '0011101',
  '0111001', '0000101', '0010001', '0001001', '0010111',
];
const EAN_R_CODES = [
  '1110010', '1100110', '1101100', '1000010', '1011100',
  '1001110', '1010000', '1000100', '1001000', '1110100',
];
const EAN_PARITY_TABLE = [
  'LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG',
  'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL',
];

export type BarcodeFormat = 'CODE128' | 'EAN13';

export interface BarcodeRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BarcodeElementsResult {
  rects: BarcodeRect[];
  pathData: string;
  totalModules: number;
  displayText: string;
  usedFormat: BarcodeFormat;
}

const MAX_BARCODE_CACHE_SIZE = 600;
const elementsCache = new Map<string, BarcodeElementsResult>();
const svgMarkupCache = new Map<string, string>();

function setBoundedCache<T>(cache: Map<string, T>, key: string, value: T): void {
  if (cache.size >= MAX_BARCODE_CACHE_SIZE) {
    const firstKey = cache.keys().next().value;
    if (firstKey !== undefined) {
      cache.delete(firstKey);
    }
  }
  cache.set(key, value);
}

/**
 * Clear internal barcode caches (useful for testing or memory reset)
 */
export function clearBarcodeCache(): void {
  elementsCache.clear();
  svgMarkupCache.clear();
}

/**
 * Calculate valid 13-digit EAN-13 check digit
 */
export function calculateEAN13CheckDigit(digits12: string): string {
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const d = parseInt(digits12[i], 10);
    sum += i % 2 === 0 ? d : d * 3;
  }
  const check = (10 - (sum % 10)) % 10;
  return `${digits12}${check}`;
}

/**
 * Validate whether a string is a valid 12- or 13-digit numeric EAN-13 candidate
 */
export function normalizeEAN13(input: string): string | null {
  const digits = input.replace(/\D/g, '');
  if (digits.length === 12) {
    return calculateEAN13CheckDigit(digits);
  }
  if (digits.length === 13) {
    const expected = calculateEAN13CheckDigit(digits.slice(0, 12));
    return digits === expected ? digits : expected;
  }
  return null;
}

/**
 * Encode 13-digit EAN-13 into bit string (95 modules total)
 */
export function encodeEAN13Bits(ean13: string): { bits: string; normalized: string } | null {
  const normalized = normalizeEAN13(ean13);
  if (!normalized || normalized.length !== 13) return null;

  const firstDigit = parseInt(normalized[0], 10);
  const parity = EAN_PARITY_TABLE[firstDigit] || 'LLLLLL';

  let bits = '101'; // Left guard
  for (let i = 1; i <= 6; i++) {
    const d = parseInt(normalized[i], 10);
    bits += parity[i - 1] === 'L' ? EAN_L_CODES[d] : EAN_G_CODES[d];
  }
  bits += '01010'; // Center guard
  for (let i = 7; i <= 12; i++) {
    const d = parseInt(normalized[i], 10);
    bits += EAN_R_CODES[d];
  }
  bits += '101'; // Right guard

  return { bits, normalized };
}

/**
 * Encode string into Code 128B pattern
 */
export function encodeCode128B(text: string): { widths: number[]; checksum: number } {
  const clean = text.replace(/[^\x20-\x7E]/g, '');
  if (!clean) {
    return { widths: [2, 1, 1, 2, 3, 2, 2, 3, 3, 1, 1, 1, 2], checksum: 0 };
  }

  const indices: number[] = [START_B];
  let checksumTotal = START_B;

  for (let i = 0; i < clean.length; i++) {
    const ascii = clean.charCodeAt(i);
    const value = ascii - 32;
    indices.push(value);
    checksumTotal += value * (i + 1);
  }

  const checkDigit = checksumTotal % 103;
  indices.push(checkDigit);
  indices.push(STOP);

  const widths: number[] = [];
  for (let idxPos = 0; idxPos < indices.length; idxPos++) {
    const pattern = CODE128_PATTERNS[indices[idxPos]] || CODE128_PATTERNS[0];
    for (let j = 0; j < pattern.length; j++) {
      widths.push(parseInt(pattern[j], 10));
    }
  }

  return { widths, checksum: checkDigit };
}

function rectsToPathData(rects: BarcodeRect[]): string {
  const parts: string[] = [];
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    parts.push(`M${r.x} ${r.y}h${r.width}v${r.height}h-${r.width}z`);
  }
  return parts.join('');
}

/**
 * Generate crisp SVG rect elements and combined single-path vector data
 * with proper quiet zones for both Code 128 and EAN-13.
 * Results are cached by input parameters to avoid redundant recalculation.
 */
export function generateBarcodeSvgElements(
  text: string,
  totalWidth: number = 220,
  height: number = 60,
  _barColor: string = '#000000',
  format: BarcodeFormat = 'CODE128'
): BarcodeElementsResult {
  const cleanInput = (text || '000000').trim();
  const cacheKey = `${cleanInput}|${totalWidth}|${height}|${format}`;
  const cached = elementsCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const quietModules = 10;

  if (format === 'EAN13') {
    const eanResult = encodeEAN13Bits(cleanInput);
    if (eanResult) {
      const { bits, normalized } = eanResult;
      const totalModules = bits.length + quietModules * 2;
      const moduleWidth = totalWidth / totalModules;
      const rects: BarcodeRect[] = [];

      let i = 0;
      while (i < bits.length) {
        if (bits[i] === '1') {
          let run = 0;
          while (i + run < bits.length && bits[i + run] === '1') {
            run++;
          }
          const isGuard = i < 3 || (i >= 45 && i < 50) || i >= 92;
          rects.push({
            x: Math.round((quietModules + i) * moduleWidth * 100) / 100,
            y: 0,
            width: Math.round(run * moduleWidth * 100) / 100,
            height: isGuard ? height + 4 : height,
          });
          i += run;
        } else {
          i++;
        }
      }

      const result: BarcodeElementsResult = {
        rects,
        pathData: rectsToPathData(rects),
        totalModules,
        displayText: normalized,
        usedFormat: 'EAN13',
      };
      setBoundedCache(elementsCache, cacheKey, result);
      return result;
    }
  }

  // Default / fallback: Code 128B
  const { widths } = encodeCode128B(cleanInput);
  let symbolModules = 0;
  for (let i = 0; i < widths.length; i++) {
    symbolModules += widths[i];
  }
  const totalModules = symbolModules + quietModules * 2;
  const moduleWidth = totalWidth / totalModules;

  const rects: BarcodeRect[] = [];
  let currentX = quietModules * moduleWidth;
  let isBar = true;

  for (let i = 0; i < widths.length; i++) {
    const w = widths[i] * moduleWidth;
    if (isBar) {
      rects.push({
        x: Math.round(currentX * 100) / 100,
        y: 0,
        width: Math.round(w * 100) / 100,
        height,
      });
    }
    currentX += w;
    isBar = !isBar;
  }

  const result: BarcodeElementsResult = {
    rects,
    pathData: rectsToPathData(rects),
    totalModules,
    displayText: cleanInput,
    usedFormat: 'CODE128',
  };
  setBoundedCache(elementsCache, cacheKey, result);
  return result;
}

/**
 * Generate a lightweight, cached standalone SVG markup string using a single <path>
 * instead of dozens of <rect> nodes for fast multi-label preview and printing.
 */
export function generateBarcodeSvgMarkup(
  text: string,
  options?: {
    width?: number;
    height?: number;
    showText?: boolean;
    format?: BarcodeFormat;
    fontSize?: number;
  }
): string {
  const width = options?.width ?? 220;
  const height = options?.height ?? 44;
  const showText = options?.showText ?? true;
  const format = options?.format ?? 'CODE128';
  const fontSize = options?.fontSize ?? 11;
  const cleanText = (text || '000000').trim();

  const markupKey = `${cleanText}|${width}|${height}|${showText ? 1 : 0}|${format}|${fontSize}`;
  const cachedMarkup = svgMarkupCache.get(markupKey);
  if (cachedMarkup) {
    return cachedMarkup;
  }

  const { pathData, displayText } = generateBarcodeSvgElements(
    cleanText,
    width,
    height,
    '#000000',
    format
  );

  const extraHeight = showText ? Math.max(14, fontSize + 5) : 4;
  const totalSvgHeight = height + extraHeight;

  const safeText = displayText
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  const textTag = showText
    ? `<text x="${width / 2}" y="${height + fontSize + 2}" text-anchor="middle" fill="#000000" font-size="${fontSize}" font-family="'JetBrains Mono',monospace" font-weight="700" letter-spacing="1.5">${safeText}</text>`
    : '';

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${totalSvgHeight}" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" style="display:block;max-width:100%;max-height:100%;shape-rendering:crispEdges;background:#ffffff;"><path fill="#000000" d="${pathData}"/>${textTag}</svg>`;

  setBoundedCache(svgMarkupCache, markupKey, svg);
  return svg;
}

/**
 * Generate Apparel-compliant SKU automatically
 */
export function generateClothingSku(
  productName: string,
  _category: string,
  color?: string,
  size?: string
): string {
  const words = productName
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, '')
    .trim()
    .split(/\s+/);

  let basePrefix = words[0] || 'PRD';
  if (words.length > 1 && words[1].length >= 3) {
    basePrefix = words[words.length - 1];
  }
  basePrefix = basePrefix.slice(0, 5);

  const cleanColor = color
    ? color.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3)
    : '';

  const cleanSize = size
    ? size.toUpperCase().replace(/\s+/g, '')
    : '';

  const parts = [basePrefix];
  if (cleanColor) parts.push(cleanColor);
  if (cleanSize) parts.push(cleanSize);

  return parts.join('-');
}

/**
 * Generate a standard retail 13-digit EAN-13 barcode
 */
export function generateRetailBarcode(prefix: string = '890'): string {
  const randomPart = Math.floor(100000000 + Math.random() * 900000000).toString();
  const raw = `${prefix}${randomPart}`.slice(0, 12);
  return calculateEAN13CheckDigit(raw);
}
