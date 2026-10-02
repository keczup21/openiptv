package pl.openiptv.player;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ContentResolver;
import android.content.Context;
import android.content.DialogInterface;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.OpenableColumns;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Logger;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.List;

/* Wybor pliku M3U / EPG na telewizorze. Na Fire TV i Android TV czesto nie ma
   zadnej aplikacji, ktora umie pokazac systemowe okno wyboru plikow — WebView
   nie ma wtedy czego otworzyc i przycisk „Wybierz plik” milczy (dokladnie to
   widac w ustawieniach: nic sie nie dzieje). Dlatego plugin sam:
     1. probuje systemowego wyboru dokumentow (Android TV / Google TV / telefon),
     2. gdy takiego wyboru nie ma — pokazuje wlasna liste katalogow, po ktorych
        chodzi sie pilotem (pamiec urzadzenia, karta USB, dysk),
     3. kopiuje wybrany plik do pamieci aplikacji i oddaje www jego sciezke.
   Strona czyta ten plik przez lokalny serwer Capacitora (/_capacitor_file_/),
   wiec nie zalezy od uprawnien do cudzych URI.
   W www widac plugin jako Capacitor.Plugins.OpenIptvFiles. */
@CapacitorPlugin(
    name = "OpenIptvFiles",
    permissions = { @Permission(alias = "storage", strings = { Manifest.permission.READ_EXTERNAL_STORAGE }) }
)
public class FilePlugin extends Plugin {

    private static final String PICKER_CALLBACK = "pickerResult";
    private static final String STORAGE_CALLBACK = "storagePermissionResult";
    private static final String ANY_MIME = "*/*";
    private static final String PICKED_DIR = "picked";
    private static final int BUFFER_BYTES = 64 * 1024;
    /* bardzo dlugie katalogi (np. zrzuty nagran) tylko przewijaja sie w nieskonczonosc */
    private static final int MAX_ENTRIES = 300;

    /* Wejscie z www: pickFile({ title }) -> { name, path } albo { cancelled: true }
       albo { unavailable: true } (telewizor nie ma czym wybrac pliku). */
    @PluginMethod
    public void pickFile(PluginCall call) {
        Intent intent = systemPickerIntent();
        if (intent != null) {
            startActivityForResult(call, intent, PICKER_CALLBACK);
            return;
        }

        if (needsStoragePermission() && getPermissionState("storage") != PermissionState.GRANTED) {
            requestPermissionForAlias("storage", call, STORAGE_CALLBACK);
            return;
        }

        showFolders(call, readableRoots());
    }

    /* Odmowa zgody nie zamyka wyboru: pokazujemy liste katalogow, ktore i tak
       da sie przeczytac (na Fire OS 7 samo „/sdcard” wystarcza). */
    @PermissionCallback
    private void storagePermissionResult(PluginCall call) {
        showFolders(call, readableRoots());
    }

    @ActivityCallback
    private void pickerResult(PluginCall call, ActivityResult result) {
        if (call == null || call.isReleased()) return;

        Uri uri = pickedUri(result);
        if (uri == null) {
            answer(call, flag("cancelled"));
            return;
        }
        copyPickedFile(call, uri);
    }

    private Uri pickedUri(ActivityResult result) {
        if (result == null || result.getResultCode() != Activity.RESULT_OK) return null;
        Intent data = result.getData();
        if (data == null) return null;
        if (data.getClipData() != null && data.getClipData().getItemCount() > 0) {
            return data.getClipData().getItemAt(0).getUri();
        }
        return data.getData();
    }

    /* Systemowy wybor dokumentow, a gdy go nie ma — stary wybor tresci.
       Bez filtra typow: pliki .m3u i .xml czesto nie maja rozpoznanego typu
       MIME, wiec zwezanie listy (tak jak robi to accept= w HTML) chowalo je
       przed uzytkownikiem. Typ pliku sprawdza pozniej sama aplikacja. */
    private Intent systemPickerIntent() {
        Intent documents = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        documents.addCategory(Intent.CATEGORY_OPENABLE);
        documents.setType(ANY_MIME);
        if (resolves(documents)) return documents;

        Intent content = new Intent(Intent.ACTION_GET_CONTENT);
        content.addCategory(Intent.CATEGORY_OPENABLE);
        content.setType(ANY_MIME);
        return resolves(content) ? content : null;
    }

    private boolean resolves(Intent intent) {
        try {
            PackageManager manager = getContext().getPackageManager();
            return intent.resolveActivity(manager) != null;
        } catch (Exception error) {
            return false;
        }
    }

    /* ------------------------ wlasny wybor pliku --------------------------- */

