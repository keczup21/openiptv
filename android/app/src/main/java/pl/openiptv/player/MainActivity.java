package pl.openiptv.player;

import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.os.Build;
import android.os.Bundle;
import android.webkit.ValueCallback;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    private static final String PREFS = "openiptv_cache";
    private static final String KEY = "lastVersion";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        /* Lokalny plugin aktualizacji (pobranie APK z GitHuba + systemowy
           instalator) musi byc zarejestrowany przed super.onCreate. */
        registerPlugin(UpdatePlugin.class);
        clearWebViewCacheOnUpdate();
        super.onCreate(savedInstanceState);
    }

    /* Sprzętowy klawisz „Wstecz” na Android TV / Fire TV: najpierw pytamy
       interfejs (zamykanie nakładek, powrót z odtwarzacza do listy), a dopiero
       gdy ten nie ma nic do zrobienia, oddajemy zdarzenie systemowi. Dzięki
       temu „Wstecz” nigdy nie zamyka aplikacji w trakcie oglądania. */
    @Override
    public void onBackPressed() {
        WebView webView = getBridge() != null ? getBridge().getWebView() : null;
        if (webView == null) {
            super.onBackPressed();
            return;
        }
        try {
            webView.evaluateJavascript(
                "(function(){try{return window.__openiptvBack?window.__openiptvBack():''}catch(e){return ''}})()",
                new ValueCallback<String>() {
                    @Override
                    public void onReceiveValue(String value) {
                        if (!"\"handled\"".equals(value)) MainActivity.super.onBackPressed();
                    }
                });
        } catch (Exception ignored) {
            super.onBackPressed();
        }
    }

    /* Po aktualizacji aplikacji czyścimy cache HTTP WebView raz na nową wersję,
       żeby na pewno wczytały się nowe pliki (index.html + app.js), a nie ich
       mieszanka ze starej i nowej wersji. */
    private void clearWebViewCacheOnUpdate() {
        try {
            String current = currentVersion();
            if (current == null || current.isEmpty()) return;

            SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
            if (current.equals(prefs.getString(KEY, ""))) return;

            WebView probe = new WebView(this);
            probe.clearCache(true);
            probe.destroy();
            deleteDatabase("webview.db");
            deleteDatabase("webviewCache.db");

            prefs.edit().putString(KEY, current).apply();
        } catch (Exception ignored) {
            /* brak możliwości wyczyszczenia cache nie może blokować startu aplikacji */
        }
    }

    private String currentVersion() {
        try {
            PackageInfo info = getPackageManager().getPackageInfo(getPackageName(), 0);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                return String.valueOf(info.getLongVersionCode());
            }
            return String.valueOf(info.versionCode);
        } catch (Exception error) {
            return "";
        }
    }
}

