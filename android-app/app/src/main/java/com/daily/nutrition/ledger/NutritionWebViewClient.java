package com.daily.nutrition.ledger;

import android.net.Uri;
import android.util.Base64;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;

public class NutritionWebViewClient extends WebViewClient {
    @Override
    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        Uri uri = request.getUrl();
        String path = uri.getPath();
        if (path == null) return super.shouldInterceptRequest(view, request);

        try {
            if (path.equals("/api/cloud/webdav")) {
                return handleCloudProxy(request);
            }
        } catch (Exception error) {
            return jsonResponse(500, "{\"error\":{\"message\":\"" + escapeJson(error.getMessage()) + "\"}}");
        }

        return super.shouldInterceptRequest(view, request);
    }

    private WebResourceResponse handleCloudProxy(WebResourceRequest request) throws Exception {
        if (!"POST".equalsIgnoreCase(request.getMethod())) {
            return jsonResponse(405, "{\"error\":{\"message\":\"Method not allowed\"}}");
        }

        // WebView's request interception API does not expose POST bodies. The H5 app uses
        // AndroidBridge for cloud sync instead, so this path exists only as a safe fallback.
        return jsonResponse(501, "{\"error\":{\"message\":\"Android WebView fallback cannot read POST body\"}}");
    }

    static WebResourceResponse jsonResponse(int status, String body) {
        Map<String, String> headers = new HashMap<>();
        headers.put("Access-Control-Allow-Origin", "*");
        return new WebResourceResponse(
                "application/json",
                "utf-8",
                status,
                status == 200 ? "OK" : "Error",
                headers,
                new ByteArrayInputStream(body.getBytes(StandardCharsets.UTF_8))
        );
    }

    static String escapeJson(String value) {
        if (value == null) return "";
        return value.replace("\\", "\\\\").replace("\"", "\\\"");
    }
}
