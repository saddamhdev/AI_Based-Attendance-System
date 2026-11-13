import React, { useState } from 'react';
import {
  ActivityIndicator, FlatList, Image, KeyboardAvoidingView, Modal, Platform, Pressable, RefreshControl,
  ScrollView, StyleSheet, Text, TextInput, View, type StyleProp, type TextInputProps, type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useQuery } from '@tanstack/react-query';

import { ApiError, describeError } from '../api/client';
import { describePhotoFailure, loadPrivateImage, privateImageKey } from '../api/privateImages';
import { useAuth } from '../auth/AuthProvider';
import { colors, radius, space, touch } from './theme';

export function Screen({ children, refreshing, onRefresh, scroll = true, padded = true }: {
  children: React.ReactNode; refreshing?: boolean; onRefresh?: () => void; scroll?: boolean; padded?: boolean;
}) {
  const content = <View style={[padded && styles.padded]}>{children}</View>;
  return (
    <SafeAreaView style={styles.screen} edges={['left', 'right']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {scroll ? (
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingBottom: 48 }}
            refreshControl={onRefresh ? <RefreshControl refreshing={Boolean(refreshing)} onRefresh={onRefresh} /> : undefined}
          >
            {content}
          </ScrollView>
        ) : content}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export function H1({ children }: { children: React.ReactNode }) {
  return <Text accessibilityRole="header" style={styles.h1}>{children}</Text>;
}
export function H2({ children }: { children: React.ReactNode }) {
  return <Text accessibilityRole="header" style={styles.h2}>{children}</Text>;
}
export function Body({ children, style }: { children: React.ReactNode; style?: StyleProp<any> }) {
  return <Text style={[styles.body, style]}>{children}</Text>;
}
export function Muted({ children, style }: { children: React.ReactNode; style?: StyleProp<any> }) {
  return <Text style={[styles.muted, style]}>{children}</Text>;
}

export function Card({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Row({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.row, style]}>{children}</View>;
}

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
export function Button({ title, onPress, variant = 'primary', disabled, loading, accessibilityHint, style }: {
  title: string; onPress?: () => void; variant?: ButtonVariant; disabled?: boolean; loading?: boolean;
  accessibilityHint?: string; style?: StyleProp<ViewStyle>;
}) {
  const inactive = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: Boolean(inactive), busy: Boolean(loading) }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [styles.button, buttonVariants[variant], inactive && styles.disabled, pressed && styles.pressed, style]}
    >
      {loading ? <ActivityIndicator color={variant === 'primary' || variant === 'danger' ? '#fff' : colors.primary} /> : null}
      <Text style={[styles.buttonText, { color: variant === 'primary' || variant === 'danger' ? '#fff' : colors.primary }]}>
        {title}
      </Text>
    </Pressable>
  );
}

export function Field({ label, error, hint, ...props }: TextInputProps & { label: string; error?: string; hint?: string }) {
  return (
    <View style={{ marginBottom: space.md }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={colors.subtle}
        style={[styles.input, error ? { borderColor: colors.danger } : null]}
        {...props}
      />
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      {error ? <Text style={styles.fieldError}>{error}</Text> : null}
    </View>
  );
}

export function Checkbox({ checked, onChange, label, disabled }: {
  checked: boolean; onChange: (value: boolean) => void; label: string; disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled }}
      accessibilityLabel={label}
      disabled={disabled}
      onPress={() => onChange(!checked)}
      style={styles.checkRow}
    >
      <View style={[styles.checkbox, checked && styles.checkboxOn]}>{checked ? <Text style={styles.checkMark}>✓</Text> : null}</View>
      <Text style={[styles.body, { flex: 1 }]}>{label}</Text>
    </Pressable>
  );
}

