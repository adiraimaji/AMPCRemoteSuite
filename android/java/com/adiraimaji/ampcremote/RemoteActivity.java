package com.adiraimaji.ampcremote;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Vibrator;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;

import java.net.URLEncoder;

/**
 * Full-screen shell around the PC's own remote web app. The WebView gets the
 * session token through the URL, and the page calls back into AmpcApp to keep
 * the native token store in sync and to use the real Android clipboard.
 */
public class RemoteActivity extends Activity {
    public static final String EXTRA_HOST = "host";
    public static final String EXTRA_PORT = "port";
    public static final String EXTRA_TOKEN = "token";
    public static final String EXTRA_NAME = "name";

    private WebView webView;
    private ProgressBar progress;
    private View errorView;
    private TextView errorText;
    private ServerStore store;
    private String host = "";
    private String token = "";
    private String name = "AM PC Remote";
    private int port = 9600;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        host = getIntent().getStringExtra(EXTRA_HOST);
        port = getIntent().getIntExtra(EXTRA_PORT, 9600);
        token = getIntent().getStringExtra(EXTRA_TOKEN);
        name = getIntent().getStringExtra(EXTRA_NAME);
        if (host == null || host.isEmpty()) {
            finish();
            return;
        }
        if (token == null) token = "";
        if (name == null || name.isEmpty()) name = "AM PC Remote";

