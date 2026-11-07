package com.attendance.auth;

import jakarta.validation.Valid;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/auth")
public class AuthController {
    private final AuthService authService;

    public AuthController(AuthService authService) {
        this.authService = authService;
    }

    @PostMapping("/login")
    public AuthDtos.LoginResponse login(@Valid @RequestBody AuthDtos.LoginRequest request) {
        return authService.login(request);
    }

    @GetMapping("/me")
    public AuthDtos.MeResponse me(Authentication authentication) {
        CustomUserPrincipal p = (CustomUserPrincipal) authentication.getPrincipal();
        return new AuthDtos.MeResponse(p.getId(), p.getUsername(), p.getEmail(), p.getRole().name(), p.getStudentId());
    }
}
