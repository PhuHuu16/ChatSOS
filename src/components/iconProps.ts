// Shared attributes of the line icons (24×24 outline, drawn in the text colour). Spread
// onto an <svg> and override the size where needed, e.g. <svg {...ICON_PROPS} width={16}>.
export const ICON_PROPS = {
  'aria-hidden': true,
  width: 18,
  height: 18,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const
