package pl.openiptv.player;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.SystemClock;
import android.provider.Settings;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Logger;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/* Mostek miedzy ustawieniami w aplikacji a systemem Androida: pobiera paczke
   .apk z wydania na GitHubie i oddaje ja systemowemu instalatorowi.
   Dzieki temu na Fire TV / Android TV aktualizacje robi sie pilotem, bez ADB
   i bez komputera. Plugin jest lokalny (bez npm) i rejestrowany w MainActivity;
   po stronie www widac go jako Capacitor.Plugins.OpenIptvUpdater. */
@CapacitorPlugin(name = "OpenIptvUpdater")
public class UpdatePlugin extends Plugin {

    private static final String APK_MIME = "application/vnd.android.package-archive";
    private static final int TIMEOUT_MS = 30000;
    private static final int BUFFER_BYTES = 64 * 1024;

    /* Czy system pozwoli tej aplikacji otworzyc instalator. Od Androida 8 kazda
       aplikacja ma wlasna zgode („Instaluj nieznane aplikacje”). */
    @PluginMethod
    public void canInstall(PluginCall call) {
        JSObject result = new JSObject();
        result.put("allowed", canInstallPackages());
        call.resolve(result);
    }

    /* Ekran, na ktorym wlacza sie te zgode — zeby nie trzeba bylo szukac go
       recznie w ustawieniach telewizora. */
    @PluginMethod
    public void openInstallSettings(PluginCall call) {
        try {
            Intent intent;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                intent = new Intent(
                    Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:" + getContext().getPackageName())
                );
            } else {
                intent = new Intent(Settings.ACTION_SECURITY_SETTINGS);
            }
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            JSObject result = new JSObject();
            result.put("opened", true);
            call.resolve(result);
        } catch (Exception error) {
            call.reject(message(error), error);
        }
    }

    /* Pobiera paczke i otwiera instalator. Odpowiedz wraca po jej pobraniu, wiec
       wywolanie trzymamy przy zyciu (setKeepAlive) mimo dluzszego czasu pracy. */
    @PluginMethod
    public void install(final PluginCall call) {
        final String url = call.getString("url", "");
        final String fileName = safeFileName(call.getString("name", ""));

        if (url == null || !url.toLowerCase().startsWith("https://")) {
            call.reject("Adres paczki musi zaczynac sie od https://");
            return;
        }
        call.setKeepAlive(true);

        new Thread(new Runnable() {
            @Override
            public void run() {
                final File target = new File(getContext().getCacheDir(), fileName);
                try {
                    download(url, target);
                    final long size = target.length();
                    runOnUi(new Runnable() {
                        @Override
                        public void run() {
                            try {
                                startInstaller(target);
                                JSObject result = new JSObject();
                                result.put("path", target.getAbsolutePath());
                                result.put("size", size);
                                call.resolve(result);
                            } catch (Exception error) {
                                call.reject(message(error), error);
                            }
                        }
                    });
                } catch (Exception error) {
                    /* niekompletnego pliku nie zostawiamy na pozniej */
                    if (target.exists() && !target.delete()) {
                        Logger.warn("Nie udalo sie usunac niekompletnej paczki: " + target);
                    }
                    final String reason = message(error);
                    runOnUi(new Runnable() {
                        @Override
                        public void run() {
                            call.reject(reason);
                        }
                    });
                }
            }
        }, "openiptv-updater").start();
    }

    /* Odpowiedzi do www wysylamy z watku UI; gdy aktywnosci juz nie ma, robimy to
       od razu, zeby wywolanie nie zostalo bez odpowiedzi. */
    private void runOnUi(Runnable action) {
        Activity activity = getActivity();
        if (activity == null) {
            action.run();
            return;
        }
        activity.runOnUiThread(action);
    }

    private void download(String url, File target) throws Exception {
        HttpURLConnection connection = null;
        InputStream input = null;
        FileOutputStream output = null;
        try {
            connection = (HttpURLConnection) new URL(url).openConnection();
            connection.setInstanceFollowRedirects(true);
            connection.setConnectTimeout(TIMEOUT_MS);
            connection.setReadTimeout(TIMEOUT_MS);
            connection.setRequestProperty("User-Agent", "OpenIPTV-Updater");

            int status = connection.getResponseCode();
            if (status < 200 || status >= 300) throw new Exception("HTTP " + status);

            long total = connection.getContentLength();
            input = connection.getInputStream();
            output = new FileOutputStream(target);

            byte[] buffer = new byte[BUFFER_BYTES];
            long done = 0;
            int lastPercent = -1;
            long lastNotify = 0;
            int read;
            while ((read = input.read(buffer)) > 0) {
                output.write(buffer, 0, read);
                done += read;
                if (total <= 0) continue;
                int percent = (int) (done * 100 / total);
                long now = SystemClock.elapsedRealtime();
                if (percent != lastPercent && now - lastNotify >= 100) {
                    lastPercent = percent;
                    lastNotify = now;
                    notifyProgress(percent);
                }
            }
            output.flush();
            if (total > 0 && done != total) {
                throw new Exception("Pobrano " + done + " z " + total + " B");
            }
        } finally {
            if (output != null) output.close();
            if (input != null) input.close();
            if (connection != null) connection.disconnect();
        }
    }

    /* Postep trafia do www jako zdarzenie „progress” (nasluchuje go app.js). */
    private void notifyProgress(final int percent) {
        runOnUi(new Runnable() {
            @Override
            public void run() {
                JSObject data = new JSObject();
                data.put("percent", percent);
                notifyListeners("progress", data);
            }
        });
    }

    /* Instalator systemowy czyta plik przez FileProvider (ten sam, ktory jest
       juz w manifescie) — bez tego Android 7+ odmawia dostepu do pliku. */
    private void startInstaller(File file) {
        Uri uri = FileProvider.getUriForFile(
            getContext(),
            getContext().getPackageName() + ".fileprovider",
            file
        );
        Intent intent = new Intent(Intent.ACTION_VIEW);
        intent.setDataAndType(uri, APK_MIME);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
    }

    private boolean canInstallPackages() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                return getContext().getPackageManager().canRequestPackageInstalls();
            }
            /* do Androida 7 instalator pyta tylko o globalna zgode */
            return true;
        } catch (Exception error) {
            /* brak informacji nie moze blokowac proby instalacji */
            return true;
        }
    }

    /* Nazwa pliku pochodzi z GitHuba, ale nie ufamy jej bezgranicznie:
       zostawiamy tylko znaki bezpieczne w nazwie pliku. */
    private String safeFileName(String name) {
        String clean = (name == null ? "" : name).replaceAll("[^A-Za-z0-9._-]", "_");
        if (clean.length() > 60) clean = clean.substring(clean.length() - 60);
        if (!clean.toLowerCase().endsWith(".apk")) clean = "OpenIPTV.apk";
        return clean;
    }

    private String message(Exception error) {
        String text = error == null ? null : error.getMessage();
        return (text == null || text.isEmpty()) ? "Blad pobierania paczki" : text;
    }
}