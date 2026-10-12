package com.sahil.today;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Collections;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.regex.Pattern;

/**
 * Weekly backups of the app's data, written to a PUBLIC folder that is not removed when the app is uninstalled:
 * Documents/TodayBackups/today-YYYY-MM-DD.json.
 *
 *  - Android 10+ (API 29+): through MediaStore (no storage permission needed; the file belongs to the shared Documents collection).
 *  - Android 7-9: the plain Documents folder (needs the storage permission, which the plugin asks for).
 *
 * Used by the plugin (the Backup now button) and by BackupReceiver (every Sunday 21:30, even with the app closed).
 */
public final class BackupStore {

    public static final String DIR = "TodayBackups";
    public static final String RELATIVE = Environment.DIRECTORY_DOCUMENTS + "/" + DIR;
    public static final String ACTION_WEEKLY = "com.sahil.today.WEEKLY_BACKUP";
    /** Where Capacitor Preferences keeps the app's data (see @capacitor/preferences). */
    private static final String CAP_PREFS = "CapacitorStorage";
    private static final String DATA_KEY = "today:v1";
    private static final String STATUS_PREFS = "today_backup";
    public static final Pattern WEEKLY_NAME = Pattern.compile("^today-\\d{4}-\\d{2}-\\d{2}\\.json$");

    private BackupStore() {}

    public static final class Info {
        public String name;
        public String uri;
        public long size;
        public long modified;
    }

