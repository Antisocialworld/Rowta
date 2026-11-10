// Poppins weight -> registered family name (rule U11g: the fonts are loaded before first paint in app/App.tsx).
// expo-google-fonts registers ONE family per weight, and React Native must never receive `fontWeight` together
// with those families (it would synthesise the weight from the system font instead of using the loaded file).
// Every value below is what design-system/design-variables.css declares as font-weight (500, 600) or its
// implicit 400; nothing here invents a size — sizes, line heights and letter spacing come from tokens.ts (U5).
import type { TextStyle } from 'react-native';
import { typeStyles } from './tokens';

export const POPPINS = {
  '400': 'Poppins_400Regular',
  '500': 'Poppins_500Medium',
  '600': 'Poppins_600SemiBold',
  '700': 'Poppins_700Bold',
} as const;

export type TypeStyleName = keyof typeof typeStyles;

export function familyForWeight(weight: string): string {
  if (weight === '700') return POPPINS['700'];
  if (weight === '600') return POPPINS['600'];
  if (weight === '500') return POPPINS['500'];
  return POPPINS['400'];
}

/**
 * Maps one design-system type style onto React Native text props.
 * `textDecoration`/`textCase` are translated to their React Native names; `fontStretch`, `paragraphIndent`
 * and `paragraphSpacing` have no React Native equivalent on Android and are dropped on purpose.
 */
export function typeStyle(name: TypeStyleName): TextStyle {
  const raw = typeStyles[name];
  const decoration: string = raw.textDecoration;
  const casing: string = raw.textCase;
  const line: TextStyle['textDecorationLine'] =
    decoration === 'underline' ? 'underline' : decoration === 'line-through' ? 'line-through' : 'none';
  const style: TextStyle = {
    fontSize: raw.fontSize,
    lineHeight: raw.lineHeight,
    letterSpacing: raw.letterSpacing,
    fontStyle: raw.fontStyle,
    fontFamily: familyForWeight(raw.fontWeight),
    textDecorationLine: line,
    ...(casing === 'uppercase' ? { textTransform: 'uppercase' as const } : {}),
  };
  return style;
}
