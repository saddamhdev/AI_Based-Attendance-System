import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import React from 'react';

import { admin, staff } from '../../api/endpoints';
import { useMe } from '../../auth/AuthProvider';
import { Banner, Button, Card, Empty, H1, H2, ListItem, Muted, Pill, QueryView, Row, Screen, Stat } from '../../ui/components';
import { classTime } from '../../ui/format';

export default function StaffHome() {
  const me = useMe();
  const isAdmin = me.role === 'ADMIN';
  const offerings = useQuery({ queryKey: ['staff', 'offerings'], queryFn: () => staff.offerings() });
  const sessions = useQuery({ queryKey: ['staff', 'sessions'], queryFn: staff.sessions });
  const registrations = useQuery({
    queryKey: ['admin', 'registrations', 'PENDING_APPROVAL'], queryFn: () => admin.registrations('PENDING_APPROVAL'), enabled: isAdmin,
  });
  const faceReviews = useQuery({ queryKey: ['admin', 'face-submissions'], queryFn: admin.faceSubmissions, enabled: isAdmin });
  const drafts = (sessions.data ?? []).filter(session => session.status !== 'FINALIZED');

  return (
    <Screen refreshing={offerings.isRefetching || sessions.isRefetching}
      onRefresh={() => { void offerings.refetch(); void sessions.refetch(); void registrations.refetch(); void faceReviews.refetch(); }}>
      <H1>{isAdmin ? 'Administrator' : 'Welcome'}</H1>
      <Muted>Signed in as {me.username}</Muted>
      <Row style={{ marginVertical: 12 }}>
        <Stat label={isAdmin ? 'Active offerings' : 'My offerings'} value={offerings.data?.length ?? '…'} />
        <Stat label="Drafts awaiting review" value={sessions.data ? drafts.length : '…'} />
        {isAdmin ? <Stat label="Registration requests" value={registrations.data?.length ?? '…'} /> : null}
        {isAdmin ? <Stat label="Face reviews" value={faceReviews.data?.length ?? '…'} /> : null}
      </Row>
      {isAdmin && (registrations.data?.length || faceReviews.data?.length) ? (
        <Banner tone="warning" title="Reviews waiting" action={{ label: 'Open reviews', onPress: () => router.push('/staff/reviews') }}>
          {`${registrations.data?.length ?? 0} registration request(s) and ${faceReviews.data?.length ?? 0} face submission(s).`}
        </Banner>
      ) : null}
      <Button title="Create a session" onPress={() => router.push('/session/new')} />
      <Card>
        <H2>Drafts awaiting confirmation</H2>
        {drafts.length === 0 ? <Muted>No sessions are waiting for review.</Muted> : drafts.slice(0, 8).map(session => (
          <ListItem key={session.id} title={session.offering_label} subtitle={`${classTime(session)} · ${session.teacher_name ?? '—'}`}
            right={<Pill label={session.status} tone="warning" />} onPress={() => router.push(`/session/${session.id}`)} />
        ))}
      </Card>
      <Card>
        <H2>{isAdmin ? 'Offerings' : 'My assigned offerings'}</H2>
        <QueryView query={offerings}>
          {data => data.length === 0 ? <Empty title="No offerings assigned">An administrator assigns teachers to offerings.</Empty> : (
            <>
              {data.map(offering => (
                <ListItem key={offering.id} title={offering.offering_label}
                  subtitle={`Primary: ${offering.primary_teacher ?? 'Not assigned'} · ${offering.enrolled_count} enrolled · ${offering.session_count} sessions`}
                  right={offering.can_create_session ? undefined : <Pill label="View only" tone="neutral" />}
                  onPress={offering.can_create_session ? () => router.push({ pathname: '/session/new', params: { offeringId: offering.id } }) : undefined} />
              ))}
            </>
          )}
        </QueryView>
      </Card>
    </Screen>
  );
}