type Tone = 'info' | 'error' | 'success' | 'warning';
const toneColors: Record<Tone, { bg: string; fg: string }> = {
  info: { bg: colors.primarySoft, fg: colors.primaryDark },
  error: { bg: colors.dangerSoft, fg: colors.danger },
  success: { bg: colors.successSoft, fg: colors.success },
  warning: { bg: colors.warningSoft, fg: colors.warning },
};
export function Banner({ tone = 'info', title, children, action }: {
  tone?: Tone; title?: string; children?: React.ReactNode; action?: { label: string; onPress: () => void };
}) {
  const palette = toneColors[tone];
  return (
    <View accessibilityRole={tone === 'error' ? 'alert' : undefined} style={[styles.banner, { backgroundColor: palette.bg }]}>
      {title ? <Text style={[styles.bannerTitle, { color: palette.fg }]}>{title}</Text> : null}
      {typeof children === 'string' ? <Text style={{ color: palette.fg }}>{children}</Text> : children}
      {action ? <Button title={action.label} variant="ghost" onPress={action.onPress} style={{ alignSelf: 'flex-start' }} /> : null}
    </View>
  );
}

export function ErrorBanner({ error, onRetry, title = 'Something needs attention' }: {
  error: unknown; onRetry?: () => void; title?: string;
}) {
  if (!error) return null;
  const titleText = error instanceof ApiError
    ? error.kind === 'network' ? 'No connection'
      : error.kind === 'timeout' ? 'Timed out'
        : error.status === 503 || error.status === 502 ? 'Service unavailable'
          : error.status === 403 ? 'Not allowed' : title
    : title;
  return (
    <Banner tone="error" title={titleText} action={onRetry ? { label: 'Retry', onPress: onRetry } : undefined}>
      {describeError(error)}
    </Banner>
  );
}

export function Pill({ label, tone = 'info' }: { label: string; tone?: Tone | 'neutral' }) {
  const palette = tone === 'neutral' ? { bg: colors.divider, fg: colors.muted } : toneColors[tone];
  return (
    <View style={[styles.pill, { backgroundColor: palette.bg }]}>
      <Text style={[styles.pillText, { color: palette.fg }]}>{label}</Text>
    </View>
  );
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <View accessibilityRole="progressbar" accessibilityLabel={label} style={styles.center}>
      <ActivityIndicator color={colors.primary} />
      <Muted>{label}</Muted>
    </View>
  );
}

export function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>{title}</Text>
      {children ? <Muted style={{ textAlign: 'center' }}>{children}</Muted> : null}
    </View>
  );
}

/** Generic query-state wrapper: loading → error with retry → content. */
export function QueryView<T>({ query, children, loadingLabel }: {
  query: { data?: T; error: unknown; isPending: boolean; refetch: () => unknown };
  children: (data: T) => React.ReactNode; loadingLabel?: string;
}) {
  if (query.isPending) return <Loading label={loadingLabel} />;
  if (query.error && query.data === undefined) return <ErrorBanner error={query.error} onRetry={() => void query.refetch()} />;
  return (
    <>
      {query.error ? <ErrorBanner error={query.error} onRetry={() => void query.refetch()} title="Could not refresh" /> : null}
      {children(query.data as T)}
    </>
  );
}

/**
 * Private (biometric) photo. Bytes are fetched with the signed-in account's bearer token through
 * the API client and shown from memory; the native image loader never receives credentials.
 * Cached per account and photo path, and cleared on logout.
 */
