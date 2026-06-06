package com.daily.nutrition.ledger;

import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.util.concurrent.TimeUnit;

import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;

public class AndroidBridge {
    private static final MediaType JSON = MediaType.parse("application/json; charset=utf-8");
    private final OkHttpClient client = new OkHttpClient.Builder()
            .connectTimeout(20, TimeUnit.SECONDS)
            .readTimeout(60, TimeUnit.SECONDS)
            .build();
    private final WebView webView;

    AndroidBridge(WebView webView) {
        this.webView = webView;
    }

    @JavascriptInterface
    public String request(String rawPayload) {
        try {
            JSONObject payload = new JSONObject(rawPayload);
            String type = payload.optString("type");
            if ("cloud".equals(type)) return handleCloud(payload);
            if ("deepseek".equals(type)) return handleDeepSeek(payload);
            return error(400, "Unsupported Android bridge request");
        } catch (Exception error) {
            return error(500, error.getMessage());
        }
    }

    private String handleCloud(JSONObject payload) throws Exception {
        String method = payload.optString("method");
        JSONObject cloud = payload.getJSONObject("cloud");
        String baseUrl = stripTrailingSlash(cloud.getString("url"));
        String path = normalizePath(cloud.getString("path"));
        String fileUrl = baseUrl + encodePath(path);
        String auth = "Basic " + Base64.encodeToString(
                (cloud.getString("username") + ":" + cloud.getString("password")).getBytes(StandardCharsets.UTF_8),
                Base64.NO_WRAP
        );

        if ("PUT".equals(method)) {
            ensureDirectories(baseUrl, path, auth);
            Request request = new Request.Builder()
                    .url(fileUrl)
                    .header("Authorization", auth)
                    .put(RequestBody.create(payload.getJSONObject("data").toString(2), JSON))
                    .build();
            return readResponse(client.newCall(request).execute(), "{\"ok\":true}", method, redactedUrl(fileUrl));
        }

        if ("GET".equals(method)) {
            Request request = new Request.Builder()
                    .url(fileUrl)
                    .header("Authorization", auth)
                    .get()
                    .build();
            return readResponse(client.newCall(request).execute(), null, method, redactedUrl(fileUrl));
        }

        return error(400, "Unsupported cloud method");
    }

    private String handleDeepSeek(JSONObject payload) throws Exception {
        String baseUrl = stripTrailingSlash(payload.optString("baseUrl", "https://api.deepseek.com"));
        String apiKey = payload.optString("apiKey");
        if (apiKey.isEmpty()) return error(400, "Android 端需要在直连模式填写 API Key");

        payload.remove("baseUrl");
        payload.remove("apiKey");
        payload.remove("stream");

        Request request = new Request.Builder()
                .url(baseUrl + "/chat/completions")
                .header("Authorization", "Bearer " + apiKey)
                .post(RequestBody.create(payload.toString(), JSON))
                .build();
        return readResponse(client.newCall(request).execute(), null);
    }

    private void ensureDirectories(String baseUrl, String filePath, String auth) throws Exception {
        String[] parts = normalizePath(filePath).split("/");
        String current = "";
        for (int index = 1; index < parts.length - 1; index += 1) {
            if (parts[index].isEmpty()) continue;
            current += "/" + parts[index];
            Request request = new Request.Builder()
                    .url(baseUrl + encodePath(current))
                    .header("Authorization", auth)
                    .method("MKCOL", RequestBody.create(new byte[0]))
                    .build();
            try (Response response = client.newCall(request).execute()) {
                int code = response.code();
                if (code != 201 && code != 405 && (code < 200 || code >= 300)) {
                    throw new IllegalStateException("创建云端目录失败：HTTP " + code + " · MKCOL · " + redactedUrl(baseUrl + encodePath(current)));
                }
            }
        }
    }

    private String readResponse(Response response, String fallbackOk) throws Exception {
        return readResponse(response, fallbackOk, "", "");
    }

    private String readResponse(Response response, String fallbackOk, String method, String url) throws Exception {
        try (Response closeable = response) {
            String body = closeable.body() == null ? "" : closeable.body().string();
            if (closeable.isSuccessful()) {
                if (body.isEmpty()) return fallbackOk == null ? "{\"ok\":true}" : fallbackOk;
                return body;
            }
            return error(closeable.code(), body.isEmpty() ? "HTTP " + closeable.code() : body, method, url);
        }
    }

    private String error(int status, String message) {
        return error(status, message, "", "");
    }

    private String error(int status, String message, String method, String url) {
        return "{\"error\":{\"status\":" + status
                + ",\"message\":\"" + NutritionWebViewClient.escapeJson(message)
                + "\",\"method\":\"" + NutritionWebViewClient.escapeJson(method)
                + "\",\"url\":\"" + NutritionWebViewClient.escapeJson(url)
                + "\"}}";
    }

    private String stripTrailingSlash(String value) {
        return value.replaceAll("/+$", "");
    }

    private String normalizePath(String value) {
        String normalized = value.replace("\\", "/").replaceAll("/+", "/");
        return normalized.startsWith("/") ? normalized : "/" + normalized;
    }

    private String encodePath(String path) throws Exception {
        String[] parts = path.split("/");
        StringBuilder builder = new StringBuilder();
        for (String part : parts) {
            if (part.isEmpty()) continue;
            builder.append('/').append(java.net.URLEncoder.encode(part, "UTF-8").replace("+", "%20"));
        }
        return builder.toString();
    }

    private String redactedUrl(String url) {
        return url.replaceAll("(?i)(https?://)([^/@:]+):([^/@]+)@", "$1***:***@");
    }
}
