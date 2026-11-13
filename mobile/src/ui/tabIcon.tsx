import React from 'react';
import { Text, type ColorValue } from 'react-native';

/** Text glyph tab icon; avoids bundling an icon font. The tab label carries the accessible name. */
export const tabIcon = (glyph: string) => function TabIcon({ color }: { color: ColorValue }) {
  return <Text style={{ color, fontSize: 18 }} accessibilityElementsHidden importantForAccessibility="no">{glyph}</Text>;
};
