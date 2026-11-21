import browserslist from 'browserslist';
import { browserslistToTargets, transform as lightningTransform } from 'lightningcss';
import postcss, { type Plugin } from 'postcss';

export const COMPAT_BROWSERSLIST = [
  'chrome >= 88',
  'edge >= 88',
  'firefox >= 85',
  'safari >= 14',
  'ios_saf >= 14',
  'and_chr >= 88',
];

const LIGHTNING_TARGETS = browserslistToTargets(browserslist(COMPAT_BROWSERSLIST));

/**
 * PostCSS compatibility plugin for Amar Dokan Pro.
 * Runs inside Vite's native CSS pipeline (before vite:css-post), safely transforming
 * pure CSS for both development and production builds without mutating JS modules:
 * 1. Unwraps @layer rules in cascade order for Chrome < 99 / Edge < 99 / Firefox < 97 / Safari < 15.4.
 * 2. Normalizes Tailwind CSS 4 `in oklab` gradient direction tokens to standard sRGB syntax.
 * 3. Uses LightningCSS to convert OKLCH / OKLAB / LAB / LCH colors to sRGB HEX/RGBA fallbacks
 *    and apply vendor-prefixed CSS features for the target browser matrix.
 */
export function createCssCompatPostcssPlugin(): Plugin {
  return {
    postcssPlugin: 'adp-css-compat',
    OnceExit(root, { result }) {
      // 1. Preserve cascade order while removing @layer wrappers unsupported in older engines
      root.walkAtRules('layer', atRule => {
        if (atRule.nodes && atRule.nodes.length > 0) {
          atRule.replaceWith(atRule.nodes);
        } else {
          atRule.remove();
        }
      });

      // 2. Strip color-interpolation space qualifiers (e.g., "to bottom right in oklab" -> "to bottom right")
      root.walkDecls(decl => {
        if (
          decl.prop === '--tw-gradient-position' &&
          /\s+in\s+(?:oklab|oklch|lab|lch|srgb|srgb-linear|hsl|hwb|xyz(?:-d50|-d65)?)\b/i.test(
            decl.value
          )
        ) {
          decl.value = decl.value.replace(
            /\s+in\s+(?:oklab|oklch|lab|lch|srgb|srgb-linear|hsl|hwb|xyz(?:-d50|-d65)?)\b/gi,
            ''
          );
        }
      });

      const rawCss = root.toString();
      if (!rawCss.trim()) return;

      const filename =
        typeof result.opts.from === 'string' && result.opts.from
          ? result.opts.from
          : 'style.css';

      const transformed = lightningTransform({
        filename,
        code: Buffer.from(rawCss, 'utf8'),
        minify: false,
        targets: LIGHTNING_TARGETS,
        errorRecovery: true,
      });

      const nextCss = Buffer.from(transformed.code).toString('utf8');
      const parsed = postcss.parse(nextCss, { from: result.opts.from });

      root.removeAll();
      if (parsed.nodes && parsed.nodes.length > 0) {
        root.append(parsed.nodes);
      }
    },
  };
}
