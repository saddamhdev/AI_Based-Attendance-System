package com.attendance.attendance;

public enum ProcessingState {
    IDLE,
    UPLOADING,
    DETECTING,
    MATCHING,
    READY_FOR_REVIEW,
    FAILED
}