export function SecureImage({ path, style, accessibilityLabel }: { path: string; style: StyleProp<any>; accessibilityLabel: string }) {
  const { state } = useAuth();
  const owner = state.status === 'signedIn' ? `${state.me.role}:${state.me.username.toLowerCase()}` : 'signed-out';
  const image = useQuery({
    queryKey: privateImageKey(owner, path),
    queryFn: ({ signal }) => loadPrivateImage(path, signal),
    enabled: state.status === 'signedIn',
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
  });
  const [decodeFailed, setDecodeFailed] = useState<string | null>(null);

  if (image.isPending) {
    return (
      <View style={[style, styles.imageFallback]} accessibilityLabel={`${accessibilityLabel}: loading`}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }
  if (image.error || !image.data || decodeFailed === image.data) {
    const failure = image.error ? describePhotoFailure(image.error)
      : { title: 'Damaged', detail: 'This photo file could not be decoded.', retryable: true };
    return (
      <Pressable
        accessibilityRole={failure.retryable ? 'button' : undefined}
        accessibilityLabel={`${accessibilityLabel}: ${failure.title}. ${failure.detail}${failure.retryable ? ' Tap to retry.' : ''}`}
        disabled={!failure.retryable || image.isFetching}
        onPress={() => { setDecodeFailed(null); void image.refetch(); }}
        style={[style, styles.imageFallback, styles.imageError]}
      >
        {image.isFetching ? <ActivityIndicator color={colors.primary} /> : (
          <>
            <Text style={styles.imageErrorTitle}>{failure.title}</Text>
            <Text style={styles.imageErrorDetail} numberOfLines={3}>{failure.detail}</Text>
            {failure.retryable ? <Text style={styles.imageRetry}>Tap to retry</Text> : null}
          </>
        )}
      </Pressable>
    );
  }
  return (
    <Image
      accessibilityLabel={accessibilityLabel}
      source={{ uri: image.data }}
      style={style}
      onError={() => setDecodeFailed(image.data)}
    />
  );
}

export type Option = { value: string; label: string; detail?: string };
/** Searchable single-choice picker in a modal sheet. */
export function Select({ label, value, options, onChange, placeholder = 'Select…', disabled }: {
  label: string; value: string | null | undefined; options: Option[]; onChange: (value: string) => void;
  placeholder?: string; disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const current = options.find(option => option.value === value);
  const filtered = options.filter(option => !search
    || `${option.label} ${option.detail ?? ''}`.toLowerCase().includes(search.toLowerCase()));
  return (
    <View style={{ marginBottom: space.md }}>
      <Text style={styles.label}>{label}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${current?.label ?? placeholder}`}
        disabled={disabled}
        onPress={() => setOpen(true)}
        style={[styles.input, styles.selectBox, disabled && styles.disabled]}
      >
        <Text style={{ color: current ? colors.text : colors.subtle, flex: 1 }}>{current?.label ?? placeholder}</Text>
        <Text style={{ color: colors.muted }}>▾</Text>
      </Pressable>
      <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <SafeAreaView style={[styles.screen, { padding: space.lg }]}>
          <H2>{label}</H2>
          {options.length > 6 ? (
            <TextInput placeholder="Search" value={search} onChangeText={setSearch} style={[styles.input, { marginBottom: space.md }]}
              accessibilityLabel={`Search ${label}`} />
          ) : null}
          <FlatList
            data={filtered}
            keyExtractor={item => item.value}
            ListEmptyComponent={<Empty title="Nothing to choose" />}
            renderItem={({ item }) => (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: item.value === value }}
                onPress={() => { onChange(item.value); setOpen(false); setSearch(''); }}
                style={[styles.option, item.value === value && { backgroundColor: colors.primarySoft }]}
              >
                <Text style={styles.body}>{item.label}</Text>
                {item.detail ? <Muted>{item.detail}</Muted> : null}
              </Pressable>
            )}
          />
          <Button title="Close" variant="secondary" onPress={() => setOpen(false)} />
        </SafeAreaView>
      </Modal>
    </View>
  );
}

export function KeyValue({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <View style={styles.kv}>
      <Muted>{label}</Muted>
      <Text style={[styles.body, { flexShrink: 1, textAlign: 'right' }]}>{value ?? '—'}</Text>
    </View>
  );
}

export function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <View style={styles.stat}>
      <Muted>{label}</Muted>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

export function ListItem({ title, subtitle, right, onPress }: {
  title: string; subtitle?: string; right?: React.ReactNode; onPress?: () => void;
}) {
  return (
    <Pressable accessibilityRole={onPress ? 'button' : undefined} onPress={onPress} disabled={!onPress}
      style={({ pressed }) => [styles.listItem, pressed && styles.pressed]}>
      <View style={{ flex: 1 }}>
        <Text style={styles.listTitle}>{title}</Text>
        {subtitle ? <Muted>{subtitle}</Muted> : null}
      </View>
      {right}
      {onPress ? <Text style={{ color: colors.subtle, fontSize: 20 }}>›</Text> : null}
    </Pressable>
  );
}

const buttonVariants: Record<ButtonVariant, ViewStyle> = {
  primary: { backgroundColor: colors.primary },
  secondary: { backgroundColor: colors.primarySoft },
  danger: { backgroundColor: colors.danger },
  ghost: { backgroundColor: 'transparent', paddingHorizontal: 0 },
};

export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  padded: { padding: space.lg },
  h1: { fontSize: 26, fontWeight: '800', color: colors.text, marginBottom: space.sm },
  h2: { fontSize: 19, fontWeight: '700', color: colors.text, marginVertical: space.sm },
  body: { fontSize: 15, color: colors.text, lineHeight: 21 },
  muted: { fontSize: 13, color: colors.muted, lineHeight: 18 },
  card: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radius.lg, padding: space.lg, marginBottom: space.lg },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' },
  button: { minHeight: touch, borderRadius: radius.md, paddingHorizontal: space.lg, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: space.sm, marginVertical: space.xs },
  buttonText: { fontSize: 15, fontWeight: '700' },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.75 },
  label: { fontSize: 13, fontWeight: '600', color: colors.text, marginBottom: space.xs },
  input: { minHeight: touch, borderWidth: 1, borderColor: '#d7deeb', borderRadius: radius.sm, paddingHorizontal: space.md, backgroundColor: colors.surface, color: colors.text, fontSize: 15 },
  hint: { fontSize: 12, color: colors.subtle, marginTop: 2 },
  fieldError: { fontSize: 12, color: colors.danger, marginTop: 2 },
  checkRow: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start', minHeight: touch, paddingVertical: space.sm },
  checkbox: { width: 26, height: 26, borderRadius: 6, borderWidth: 2, borderColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  checkboxOn: { backgroundColor: colors.primary },
  checkMark: { color: '#fff', fontWeight: '800' },
  banner: { borderRadius: radius.md, padding: space.md, marginBottom: space.md, gap: space.xs },
  bannerTitle: { fontWeight: '700' },
  pill: { borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4, alignSelf: 'flex-start' },
  pillText: { fontSize: 11, fontWeight: '700' },
  center: { padding: space.xl, alignItems: 'center', gap: space.sm },
  empty: { padding: space.xl, alignItems: 'center', gap: space.xs },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: colors.text, textAlign: 'center' },
  imageFallback: { backgroundColor: colors.divider, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  imageError: { padding: 4, borderWidth: 1, borderColor: colors.border },
  imageErrorTitle: { fontSize: 12, fontWeight: '700', color: colors.danger, textAlign: 'center' },
  imageErrorDetail: { fontSize: 10, color: colors.muted, textAlign: 'center' },
  imageRetry: { fontSize: 10, fontWeight: '700', color: colors.primary, marginTop: 2 },
  selectBox: { flexDirection: 'row', alignItems: 'center' },
  option: { minHeight: touch, paddingVertical: space.md, paddingHorizontal: space.sm, borderBottomWidth: 1, borderBottomColor: colors.divider },
  kv: { flexDirection: 'row', justifyContent: 'space-between', gap: space.md, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.divider },
  stat: { flexGrow: 1, flexBasis: '45%', backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: space.md },
  statValue: { fontSize: 26, fontWeight: '800', color: colors.text },
  listItem: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 56, paddingVertical: space.md, borderBottomWidth: 1, borderBottomColor: colors.divider },
  listTitle: { fontSize: 15, fontWeight: '600', color: colors.text },
});
