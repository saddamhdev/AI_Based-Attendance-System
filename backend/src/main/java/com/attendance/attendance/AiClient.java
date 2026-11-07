package com.attendance.attendance;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

import java.util.List;
import java.util.Map;

@Component
public class AiClient {
    private final RestClient restClient;

    public AiClient(@Value("${app.ai.base-url:http://ai-service:8000}") String baseUrl) {
        this.restClient = RestClient.builder().baseUrl(baseUrl).build();
    }

    public List<Map<String, Object>> analyze(Long sessionId, List<Long> enrolledStudentIds, List<String> photoPaths) {
        return restClient.post()
                .uri("/recognition/process")
                .contentType(MediaType.APPLICATION_JSON)
                .body(Map.of("sessionId", sessionId, "enrolledStudentIds", enrolledStudentIds, "photoPaths", photoPaths))
                .retrieve()
                .body(new ParameterizedTypeReference<>() {});
    }
}