    /* Katalogi, z ktorych aplikacja naprawde moze czytac: pamiec urzadzenia
       („/sdcard”), karty USB i dyski podlaczone do telewizora. Lista jest
       sprawdzana w locie — katalog, ktorego nie da sie przeczytac, nie trafia
       na ekran (na Androidzie 11+ czesc sciezek jest zablokowana). */
    private List<File> readableRoots() {
        List<File> roots = new ArrayList<>();
        List<String> seen = new ArrayList<>();

        addRoot(roots, seen, Environment.getExternalStorageDirectory());
        addChildren(roots, seen, new File("/storage"));
        addChildren(roots, seen, new File("/mnt/media_rw"));
        addRoot(roots, seen, new File("/mnt/usb"));

        return roots;
    }

    private void addRoot(List<File> roots, List<String> seen, File dir) {
        if (dir == null || !dir.isDirectory() || !dir.canRead()) return;
        String path = dir.getAbsolutePath();
        if (seen.contains(path)) return;
        if (dir.listFiles() == null) return;
        seen.add(path);
        roots.add(dir);
    }

    private void addChildren(List<File> roots, List<String> seen, File parent) {
        if (parent == null || !parent.isDirectory()) return;
        File[] children = parent.listFiles();
        if (children == null) return;
        Arrays.sort(children, childOrder());
        for (File child : children) {
            if (!child.isDirectory()) continue;
            String name = child.getName();
            /* „emulated” i „self” to ta sama pamiec, co „/sdcard” — bez duplikatow */
            if ("emulated".equals(name) || "self".equals(name) || "encrypted".equals(name)) continue;
            addRoot(roots, seen, child);
        }
    }

    /* Katalogi przed plikami, dalej alfabetycznie — na pilocie liczy sie kazde
       nacisniecie „w dol”. */
    private Comparator<File> childOrder() {
        return new Comparator<File>() {
            @Override
            public int compare(File left, File right) {
                boolean leftDir = left.isDirectory();
                boolean rightDir = right.isDirectory();
                if (leftDir != rightDir) return leftDir ? -1 : 1;
                return left.getName().compareToIgnoreCase(right.getName());
            }
        };
    }

    private void showFolders(final PluginCall call, final List<File> roots) {
        if (call == null || call.isReleased()) return;
        if (roots.isEmpty()) {
            answer(call, flag("unavailable"));
            return;
        }
        if (roots.size() == 1) {
            browse(call, roots.get(0));
            return;
        }

        List<String> labels = new ArrayList<>();
        for (File root : roots) labels.add(root.getAbsolutePath());
        showList(call, title(call), labels, new Choice() {
            @Override
            public void picked(int which) {
                browse(call, roots.get(which));
            }
        });
    }
    /* Lista zawartosci katalogu. „../” cofa wyzej, „/” na koncu nazwy oznacza
       katalog. Wstecz (albo wyjscie z listy) zamyka wybor bez zmiany ustawien. */
    private void browse(final PluginCall call, final File dir) {
        if (call == null || call.isReleased()) return;

        final List<File> entries = new ArrayList<>();
        List<String> labels = new ArrayList<>();

        File parent = dir.getParentFile();
        if (parent != null && parent.canRead()) {
            entries.add(parent);
            labels.add("../");
        }

        File[] children = dir.listFiles();
        if (children != null) {
            Arrays.sort(children, childOrder());
            for (File child : children) {
                if (entries.size() >= MAX_ENTRIES) break;
                String name = child.getName();
                if (name.startsWith(".")) continue;
                if (child.isDirectory()) {
                    if (!child.canRead()) continue;
                    entries.add(child);
                    labels.add(name + "/");
                } else if (child.isFile() && child.canRead()) {
                    entries.add(child);
                    labels.add(name);
                }
            }
        }

        showList(call, title(call) + " - " + dir.getName(), labels, new Choice() {
            @Override
            public void picked(int which) {
                File chosen = entries.get(which);
                if (chosen.isDirectory()) {
                    browse(call, chosen);
                    return;
                }
                copyPickedFile(call, Uri.fromFile(chosen));
            }
        });
    }

