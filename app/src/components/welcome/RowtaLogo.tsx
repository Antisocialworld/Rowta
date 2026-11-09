// RowtaLogo — Native logo group drawn from design tokens (PRD 6.1, rules U1, U5, X1).
// Shared between the animated welcome screen and the static logo.
// Sizes and coordinates are scaled from GEOMETRY design units via SCALE.
import type { StyleProp, ViewStyle } from 'react-native';
import { StyleSheet, View } from 'react-native';
import Animated, { type AnimatedStyle } from 'react-native-reanimated';
import { colors } from '../../theme/tokens';
import { familyForWeight } from '../../theme/fonts';
import { t } from '../../i18n/en';
import { GEOMETRY, SCALE, type LetterKey } from '../../lib/welcome-logic';

export type RowtaLogoProps = {
  style?: StyleProp<ViewStyle>;
  animatedPageStyle?: StyleProp<AnimatedStyle<ViewStyle>>;
  animatedLetterStyles?: Partial<Record<LetterKey, StyleProp<AnimatedStyle<ViewStyle>>>>;
  animatedWordmarkStyles?: Partial<Record<string, StyleProp<AnimatedStyle<ViewStyle>>>>;
};

const boldFontFamily = familyForWeight('700');

// Design geometry scaled to runtime points
const tileWidth = GEOMETRY.tile.size * SCALE;
const tileHeight = GEOMETRY.tile.size * SCALE;
const tileRadius = GEOMETRY.tile.radius * SCALE;

const pageX = GEOMETRY.page.x * SCALE;
const pageY = GEOMETRY.page.y * SCALE;
const pageWidth = GEOMETRY.page.width * SCALE;
const pageHeight = GEOMETRY.page.height * SCALE;
const pageRadius = GEOMETRY.page.radius * SCALE;

const baseStripX = GEOMETRY.baseStrip.x * SCALE;
const baseStripY = GEOMETRY.baseStrip.y * SCALE;
const baseStripWidth = GEOMETRY.baseStrip.width * SCALE;
const baseStripHeight = GEOMETRY.baseStrip.height * SCALE;
const baseStripRadius = GEOMETRY.baseStrip.radius * SCALE;

const letterTileSize = GEOMETRY.letterTile.size * SCALE;
const letterTileRadius = GEOMETRY.letterTile.radius * SCALE;
const letterGlyphSize = GEOMETRY.letterTile.glyphSize * SCALE;

const wordmarkFontSize = GEOMETRY.wordmark.fontSizeRatio * GEOMETRY.tile.size * SCALE;
const wordmarkBaselineTop = GEOMETRY.wordmark.baselineY * SCALE - wordmarkFontSize;

export function RowtaLogo({
  style,
  animatedPageStyle,
  animatedLetterStyles,
  animatedWordmarkStyles,
}: RowtaLogoProps) {
  return (
    <View
      accessible={true}
      accessibilityLabel={t('brand.logo')}
      style={[styles.container, style]}
    >
      {/* Tile */}
      <View
        accessibilityElementsHidden={true}
        importantForAccessibility="no-hide-descendants"
        style={[
          styles.tile,
          {
            width: tileWidth,
            height: tileHeight,
            borderRadius: tileRadius,
            backgroundColor: colors['color-primary'],
          },
        ]}
      >
        {/* Base Strip (drawn underneath the page) */}
        <Animated.View
          style={[
            styles.baseStrip,
            {
              left: baseStripX,
              top: baseStripY,
              width: baseStripWidth,
              height: baseStripHeight,
              borderRadius: baseStripRadius,
              backgroundColor: colors['color-pry-90'],
            },
            animatedPageStyle,
          ]}
        />

        {/* Page */}
        <Animated.View
          style={[
            styles.page,
            {
              left: pageX,
              top: pageY,
              width: pageWidth,
              height: pageHeight,
              borderRadius: pageRadius,
              backgroundColor: colors['color-pry-100'],
            },
            animatedPageStyle,
          ]}
        />

        {/* Letter Tiles: R, O, W, T, A */}
        {(Object.keys(GEOMETRY.letters) as LetterKey[]).map((key) => {
          const letter = GEOMETRY.letters[key];
          const posX = letter.x * SCALE;
          const posY = letter.y * SCALE;
          const letterAnimatedStyle = animatedLetterStyles?.[key];

          return (
            <Animated.View
              key={key}
              style={[
                styles.letterTile,
                {
                  left: posX,
                  top: posY,
                  width: letterTileSize,
                  height: letterTileSize,
                  borderRadius: letterTileRadius,
                  backgroundColor: colors['color-primary'],
                },
                letterAnimatedStyle,
              ]}
            >
              <Animated.Text
                style={[
                  styles.letterGlyph,
                  {
                    fontFamily: boldFontFamily,
                    fontSize: letterGlyphSize,
                    lineHeight: letterTileSize,
                    color: colors['color-on-primary'],
                  },
                ]}
              >
                {letter.char}
              </Animated.Text>
            </Animated.View>
          );
        })}
      </View>

      {/* Wordmark "Rowta" */}
      <View
        accessibilityElementsHidden={true}
        importantForAccessibility="no-hide-descendants"
        style={[
          styles.wordmarkRow,
          {
            top: wordmarkBaselineTop,
            width: tileWidth,
          },
        ]}
      >
        {GEOMETRY.wordmark.letters.map((char, index) => {
          const charAnimatedStyle = animatedWordmarkStyles?.[char];
          return (
            <Animated.Text
              key={`${char}-${index}`}
              style={[
                styles.wordmarkChar,
                {
                  fontFamily: boldFontFamily,
                  fontSize: wordmarkFontSize,
                  color: colors['color-primary'],
                },
                charAnimatedStyle,
              ]}
            >
              {char}
            </Animated.Text>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
  },
  tile: {
    position: 'relative',
    overflow: 'hidden',
  },
  baseStrip: {
    position: 'absolute',
  },
  page: {
    position: 'absolute',
  },
  letterTile: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  letterGlyph: {
    textAlign: 'center',
    textAlignVertical: 'center',
    includeFontPadding: false,
  },
  wordmarkRow: {
    position: 'absolute',
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'baseline',
  },
  wordmarkChar: {
    includeFontPadding: false,
  },
});

