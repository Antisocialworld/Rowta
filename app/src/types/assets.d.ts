// Static asset module declarations for TypeScript (Expo/Metro resolves image imports at build time; tsc needs
// to know the shape: the bundler returns the numeric asset reference RN's Image accepts).
declare module '*.png' {
  import type { ImageSourcePropType } from 'react-native';
  const source: ImageSourcePropType;
  export default source;
}