    private void showList(final PluginCall call, final String title, List<String> labels, final Choice choice) {
        final Activity activity = getActivity();
        if (activity == null) {
            answer(call, flag("unavailable"));
            return;
        }

        final String[] items = labels.toArray(new String[0]);
        activity.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                try {
                    new AlertDialog.Builder(activity)
                        .setTitle(title)
                        .setItems(items, new DialogInterface.OnClickListener() {
                            @Override
                            public void onClick(DialogInterface dialog, int which) {
                                choice.picked(which);
                            }
                        })
                        .setOnCancelListener(new DialogInterface.OnCancelListener() {
                            @Override
                            public void onCancel(DialogInterface dialog) {
                                answer(call, flag("cancelled"));
                            }
                        })
                        .show();
                } catch (Exception error) {
                    Logger.warn("Nie udalo sie pokazac listy plikow: " + message(error));
                    answer(call, flag("unavailable"));
                }
            }
        });
    }

    private interface Choice {
        void picked(int which);
    }

    private boolean needsStoragePermission() {
        /* Od Androida 13 czytanie plikow nie-mediow idzie przez systemowy wybor
           dokumentow, wiec starej zgody nie ma nawet o co prosic. */
        return Build.VERSION.SDK_INT <= Build.VERSION_CODES.S_V2;
    }

    /* --------------------------- wczytanie pliku --------------------------- */

    /* Wybrany plik kopiujemy do wlasnego katalogu i oddajemy www sciezke w nim.
       Dzieki temu www nie musi miec zgody na cudzy URI, a duze pliki (EPG bywa
       kilkadziesiat MB) sa czytane strumieniowo przez lokalny serwer. */
    private void copyPickedFile(final PluginCall call, final Uri uri) {
        final String name = safeFileName(displayName(uri));
        new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    final File file = copyToCache(getContext(), uri, name);
                    runOnUi(new Runnable() {
                        @Override
                        public void run() {
                            JSObject result = new JSObject();
                            result.put("name", file.getName());
                            result.put("path", file.getAbsolutePath());
                            answer(call, result);
                        }
                    });
                } catch (Exception error) {
                    final String reason = message(error);
                    runOnUi(new Runnable() {
                        @Override
                        public void run() {
                            reject(call, "Nie udalo sie wczytac pliku: " + reason);
                        }
                    });
                }
            }
        }, "openiptv-file").start();
    }

    private File copyToCache(Context context, Uri uri, String name) throws Exception {
        File dir = new File(context.getCacheDir(), PICKED_DIR);
        if (!dir.exists() && !dir.mkdirs()) throw new Exception("brak miejsca na plik tymczasowy");

        File target = new File(dir, name);
        InputStream input = null;
        FileOutputStream output = null;
        try {
            ContentResolver resolver = context.getContentResolver();
            input = resolver.openInputStream(uri);
            if (input == null) throw new Exception("nie moge otworzyc pliku");
            output = new FileOutputStream(target);
            byte[] buffer = new byte[BUFFER_BYTES];
            int read;
            while ((read = input.read(buffer)) > 0) output.write(buffer, 0, read);
            output.flush();
        } finally {
            if (output != null) output.close();
            if (input != null) input.close();
        }
        return target;
    }

    private String displayName(Uri uri) {
        if ("file".equals(uri.getScheme())) {
            String path = uri.getPath();
            if (path != null) return new File(path).getName();
        }
        Cursor cursor = null;
        try {
            ContentResolver resolver = getContext().getContentResolver();
            cursor = resolver.query(uri, new String[] { OpenableColumns.DISPLAY_NAME }, null, null, null);
            if (cursor != null && cursor.moveToFirst()) {
                int column = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (column >= 0) {
                    String name = cursor.getString(column);
                    if (name != null && !name.isEmpty()) return name;
                }
            }
        } catch (Exception error) {
            Logger.warn("Nie udalo sie odczytac nazwy pliku: " + message(error));
        } finally {
            if (cursor != null) cursor.close();
        }
        String last = uri.getLastPathSegment();
        return (last == null || last.isEmpty()) ? "playlist.m3u" : last;
    }

    /* Nazwa pliku pochodzi z pamieci urzadzenia, wiec nie ufamy jej bezgranicznie:
       zostawiamy tylko znaki bezpieczne w nazwie pliku. */
    private String safeFileName(String name) {
        String clean = (name == null ? "" : name).replaceAll("[^A-Za-z0-9._-]", "_");
        if (clean.isEmpty() || ".".equals(clean) || "..".equals(clean)) clean = "playlist.m3u";
        if (clean.length() > 80) clean = clean.substring(clean.length() - 80);
        return clean;
    }

    /* ------------------------------- odpowiedzi ---------------------------- */

    private String title(PluginCall call) {
        String text = call == null ? null : call.getString("title", "");
        return (text == null || text.isEmpty()) ? "OpenIPTV" : text;
    }

    private JSObject flag(String name) {
        JSObject result = new JSObject();
        result.put(name, true);
        return result;
    }

    private void answer(PluginCall call, JSObject result) {
        if (call == null || call.isReleased()) return;
        call.resolve(result);
    }

    private void reject(PluginCall call, String reason) {
        if (call == null || call.isReleased()) return;
        call.reject(reason);
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

    private String message(Exception error) {
        String text = error == null ? null : error.getMessage();
        return (text == null || text.isEmpty()) ? "blad" : text;
    }
}

