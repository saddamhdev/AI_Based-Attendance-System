package com.attendance.attendance;

import com.attendance.students.Student;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.*;

class AttendanceServiceMergeTest {

    @Test
    void applyAiResultsPreventsDuplicateFaceAssignmentsToSameStudent() {
        AttendanceRecordRepository records = mock(AttendanceRecordRepository.class);
        AttendanceService service = new AttendanceService(
                null, records, null, null,
                null, null, null, null, null, null
        );

        AttendanceSession session = AttendanceSession.builder().id(10L).build();
        Student student = Student.builder().id(5L).build();
        AttendanceRecord record = AttendanceRecord.builder()
                .id(1L)
                .session(session)
                .student(student)
                .status(AttendanceStatus.PROPOSED_ABSENT)
                .build();

        when(records.findBySessionIdAndStudentId(10L, 5L)).thenReturn(Optional.of(record));

        List<Map<String, Object>> aiResults = List.of(
                Map.of("studentId", 5L, "similarity", 0.81, "uncertain", false),
                Map.of("studentId", 5L, "similarity", 0.73, "uncertain", true)
        );

        service.applyAiResults(session, aiResults);

        ArgumentCaptor<AttendanceRecord> captor = ArgumentCaptor.forClass(AttendanceRecord.class);
        verify(records, times(1)).save(captor.capture());

        AttendanceRecord saved = captor.getValue();
        assertThat(saved.getStatus()).isEqualTo(AttendanceStatus.PROPOSED_PRESENT);
        assertThat(saved.getSimilarityScore()).isEqualTo(0.81);
        assertThat(saved.getSource()).isEqualTo("AI");
    }
}
