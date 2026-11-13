import DateTimePicker, { DateTimePickerAndroid, type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import React, { useState } from 'react';
import { Modal, Platform, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, H2, styles } from './components';
import { isoDate, isoTime } from './format';
import { colors, space } from './theme';

function toDate(value: string, mode: 'date' | 'time'): Date {
  const now = new Date();
  if (!value) return now;
  if (mode === 'date') {
    const [y, m, d] = value.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  const [h, min] = value.split(':').map(Number);
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, min);
}

/** Date (YYYY-MM-DD) or time (HH:MM) field using the native picker. Empty string means unset. */
export function DateField({ label, value, onChange, mode = 'date', clearable }: {
  label: string; value: string; onChange: (value: string) => void; mode?: 'date' | 'time'; clearable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Date>(toDate(value, mode));
  const format = (date: Date) => (mode === 'date' ? isoDate(date) : isoTime(date));

  function show() {
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        value: toDate(value, mode),
        mode,
        is24Hour: true,
        onChange: (event: DateTimePickerEvent, date?: Date) => {
          if (event.type === 'set' && date) onChange(format(date));
        },
      });
    } else {
      setDraft(toDate(value, mode));
      setOpen(true);
    }
  }

  return (
    <View style={{ marginBottom: space.md, flexGrow: 1, flexBasis: '45%' }}>
      <Text style={styles.label}>{label}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${value || 'not set'}`} onPress={show}
        style={[styles.input, styles.selectBox]}>
        <Text style={{ flex: 1, color: value ? colors.text : colors.subtle }}>{value || (mode === 'date' ? 'Any date' : 'Any time')}</Text>
        {clearable && value ? (
          <Pressable accessibilityRole="button" accessibilityLabel={`Clear ${label}`} hitSlop={12} onPress={() => onChange('')}>
            <Text style={{ color: colors.muted, fontSize: 18 }}>×</Text>
          </Pressable>
        ) : null}
      </Pressable>
      {Platform.OS === 'ios' ? (
        <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
          <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.3)' }}>
            <SafeAreaView edges={['bottom']} style={{ backgroundColor: colors.surface, padding: space.lg }}>
              <H2>{label}</H2>
              <DateTimePicker value={draft} mode={mode} display="spinner" onChange={(_, date) => date && setDraft(date)} />
              <Button title="Done" onPress={() => { onChange(format(draft)); setOpen(false); }} />
              <Button title="Cancel" variant="secondary" onPress={() => setOpen(false)} />
            </SafeAreaView>
          </View>
        </Modal>
      ) : null}
    </View>
  );
}
