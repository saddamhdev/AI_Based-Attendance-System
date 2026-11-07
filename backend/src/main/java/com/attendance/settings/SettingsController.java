package com.attendance.settings;

import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/settings")
public class SettingsController {
    private final SystemSettingRepository settings;

    public SettingsController(SystemSettingRepository settings) {
        this.settings = settings;
    }

    @GetMapping
    @PreAuthorize("hasAnyRole('ADMIN','TEACHER')")
    public List<SystemSetting> list() {
        return settings.findAll();
    }

    @PutMapping
    @PreAuthorize("hasRole('ADMIN')")
    public List<SystemSetting> upsert(@RequestBody Map<String, String> payload) {
        payload.forEach((key, value) -> {
            SystemSetting s = settings.findByKey(key).orElse(SystemSetting.builder().key(key).value(value).build());
            s.setValue(value);
            settings.save(s);
        });
        return settings.findAll();
    }
}
