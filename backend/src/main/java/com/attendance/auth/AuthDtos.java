package com.attendance.auth;

import jakarta.validation.constraints.NotBlank;

public class AuthDtos {
    public record LoginRequest(@NotBlank String usernameOrEmail, @NotBlank String password) {}
    public record LoginResponse(String token, String role, String username) {}
    public record MeResponse(Long id, String username, String email, String role, Long studentId) {}
}
