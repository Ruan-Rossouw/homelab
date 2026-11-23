package com.local.kiosk;

import android.app.Activity;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Bundle;
import android.os.Handler;
import android.view.View;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.SslErrorHandler;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

public class KioskActivity extends Activity {
    private WebView web;
    private final Handler handler = new Handler();
    private String url;
    private boolean failed = false;

    private final Runnable retry = new Runnable() {
        @Override public void run() {
            if (failed) { failed = false; web.loadUrl(url); }
            handler.postDelayed(this, 15000);
        }
    };

    /**
     * Screen control for the dashboard, exposed to JavaScript as
     * `window.KioskBridge`. Only honoured while the page on screen is served
     * from the configured Home Assistant host, so no other page the WebView
     * might visit can drive the screen. Brightness is a per-window override;
     * Android clamps it to the panel's own minimum (about 4% on this frame).
     */
    private class Bridge {
        @JavascriptInterface public int version() { return 1; }

        @JavascriptInterface public void setBrightness(final float level) {
            runOnUiThread(new Runnable() {
                @Override public void run() {
                    if (!fromTrustedHost()) return;
                    float v = Float.isNaN(level) ? 0.4f : Math.max(0f, Math.min(1f, level));
                    WindowManager.LayoutParams lp = getWindow().getAttributes();
                    lp.screenBrightness = v;
                    getWindow().setAttributes(lp);
                }
            });
        }
    }

    private boolean fromTrustedHost() {
        String current = web.getUrl();
        if (current == null) return false;
        String host = Uri.parse(current).getHost();
        String expected = Uri.parse(url).getHost();
        return host != null && host.equals(expected);
    }

    @Override protected void onCreate(Bundle b) {
        super.onCreate(b);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        url = getString(R.string.kiosk_url);
        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        web.addJavascriptInterface(new Bridge(), "KioskBridge");
        web.setWebChromeClient(new WebChromeClient());
        web.setBackgroundColor(0xFF000000);
        web.setWebViewClient(new WebViewClient() {
            @Override public void onReceivedError(WebView v, WebResourceRequest r, WebResourceError e) {
                if (r.isForMainFrame()) {
                    failed = true;
                    v.loadData("<body style='background:#000;color:#888;font:28px sans-serif;"
                        + "display:flex;align-items:center;justify-content:center;height:100vh'>"
                        + "Waiting for Home Assistant...</body>", "text/html", "utf-8");
                }
            }
            @Override public void onReceivedSslError(WebView v, SslErrorHandler h, SslError e) {
                h.cancel(); // never bypass certificate errors
            }
        });
        setContentView(web);
        web.loadUrl(url);
        handler.postDelayed(retry, 15000);
    }

    @Override public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_FULLSCREEN
                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
        }
    }

    @Override public void onBackPressed() { /* kiosk: ignore */ }

    @Override protected void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        web.destroy();
        super.onDestroy();
    }
}