    private static boolean scoped() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q;
    }

    private static Uri collection() {
        return MediaStore.Files.getContentUri("external");
    }

    // ---- Writing -----------------------------------------------------------------------------------------------------

    /** Writes (or overwrites, for the same name) a backup file. Returns its uri. */
    public static Uri save(Context c, String name, String text) throws Exception {
        byte[] bytes = text.getBytes(StandardCharsets.UTF_8);
        if (scoped()) {
            ContentResolver r = c.getContentResolver();
            Uri existing = find(c, name);
            Uri uri = existing;
            if (uri == null) {
                ContentValues v = new ContentValues();
                v.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
                v.put(MediaStore.MediaColumns.MIME_TYPE, "application/json");
                v.put(MediaStore.MediaColumns.RELATIVE_PATH, RELATIVE);
                uri = r.insert(collection(), v);
            }
            if (uri == null) throw new Exception("Could not create the backup file");
            try (OutputStream out = r.openOutputStream(uri, "wt")) {
                if (out == null) throw new Exception("Could not open the backup file");
                out.write(bytes);
            } catch (SecurityException se) {
                // The same name exists from an earlier install and is not ours to overwrite: write a numbered copy.
                return save(c, name.replace(".json", "-" + (System.currentTimeMillis() % 100000) + ".json"), text);
            }
            return uri;
        }
        File dir = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOCUMENTS), DIR);
        if (!dir.exists() && !dir.mkdirs()) throw new Exception("Could not create the backup folder");
        File f = new File(dir, name);
        try (FileOutputStream out = new FileOutputStream(f)) {
            out.write(bytes);
        }
        return Uri.fromFile(f);
    }

    /** The uri of a file by name in the backup folder, or null. */
    private static Uri find(Context c, String name) {
        String[] proj = { MediaStore.MediaColumns._ID };
        try (Cursor q = c.getContentResolver().query(collection(), proj, MediaStore.MediaColumns.DISPLAY_NAME + "=? AND " + MediaStore.MediaColumns.RELATIVE_PATH + " LIKE ?", new String[] { name, RELATIVE + "%" }, null)) {
            if (q != null && q.moveToFirst()) return ContentUris.withAppendedId(collection(), q.getLong(0));
        } catch (Exception ignored) {
            // not readable: treated as "not there"
        }
        return null;
    }

    // ---- Reading ----------------------------------------------------------------------------------------------------------

    /** Every backup file the app can see, newest name first. */
    public static List<Info> list(Context c) {
        List<Info> out = new ArrayList<>();
        if (scoped()) {
            String[] proj = { MediaStore.MediaColumns._ID, MediaStore.MediaColumns.DISPLAY_NAME, MediaStore.MediaColumns.SIZE, MediaStore.MediaColumns.DATE_MODIFIED };
            try (Cursor q = c.getContentResolver().query(collection(), proj, MediaStore.MediaColumns.RELATIVE_PATH + " LIKE ? AND " + MediaStore.MediaColumns.DISPLAY_NAME + " LIKE ?", new String[] { RELATIVE + "%", "today-%.json" }, MediaStore.MediaColumns.DISPLAY_NAME + " DESC")) {
                while (q != null && q.moveToNext()) {
                    Info i = new Info();
                    i.uri = ContentUris.withAppendedId(collection(), q.getLong(0)).toString();
                    i.name = q.getString(1);
                    i.size = q.getLong(2);
                    i.modified = q.getLong(3) * 1000L;
                    out.add(i);
                }
            } catch (Exception ignored) {
                // no access: an empty list
            }
        } else {
            File dir = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOCUMENTS), DIR);
            File[] files = dir.listFiles((d, n) -> n.startsWith("today-") && n.endsWith(".json"));
            if (files != null) {
                for (File f : files) {
                    Info i = new Info();
                    i.name = f.getName();
                    i.uri = Uri.fromFile(f).toString();
                    i.size = f.length();
                    i.modified = f.lastModified();
                    out.add(i);
                }
                Collections.sort(out, (a, b) -> b.name.compareTo(a.name));
            }
        }
        return out;
    }

    public static String read(Context c, Uri uri) throws Exception {
        try (InputStream in = c.getContentResolver().openInputStream(uri)) {
            if (in == null) throw new Exception("Could not open the file");
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[16384];
            int n;
            while ((n = in.read(buf)) > 0 && out.size() < 40 * 1024 * 1024) out.write(buf, 0, n);
            return out.toString("UTF-8");
        }
    }

    // ---- Keeping the last N -----------------------------------------------------------------------------------------------

    /** Deletes the older files whose names match `pattern`, keeping the newest `keep`. Only files this install can delete go; the rest stay. */
    public static int prune(Context c, Pattern pattern, int keep) {
        List<Info> mine = new ArrayList<>();
        for (Info i : list(c)) if (pattern.matcher(i.name).matches()) mine.add(i);
        int deleted = 0;
        for (int k = keep; k < mine.size(); k++) {
            try {
                Uri u = Uri.parse(mine.get(k).uri);
                if ("file".equals(u.getScheme())) {
                    if (new File(u.getPath()).delete()) deleted++;
                } else if (c.getContentResolver().delete(u, null, null) > 0) deleted++;
            } catch (Exception ignored) {
                // not ours to delete (an earlier install's file): it stays
            }
        }
        return deleted;
    }

    // ---- The weekly backup ----------------------------------------------------------------------------------------------------

    public static String todayName() {
        return "today-" + new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date()) + ".json";
    }

    /** The app's saved data as the backup text (the phone-calendar mirror is left out: it is re-read from the phone). */
    public static String currentData(Context c) {
        SharedPreferences p = c.getSharedPreferences(CAP_PREFS, Context.MODE_PRIVATE);
        String raw = p.getString(DATA_KEY, null);
        if (raw == null || raw.isEmpty()) return null;
        try {
            JSONObject o = new JSONObject(raw);
            o.remove("calendarEvents");
            return o.toString(2);
        } catch (Exception e) {
            return raw;
        }
    }

    /** Writes this week's backup from what the app has saved, keeps the last 8, and remembers when. */
    public static boolean runWeeklyBackup(Context c) {
        try {
            String text = currentData(c);
            if (text == null) return false;
            save(c, todayName(), text);
            prune(c, WEEKLY_NAME, 8);
            markDone(c, todayName());
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    public static void markDone(Context c, String name) {
        c.getSharedPreferences(STATUS_PREFS, Context.MODE_PRIVATE).edit().putLong("lastAt", System.currentTimeMillis()).putString("lastName", name).apply();
    }

    public static long lastAt(Context c) {
        return c.getSharedPreferences(STATUS_PREFS, Context.MODE_PRIVATE).getLong("lastAt", 0L);
    }

    /** The next Sunday at 21:30 (local time) after `now`. */
    public static long nextSunday2130(long now) {
        Calendar cal = Calendar.getInstance();
        cal.setTimeInMillis(now);
        cal.set(Calendar.HOUR_OF_DAY, 21);
        cal.set(Calendar.MINUTE, 30);
        cal.set(Calendar.SECOND, 0);
        cal.set(Calendar.MILLISECOND, 0);
        while (cal.get(Calendar.DAY_OF_WEEK) != Calendar.SUNDAY || cal.getTimeInMillis() <= now) cal.add(Calendar.DAY_OF_MONTH, 1);
        return cal.getTimeInMillis();
    }

    private static PendingIntent weeklyIntent(Context c) {
        Intent i = new Intent(c, BackupReceiver.class).setAction(ACTION_WEEKLY);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0);
        return PendingIntent.getBroadcast(c, 4417, i, flags);
    }

    /** Sets the alarm for the next Sunday 21:30. Safe to call again and again (it replaces itself). Returns when it will fire. */
    public static long scheduleWeekly(Context c) {
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        long at = nextSunday2130(System.currentTimeMillis());
        if (am != null) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, weeklyIntent(c));
            else am.set(AlarmManager.RTC_WAKEUP, at, weeklyIntent(c));
        }
        return at;
    }
}
