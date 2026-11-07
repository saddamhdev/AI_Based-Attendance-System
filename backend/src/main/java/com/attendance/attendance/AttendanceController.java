package com.attendance.attendance;

import com.attendance.auth.CustomUserPrincipal;
import com.attendance.attendance.AttendanceService.CreateSessionRequest;
import com.attendance.attendance.AttendanceService.SessionReviewResponse;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.util.List;

@RestController
@RequestMapping("/api/attendance")
public class AttendanceController {
    private final AttendanceService service;

    public AttendanceController(AttendanceService service) {
        this.service = service;
    }

    public record ManualAttendanceRequest(AttendanceStatus status, String reason) {}

    @PostMapping("/sessions")
    public AttendanceSession createSession(@RequestBody CreateSessionRequest request,
                                           @AuthenticationPrincipal CustomUserPrincipal user) {
        return service.createSession(request, user);
    }

    @GetMapping("/sessions")
    public List<AttendanceSession> listSessions(@RequestParam(required = false) SessionState state,
                                                @AuthenticationPrincipal CustomUserPrincipal user) {
        return service.listSessions(user, state);
    }

    @PostMapping("/sessions/{id}/photos")
    public AttendanceSession uploadPhotos(@PathVariable Long id,
                                          @RequestParam("files") List<MultipartFile> files,
                                          @AuthenticationPrincipal CustomUserPrincipal user) {
        return service.uploadPhotos(id, files, user);
    }

    @GetMapping("/sessions/{id}/review")
    public SessionReviewResponse review(@PathVariable Long id,
                                        @AuthenticationPrincipal CustomUserPrincipal user) {
        return service.getReview(id, user);
    }

    @PutMapping("/sessions/{id}/records/{studentId}")
    public AttendanceRecord mark(@PathVariable Long id,
                                 @PathVariable Long studentId,
                                 @RequestBody ManualAttendanceRequest request,
                                 @AuthenticationPrincipal CustomUserPrincipal user) {
        return service.markAttendance(id, studentId, request.status(), request.reason(), user);
    }

    @PostMapping("/sessions/{id}/confirm")
    public AttendanceSession confirm(@PathVariable Long id,
                                     @AuthenticationPrincipal CustomUserPrincipal user) {
        return service.confirm(id, user);
    }

    @GetMapping("/sessions/{id}/audit")
    public List<AuditLog> audit(@PathVariable Long id,
                                @AuthenticationPrincipal CustomUserPrincipal user) {
        return service.audit(id, user);
    }
}
