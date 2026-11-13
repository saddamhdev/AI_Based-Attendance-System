import React, { useMemo, useRef, useState } from 'react';
import { Animated, Image, Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { GestureDetector, usePanGesture, usePinchGesture, useSimultaneousGestures } from 'react-native-gesture-handler';

import type { FaceResult, RecognitionPhoto } from '../../api/types';
import { detectionKey, type FaceSelection } from '../../review/attendanceReview';
import { boxToView, dimensionsMatch, fitImage } from '../../review/sessionReview';
import { Banner, Button, Muted, Row } from '../../ui/components';
import { colors, radius } from '../../ui/theme';

const MAX_HEIGHT = 420;
const MIN_SCALE = 1;
const MAX_SCALE = 5;

export function boxColor(face: FaceResult, selection: FaceSelection | undefined, conflicted: boolean): string {
  if (conflicted) return colors.danger;
  if (selection?.source === 'MANUAL') return colors.primary;
  if (selection?.source === 'AI') return colors.success;
  if (face.status === 'UNCERTAIN' || face.status === 'LOW_QUALITY') return colors.focus;
  return '#ffffff';
}

/**
 * Shows the exact uploaded JPEG with face boxes. Boxes are positioned in the analyzed image's
 * pixel space (imageWidth/imageHeight from the server), scaled by the same contain-fit as the
 * image, and rendered inside the same transformed view, so zoom and pan move both together.
 */
export function PhotoViewer({ uri, localSize, photo, sessionId, selections, conflicts, selectedKey, onSelectFace }: {
  uri: string | null;
  localSize?: { width?: number; height?: number };
  photo: RecognitionPhoto | null;
  sessionId: string;
  selections: Record<string, FaceSelection>;
  conflicts: Set<string>;
  selectedKey: string | null;
  onSelectFace: (key: string) => void;
}) {
  const [containerWidth, setContainerWidth] = useState(0);
  const [zoomed, setZoomed] = useState(false);
  const [scale] = useState(() => new Animated.Value(1));
  const [translateX] = useState(() => new Animated.Value(0));
  const [translateY] = useState(() => new Animated.Value(0));
  const gesture = useRef({ scale: 1, baseScale: 1, x: 0, y: 0, baseX: 0, baseY: 0 });

  const width = photo?.imageWidth ?? localSize?.width ?? 0;
  const height = photo?.imageHeight ?? localSize?.height ?? 0;
  const fit = useMemo(() => fitImage(width, height, containerWidth, MAX_HEIGHT), [width, height, containerWidth]);

  const clamp = (value: number, limit: number) => Math.max(-limit, Math.min(limit, value));
  const apply = () => {
    const state = gesture.current;
    const limitX = (fit.width * (state.scale - 1)) / 2;
    const limitY = (fit.height * (state.scale - 1)) / 2;
    state.x = clamp(state.x, limitX);
    state.y = clamp(state.y, limitY);
    scale.setValue(state.scale);
    translateX.setValue(state.x);
    translateY.setValue(state.y);
  };
  const setZoom = (next: number) => {
    gesture.current.scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, next));
    if (gesture.current.scale === 1) { gesture.current.x = 0; gesture.current.y = 0; }
    apply();
    setZoomed(gesture.current.scale > 1);
  };

  const zoomBy = (factor: number) => setZoom(gesture.current.scale * factor);

  const pinch = usePinchGesture({
    runOnJS: true,
    disableReanimated: true,
    onActivate: () => { gesture.current.baseScale = gesture.current.scale; },
    onUpdate: event => {
      gesture.current.scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, gesture.current.baseScale * event.scale));
      apply();
    },
    onDeactivate: () => setZoom(gesture.current.scale),
  });
  const pan = usePanGesture({
    runOnJS: true,
    disableReanimated: true,
    // Only pan while zoomed so the page can still scroll normally.
    enabled: zoomed,
    onActivate: () => { gesture.current.baseX = gesture.current.x; gesture.current.baseY = gesture.current.y; },
    onUpdate: event => {
      gesture.current.x = gesture.current.baseX + event.translationX;
      gesture.current.y = gesture.current.baseY + event.translationY;
      apply();
    },
  });
  const gestures = useSimultaneousGestures(pinch, pan);

  const onLayout = (event: LayoutChangeEvent) => setContainerWidth(event.nativeEvent.layout.width);

  if (!uri) {
    return (
      <View style={styles.placeholder} onLayout={onLayout}>
        <Muted style={{ textAlign: 'center' }}>
          {photo ? 'This analysis was saved earlier. Add the same photos again to see face boxes, or review the face list below.'
            : 'Add classroom photos to see face detection boxes. You can also take attendance manually.'}
        </Muted>
      </View>
    );
  }

  return (
    <View>
      {photo && localSize && !dimensionsMatch(localSize, photo) ? (
        <Banner tone="warning">The analyzed image size differs from this preview; box positions may be approximate.</Banner>
      ) : null}
      <View style={[styles.frame, { height: fit.height || 200 }]} onLayout={onLayout}>
        <GestureDetector gesture={gestures}>
          <Animated.View style={{ width: fit.width, height: fit.height, transform: [{ translateX }, { translateY }, { scale }] }}>
            <Image source={{ uri }} style={{ width: fit.width, height: fit.height }} accessibilityLabel="Classroom photo" />
            {photo?.results.map(face => {
              const key = detectionKey(sessionId, photo.photoId, String(face.faceId));
              const selection = selections[key];
              const conflicted = conflicts.has(key);
              const box = boxToView(face.boundingBox, fit);
              const color = boxColor(face, selection, conflicted);
              const selected = key === selectedKey;
              return (
                <Pressable key={key} accessibilityRole="button" accessibilityLabel={`Face ${face.faceNumber}, ${face.status}`}
                  onPress={() => onSelectFace(key)} hitSlop={6}
                  style={[styles.box, { left: box.left, top: box.top, width: box.width, height: box.height, borderColor: color },
                    selected && styles.boxSelected]}>
                  <Text style={[styles.boxLabel, { backgroundColor: color }]}>{face.faceNumber}</Text>
                </Pressable>
              );
            })}
          </Animated.View>
        </GestureDetector>
      </View>
      <Row>
        <Button title="−" variant="secondary" onPress={() => zoomBy(1 / 1.5)} accessibilityHint="Zoom out" />
        <Button title="+" variant="secondary" onPress={() => zoomBy(1.5)} accessibilityHint="Zoom in" />
        <Button title="Reset zoom" variant="ghost" onPress={() => setZoom(1)} />
        <Muted>Pinch to zoom; drag to pan when zoomed.</Muted>
      </Row>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { overflow: 'hidden', alignItems: 'center', justifyContent: 'center', backgroundColor: '#0b1020', borderRadius: radius.md },
  placeholder: { minHeight: 140, alignItems: 'center', justifyContent: 'center', padding: 16, backgroundColor: colors.divider, borderRadius: radius.md },
  box: { position: 'absolute', borderWidth: 2 },
  boxSelected: { borderWidth: 4 },
  boxLabel: { position: 'absolute', top: -18, left: -2, minWidth: 18, paddingHorizontal: 3, fontSize: 11, fontWeight: '800', color: '#0b1020', textAlign: 'center' },
});
