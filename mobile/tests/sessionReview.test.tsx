jest.mock('../src/api/endpoints', () => ({
  staff: { saveDraft: jest.fn(), confirm: jest.fn(), session: jest.fn(), recognize: jest.fn() },
}));

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react-native';
import React from 'react';

import { ApiError } from '../src/api/client';
import { staff } from '../src/api/endpoints';
import type { SessionDetail } from '../src/api/types';
import { useSessionReview } from '../src/features/session/useSessionReview';

const mocked = staff as jest.Mocked<typeof staff>;

function detail(version: number, status: 'DRAFT' | 'IN_REVIEW' | 'FINALIZED', states: string[] = ['UNCONFIRMED', 'UNCONFIRMED']): SessionDetail {
  return {
    session: { id: 's1', version, status, offering_label: 'CSE101', class_date: '2026-11-12', class_start_time: '09:00', class_end_time: '10:00' } as SessionDetail['session'],
    roster: states.map((state, index) => ({ session_id: 's1', student_id: `stu-${index}`, student_name: `S${index}`, roll: String(index), state, decision_source: state === 'UNCONFIRMED' ? 'NONE' : 'MANUAL' })) as SessionDetail['roster'],
    audit: [],
    recognitionAnalysis: null,
  };
}
const lost = () => new ApiError({ kind: 'network', message: 'lost', uncertain: true });

function setup(initial: SessionDetail) {
  const client = new QueryClient();
  const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return renderHook(() => useSessionReview('s1', initial), { wrapper });
}

beforeEach(() => jest.resetAllMocks());

describe('session review drafts and confirmation', () => {
  it('distinguishes unsaved edits from the saved draft', async () => {
    const { result } = await setup(detail(1, 'DRAFT'));
    expect(result.current.dirty).toBe(false);
    await act(async () => { result.current.setStudentState('stu-0', 'PRESENT'); });
    expect(result.current.dirty).toBe(true);
    mocked.saveDraft.mockResolvedValue(detail(2, 'IN_REVIEW', ['PRESENT', 'UNCONFIRMED']));
    await act(async () => { await result.current.saveDraft(); });
    expect(mocked.saveDraft).toHaveBeenCalledWith('s1', 1, { 'stu-0': 'PRESENT', 'stu-1': 'UNCONFIRMED' }, { 'stu-0': 'MANUAL', 'stu-1': 'NONE' });
    expect(result.current.dirty).toBe(false);
    expect(result.current.review?.detail.session.version).toBe(2);
  });

  it('after a lost draft-save response, checks the server instead of saving again', async () => {
    const { result } = await setup(detail(1, 'DRAFT'));
    await act(async () => { result.current.markRemainingAbsent(); });
    mocked.saveDraft.mockRejectedValue(lost());
    mocked.session.mockResolvedValue(detail(2, 'IN_REVIEW', ['ABSENT', 'ABSENT']));
    await act(async () => { await result.current.saveDraft(); });
    expect(mocked.saveDraft).toHaveBeenCalledTimes(1);
    expect(result.current.review?.detail.session.version).toBe(2);
  });

  it('after a lost confirmation response, fetches session status first and accepts FINALIZED', async () => {
    const { result } = await setup(detail(1, 'DRAFT'));
    await act(async () => { result.current.markRemainingAbsent(); });
    mocked.saveDraft.mockResolvedValue(detail(2, 'IN_REVIEW', ['ABSENT', 'ABSENT']));
    mocked.confirm.mockRejectedValue(lost());
    mocked.session.mockResolvedValue(detail(3, 'FINALIZED', ['ABSENT', 'ABSENT']));
    await act(async () => { await result.current.confirm(); });
    expect(mocked.confirm).toHaveBeenCalledTimes(1);
    expect(mocked.session).toHaveBeenCalledWith('s1');
    expect(result.current.finalized).toBe(true);
  });

  it('reports a lost confirmation that did not finalize, without retrying it', async () => {
    const { result } = await setup(detail(1, 'DRAFT'));
    await act(async () => { result.current.markRemainingAbsent(); });
    mocked.saveDraft.mockResolvedValue(detail(2, 'IN_REVIEW', ['ABSENT', 'ABSENT']));
    mocked.confirm.mockRejectedValue(lost());
    mocked.session.mockResolvedValue(detail(2, 'IN_REVIEW', ['ABSENT', 'ABSENT']));
    let error: unknown;
    await act(async () => { error = await result.current.confirm().catch(e => e); });
    expect(error).toBeInstanceOf(ApiError);
    expect(mocked.confirm).toHaveBeenCalledTimes(1);
    expect(result.current.finalized).toBe(false);
  });

  it('never finalizes automatically after analysis', async () => {
    const { result } = await setup(detail(1, 'DRAFT'));
    mocked.recognize.mockResolvedValue({
      photos: [{ photoId: 'p', imageWidth: 100, imageHeight: 100, results: [{ faceNumber: 1, faceId: 'p:1', boundingBox: { x: 1, y: 1, width: 40, height: 40 }, detectionConfidence: 0.9, status: 'MATCHED', studentId: 'stu-0', score: 0.9 }] }],
      matchedStudentIds: ['stu-0'], attendanceStatus: 'PROPOSED', analysisId: 'a', thresholdPercentage: 70, initiatingUser: 't', initiatingRole: 'TEACHER', analyzedAt: '',
    });
    await act(async () => { await result.current.analyze([{ clientId: 'c1', source: 'camera', status: 'ready', uri: 'file:///p.jpg', width: 100, height: 100 }]); });
    expect(result.current.review?.roster[0]).toMatchObject({ state: 'PRESENT', decision_source: 'AI' });
    expect(mocked.confirm).not.toHaveBeenCalled();
    expect(mocked.saveDraft).not.toHaveBeenCalled();
    expect(result.current.dirty).toBe(true);
  });
});
