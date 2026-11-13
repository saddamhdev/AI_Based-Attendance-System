import React from 'react';
import { ActivityIndicator, Image, StyleSheet, Text, View } from 'react-native';

import { Banner, Button, Muted, Row } from '../ui/components';
import { colors, radius, space } from '../ui/theme';
import { PROFILE, type PhotoProfile } from './rules';
import type { PhotoSet } from './usePhotoSet';

const statusLabel = { selected: 'Selected', preparing: 'Preparing preview…', ready: 'Preview ready', invalid: 'Needs attention' };

/** Selected photos with per-photo status, issue, and remove/replace actions. */
export function PhotoTray({ set, profile, disabled }: { set: PhotoSet; profile: PhotoProfile; disabled?: boolean }) {
  const { min, max } = PROFILE[profile];
  return (
    <View>
      <Muted>
        {profile === 'enrollment'
          ? `Add ${min}–${max} photos. Each photo must show exactly one face — only the student — looking at the camera.`
          : `Add ${min}–${max} classroom photos. Group photos may contain many faces.`}
      </Muted>
      <Text style={styles.count} accessibilityLiveRegion="polite">
        {set.ready.length} ready · {set.items.length} of {max} selected
      </Text>
      <Row>
        <Button title="Take photo" onPress={() => void set.fromCamera()} disabled={disabled || set.remaining <= 0}
          accessibilityHint="Opens the camera. Camera permission is requested only now." />
        <Button title="Choose from gallery" variant="secondary" onPress={() => void set.fromGallery()}
          disabled={disabled || set.remaining <= 0} />
      </Row>
      {set.items.map((item, index) => (
        <View key={item.clientId} style={[styles.item, item.status === 'invalid' && styles.itemInvalid]}>
          <View style={styles.thumbBox}>
            {item.uri ? (
              <Image source={{ uri: item.uri }} style={styles.thumb} accessibilityLabel={`Photo ${index + 1} preview`} />
            ) : item.status === 'preparing' ? <ActivityIndicator color={colors.primary} /> : <Text style={styles.noPreview}>!</Text>}
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={styles.itemTitle}>Photo {index + 1} · {item.source === 'camera' ? 'Camera' : 'Gallery'}</Text>
            <Text style={[styles.status, item.status === 'invalid' && { color: colors.danger }]}>{statusLabel[item.status]}</Text>
            {item.issue ? (
              <>
                <Text style={styles.issue}>{item.issue.message}</Text>
                <Muted>{item.issue.advice}</Muted>
              </>
            ) : null}
            {item.width && item.status === 'ready' ? <Muted>{item.width}×{item.height} · {Math.round((item.bytes ?? 0) / 1024)} KB</Muted> : null}
            <Row>
              <Button title="Remove" variant="ghost" disabled={disabled} onPress={() => set.remove(item.clientId)} />
              {item.status !== 'preparing' ? (
                <>
                  <Button title="Retake" variant="ghost" disabled={disabled} onPress={() => void set.replaceWithCamera(item.clientId)} />
                  <Button title="Replace" variant="ghost" disabled={disabled} onPress={() => void set.replaceFromGallery(item.clientId)} />
                </>
              ) : null}
            </Row>
          </View>
        </View>
      ))}
    </View>
  );
}

export function SubmitBlockers({ reasons }: { reasons: string[] }) {
  if (!reasons.length) return null;
  return (
    <Banner tone="warning" title="Submit is disabled because:">
      {reasons.map(reason => <Text key={reason} style={{ color: colors.warning }}>• {reason}</Text>)}
    </Banner>
  );
}

export type SubmissionStage = 'idle' | 'uploading' | 'processing' | 'done' | 'failed';

/** Shows only the stages the app can actually observe. */
export function UploadStages({ stage, serverStepLabel }: { stage: SubmissionStage; serverStepLabel: string }) {
  if (stage === 'idle') return null;
  const steps: { key: SubmissionStage; label: string }[] = [
    { key: 'uploading', label: 'Uploading photos' },
    { key: 'processing', label: serverStepLabel },
  ];
  const order = ['uploading', 'processing', 'done', 'failed'];
  return (
    <View style={styles.stages} accessibilityLiveRegion="polite">
      {steps.map(step => {
        const active = stage === step.key;
        const complete = order.indexOf(stage) > order.indexOf(step.key) && stage !== 'failed';
        return (
          <Row key={step.key}>
            {active ? <ActivityIndicator color={colors.primary} /> : <Text style={styles.stepMark}>{complete ? '✓' : '○'}</Text>}
            <Text style={[styles.stepText, active && { fontWeight: '700' }]}>{step.label}</Text>
          </Row>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  count: { marginVertical: space.sm, fontWeight: '600', color: colors.text },
  item: { flexDirection: 'row', gap: space.md, padding: space.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, marginTop: space.sm },
  itemInvalid: { borderColor: colors.danger, backgroundColor: colors.dangerSoft },
  thumbBox: { width: 84, height: 84, borderRadius: radius.sm, backgroundColor: colors.divider, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  thumb: { width: 84, height: 84 },
  noPreview: { fontSize: 28, color: colors.danger, fontWeight: '800' },
  itemTitle: { fontWeight: '700', color: colors.text },
  status: { color: colors.muted, fontSize: 13 },
  issue: { color: colors.danger, fontSize: 13 },
  stages: { gap: space.sm, padding: space.md, backgroundColor: colors.primarySoft, borderRadius: radius.md, marginVertical: space.sm },
  stepMark: { width: 20, textAlign: 'center', color: colors.primary, fontWeight: '800' },
  stepText: { color: colors.text },
});
