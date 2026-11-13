import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import React, { useState } from 'react';

import { staff } from '../api/endpoints';
import { Banner, Button, Card, ErrorBanner, Field, H2, Muted, QueryView, Screen } from '../ui/components';

/** Per-account threshold stored by Spring Boot and sent with each analysis request (never global). */
export default function RecognitionSettingsScreen() {
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: ['staff', 'recognition-settings'], queryFn: staff.recognitionSettings });
  // null = not edited; show the saved value.
  const [draft, setDraft] = useState<string | null>(null);
  const value = draft ?? (settings.data ? String(settings.data.threshold) : '');
  const setValue = (next: string) => setDraft(next);
  const onSuccess = (data: { threshold: number; saved: boolean }) => {
    queryClient.setQueryData(['staff', 'recognition-settings'], data);
    setDraft(null);
  };
  const save = useMutation({ mutationFn: (threshold: number) => staff.saveThreshold(threshold), onSuccess });
  const reset = useMutation({ mutationFn: staff.resetThreshold, onSuccess });
  const parsed = Number(value);
  const valid = value.trim() !== '' && Number.isFinite(parsed) && parsed >= 1 && parsed <= 100;

  return (
    <Screen>
      <QueryView query={settings}>
        {data => (
          <Card>
            <H2>Minimum similarity threshold</H2>
            <Muted>
              Faces whose similarity is at or above this value (inclusive) are suggested as matches. Higher values
              require stronger similarity and leave more faces for manual review. Similarity is a comparison score,
              not an accuracy probability. Changes apply to your future analyses only; saved analyses keep the
              threshold they used.
            </Muted>
            <Field label="Threshold (%)" value={value} onChangeText={setValue} keyboardType="decimal-pad"
              error={value && !valid ? 'Enter a number from 1 to 100.' : undefined} />
            <Banner tone="info">{`Current: ${data.threshold}%${data.saved ? ' (saved for your account)' : ' (default)'}`}</Banner>
            <ErrorBanner error={save.error ?? reset.error} title="Not saved" />
            {save.isSuccess ? <Banner tone="success">Saved.</Banner> : null}
            <Button title="Save threshold" disabled={!valid} loading={save.isPending} onPress={() => save.mutate(parsed)} />
            <Button title="Reset to default" variant="secondary" loading={reset.isPending} onPress={() => reset.mutate()} />
          </Card>
        )}
      </QueryView>
    </Screen>
  );
}
