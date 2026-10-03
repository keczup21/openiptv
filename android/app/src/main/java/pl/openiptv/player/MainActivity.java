package pl.openiptv.player;

import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.os.Build;
import android.os.Bundle;
import android.view.KeyEvent;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebSettings;
import android.webkit.WebView;

import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    private static final String PREFS = "openiptv_cache";
    private static final String KEY = "lastVersion";

    /* Czy w interfejsie jest odtwarzacz (ustawia app.js przez most
       setPlayerMode). Tylko wtedy oddajemy stronie klawisze multimedialne
       pilota — poza odtwarzaczem zostają systemowi. */
    private boolean playerMode = false;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        /* Lokalne pluginy (aktualizacja APK z GitHuba, wybor pliku M3U / EPG bez
           systemowego okna wyboru na Fire TV) musza byc zarejestrowane przed
           super.onCreate. */
        registerPlugin(UpdatePlugin.class);
        registerPlugin(FilePlugin.class);
        clearWebViewCacheOnUpdate();
        super.onCreate(savedInstanceState);
        applyTvViewport();
        bindExitBridge();
    }

    /* Fire TV i Android TV zgłaszają ekran o gęstości 2.0, czyli okno 960x540 px
       CSS zamiast 1920x1080, i domyślnie ignorują „meta viewport”. Interfejs —
       projektowany tak samo jak na webOS przy 1920x1080 — wyglądał więc na tych
       telewizorach dwa razy za duży. Włączamy obsługę „meta viewport” oraz tryb
       przeglądowy: strona układa się w stałej szerokości 1920 px (patrz skrypt
       w index.html) i jest skalowana do szerokości ekranu, więc na każdej
       telewizji wygląda tak samo. Ustawienia trafiają tuż po utworzeniu mostu,
       a wczytanie strony jest asynchroniczne, więc obowiązują jeszcze przed
       pierwszym rysowaniem interfejsu. */
    private void applyTvViewport() {
        try {
            Bridge bridge = getBridge();
            WebView webView = bridge != null ? bridge.getWebView() : null;
            if (webView == null) return;

            WebSettings settings = webView.getSettings();
            settings.setUseWideViewPort(true);
            settings.setLoadWithOverviewMode(true);
            webView.requestLayout();
        } catch (Exception ignored) {
            /* brak możliwości zmiany ustawień nie może blokować startu aplikacji */
        }
    }

    /* Most dla przycisku „Wyjdź z aplikacji” z interfejsu. W WebView samo
       window.close() jest ignorowane, więc „Wstecz” na liście kanałów pokazuje
       pytanie o wyjście (app.js -> showExitConfirm), a potwierdzenie woła
       OpenIptvNative.quit(), które dopiero kończy aktywność. */
    private void bindExitBridge() {
        try {
            Bridge bridge = getBridge();
            WebView webView = bridge != null ? bridge.getWebView() : null;
            if (webView == null) return;

            webView.addJavascriptInterface(new Object() {
                @JavascriptInterface
                public void quit() {
                    runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            finish();
                        }
                    });
                }

                /* interfejs mówi, że na ekranie jest odtwarzacz — od tego
                   momentu klawisze ⏵‖ / ⏹ pilota trafiają do strony */
                @JavascriptInterface
                public void setPlayerMode(final boolean on) {
                    playerMode = on;
                }
            }, "OpenIptvNative");
        } catch (Exception ignored) {
            /* bez mostu wyjście zostaje przy systemowym przycisku Wstecz */
        }
    }

    /* Klawisze multimedialne pilota (⏵‖, ⏸, ⏹, ⏪, ⏩). Część dekoderów
       i WebView zjada je dla własnej sesji multimediów, więc do strony nie
       docierało żadne zdarzenie klawiatury i przycisk play/pauza „nie działał”.
       Gdy leci obraz, przekazujemy taki klawisz do app.js
       (window.__openiptvKey) i zatrzymujemy go tutaj — jedno naciśnięcie to
       jedna akcja. Poza odtwarzaczem klawisz idzie dalej, systemowi. */
    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (playerMode && isMediaKey(keyCode)) {
            WebView webView = getBridge() != null ? getBridge().getWebView() : null;
            if (webView != null) {
                if (event.getRepeatCount() == 0) {
                    webView.evaluateJavascript(
                        "(function(){try{return window.__openiptvKey?window.__openiptvKey(" +
                        keyCode + "):''}catch(e){return ''}})()",
                        null);
                }
                return true;
            }
        }
        return super.onKeyDown(keyCode, event);
    }

    private static boolean isMediaKey(int keyCode) {
        switch (keyCode) {
            case KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE:
            case KeyEvent.KEYCODE_MEDIA_PLAY:
            case KeyEvent.KEYCODE_MEDIA_PAUSE:
            case KeyEvent.KEYCODE_MEDIA_STOP:
            case KeyEvent.KEYCODE_MEDIA_FAST_FORWARD:
            case KeyEvent.KEYCODE_MEDIA_REWIND:
                return true;
            default:
                return false;
        }
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