        store = ServerStore.get(this);
        if (token.isEmpty()) {
            ServerInfo info = store.find(host, port);
            if (info != null) token = info.token;
        }

        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        if (Build.VERSION.SDK_INT >= 21) {
            getWindow().setStatusBarColor(Ui.color(this, R.color.bg));
            getWindow().setNavigationBarColor(Ui.color(this, R.color.bg));
        }

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Ui.color(this, R.color.bg));

        webView = new WebView(this);
        webView.setBackgroundColor(Ui.color(this, R.color.bg));
        root.addView(webView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        progress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progress.setMax(100);
        progress.setProgress(0);
        FrameLayout.LayoutParams progressParams = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, Ui.dp(this, 3));
        progressParams.gravity = Gravity.TOP;
        root.addView(progress, progressParams);

        errorView = buildErrorView();
        errorView.setVisibility(View.GONE);
        root.addView(errorView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        setContentView(root);
        configureWebView();
        load();
    }

    private View buildErrorView() {
        LinearLayout overlay = new LinearLayout(this);
        overlay.setOrientation(LinearLayout.VERTICAL);
        overlay.setGravity(Gravity.CENTER);
        overlay.setBackgroundColor(Ui.color(this, R.color.bg));
        overlay.setPadding(Ui.dp(this, 28), Ui.dp(this, 28), Ui.dp(this, 28), Ui.dp(this, 28));

        LinearLayout card = Ui.card(this);
        TextView title = Ui.text(this, "Cannot reach the PC", 18, Ui.color(this, R.color.text), true);
        errorText = Ui.text(this, "", 13.5f, Ui.color(this, R.color.muted), false);
        errorText.setPadding(0, Ui.dp(this, 8), 0, Ui.dp(this, 14));
        card.addView(title);
        card.addView(errorText);

        LinearLayout buttons = new LinearLayout(this);
        buttons.setOrientation(LinearLayout.HORIZONTAL);
        Button retry = Ui.button(this, "Retry", true);
        retry.setOnClickListener(v -> hideError());
        Button servers = Ui.button(this, "Servers", false);
        servers.setOnClickListener(v -> finish());
        LinearLayout.LayoutParams left = new LinearLayout.LayoutParams(0,
                ViewGroup.LayoutParams.WRAP_CONTENT, 1);
        left.setMargins(0, 0, Ui.dp(this, 6), 0);
        LinearLayout.LayoutParams right = new LinearLayout.LayoutParams(0,
                ViewGroup.LayoutParams.WRAP_CONTENT, 1);
        right.setMargins(Ui.dp(this, 6), 0, 0, 0);
        buttons.addView(retry, left);
        buttons.addView(servers, right);
        card.addView(buttons);

        overlay.addView(card, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        return overlay;
    }

    private void configureWebView() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(false);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        if (Build.VERSION.SDK_INT >= 26) {
            settings.setSafeBrowsingEnabled(false);
        }
        String ua = settings.getUserAgentString();
        if (ua != null && !ua.contains("AmpcApp")) {
            settings.setUserAgentString(ua + " AmpcApp/2.0");
        }

        webView.addJavascriptInterface(new Bridge(), "AmpcApp");

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return handleUrl(url);
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return handleUrl(request.getUrl().toString());
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                progress.setVisibility(View.GONE);
                if (errorView.getVisibility() == View.VISIBLE) errorView.setVisibility(View.GONE);
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request != null && request.isForMainFrame()) {
                    showError("Could not load http://" + host + ":" + port
                            + ".\n\nCheck that AM PC Remote is running on the PC, both devices are on the"
                            + " same Wi-Fi, and the firewall allows TCP " + port + ".");
                }
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int newProgress) {
                progress.setVisibility(newProgress >= 100 ? View.GONE : View.VISIBLE);
                progress.setProgress(newProgress);
            }
        });
    }

    private boolean handleUrl(String url) {
        if (url == null) return false;
        Uri uri = Uri.parse(url);
        String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase();
        String targetHost = uri.getHost() == null ? "" : uri.getHost();
        if ((scheme.equals("http") || scheme.equals("https")) && targetHost.equalsIgnoreCase(host)) {
            return false;
        }
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (Exception ignored) {
            // No app can handle the link.
        }
        return true;
    }

    private void load() {
        String url = "http://" + host + ":" + port + "/";
        StringBuilder query = new StringBuilder();
        if (!token.isEmpty()) {
            query.append("token=").append(encode(token));
        }
        if (!name.isEmpty()) {
            if (query.length() > 0) query.append('&');
            query.append("name=").append(encode(name));
        }
        if (query.length() > 0) url += "?" + query;
        progress.setVisibility(View.VISIBLE);
        progress.setProgress(0);
        webView.loadUrl(url);
    }

    private void showError(String message) {
        if (errorText != null) errorText.setText(message);
        if (errorView != null) errorView.setVisibility(View.VISIBLE);
        if (progress != null) progress.setVisibility(View.GONE);
    }

    private void hideError() {
        if (errorView != null) errorView.setVisibility(View.GONE);
        if (webView != null) webView.reload();
    }

    private String encode(String value) {
        try {
            return URLEncoder.encode(value, "UTF-8");
        } catch (Exception ignored) {
            return value;
        }
    }

    @Override
    public void onBackPressed() {
        if (errorView != null && errorView.getVisibility() == View.VISIBLE) {
            finish();
            return;
        }
        if (webView == null) {
            super.onBackPressed();
            return;
        }
        String script = "(function(){try{return (window.amHandleBack&&window.amHandleBack())?1:0}catch(e){return 0}})()";
        webView.evaluateJavascript(script, new ValueCallback<String>() {
            @Override
            public void onReceiveValue(String value) {
                if (value == null || !value.contains("1")) finish();
            }
        });
    }

    @Override
    protected void onPause() {
        if (webView != null) webView.onPause();
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) webView.onResume();
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            try {
                webView.removeJavascriptInterface("AmpcApp");
                webView.loadUrl("about:blank");
                webView.destroy();
            } catch (Exception ignored) {
                // ignore
            }
            webView = null;
        }
        super.onDestroy();
    }

    /** Exposed to the page as window.AmpcApp. */
    public class Bridge {
        @JavascriptInterface
        public void setSession(String newToken, String clientName) {
            if (newToken == null || newToken.isEmpty()) return;
            token = newToken;
            store.setToken(host, port, newToken, name);
            store.setLast(host, port);
        }

        @JavascriptInterface
        public void clearSession() {
            token = "";
            store.clearToken(host, port);
        }

        @JavascriptInterface
        public boolean copyText(final String text) {
            try {
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        ClipboardManager manager = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
                        if (manager != null) {
                            manager.setPrimaryClip(ClipData.newPlainText("AM PC Remote", text));
                        }
                    }
                });
                return true;
            } catch (Exception ignored) {
                return false;
            }
        }

        @JavascriptInterface
        public void vibrate(int milliseconds) {
            try {
                Vibrator vibrator = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
                if (vibrator != null && vibrator.hasVibrator()) {
                    vibrator.vibrate(Math.max(1, Math.min(milliseconds, 80)));
                }
            } catch (Exception ignored) {
                // Vibration is optional.
            }
        }

        @JavascriptInterface
        public String serverName() {
            return name;
        }

        @JavascriptInterface
        public void toast(final String message) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    Ui.toast(RemoteActivity.this, message);
                }
            });
        }

        @JavascriptInterface
        public boolean openExternal(final String url) {
            if (url == null || url.isEmpty()) return false;
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    try {
                        startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
                    } catch (Exception ignored) {
                        // ignore
                    }
                }
            });
            return true;
        }

        @JavascriptInterface
        public String appVersion() {
            return "1.0.0";
        }
    }
}
