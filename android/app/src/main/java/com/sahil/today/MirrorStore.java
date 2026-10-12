package com.sahil.today;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.provider.CalendarContract;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.Calendar;
import java.util.Iterator;
import java.util.Locale;
import java.util.TimeZone;

/**
 * The "Today - Plan" mirror: a safety copy of the next 7 days in the Google calendar of that name.
 *
 * The app (lib/mirror.ts) works out WHAT should be there and sends a batch of inserts / updates / deletes; this class carries them out
 * and keeps the map  occurrence key -> calendar event id  (plus the content signature, the day, and "final" once a day has ended).
 * It also keeps the latest plan (yesterday .. +13 days), so the daily ~06:00 alarm can roll the window forward and finalise the day
 * that ended, even if the app is not opened (see BackupReceiver). Android cannot run the app's planner in the background, so the
 * alarm only uses the last plan the app saved.
 *
 * Mirror events get NO reminders (the app already notifies), and a past day is written once with its final state, then never touched.
 */
public final class MirrorStore {

    public static final String ACTION_DAILY = "com.sahil.today.DAILY_MIRROR";
    private static final String PREFS = "today_mirror";
    private static final int WINDOW_DAYS = 7;

    private MirrorStore() {}

    private static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private static JSONObject map(Context c) {
        try {
            String raw = prefs(c).getString("map", null);
            return raw == null ? new JSONObject() : new JSONObject(raw);
        } catch (Exception e) {
            return new JSONObject();
        }
    }

    public static long calendarId(Context c) {
        return prefs(c).getLong("calendarId", -1L);
    }

    /** { calendarId, map } as the app wants it. */
    public static JSONObject state(Context c) throws Exception {
        JSONObject o = new JSONObject();
        long id = calendarId(c);
        o.put("calendarId", id < 0 ? JSONObject.NULL : id);
        o.put("map", map(c));
        return o;
    }

    /** Writes one event; updates `existing` when it is still there, else inserts. Returns the event id or -1. */
    private static long write(ContentResolver cr, long calendarId, JSONObject ev, long existing) {
        try {
            boolean allDay = ev.optBoolean("allDay", false);
            long start = ev.getLong("start");
            long end = Math.max(ev.getLong("end"), start + 60_000L);
            ContentValues v = new ContentValues();
            v.put(CalendarContract.Events.TITLE, ev.getString("title"));
            v.put(CalendarContract.Events.DTSTART, start);
            v.put(CalendarContract.Events.DTEND, end);
            v.put(CalendarContract.Events.ALL_DAY, allDay ? 1 : 0);
            v.put(CalendarContract.Events.EVENT_TIMEZONE, allDay ? "UTC" : TimeZone.getDefault().getID());
            v.put(CalendarContract.Events.DESCRIPTION, ev.optString("description", ""));
            v.put(CalendarContract.Events.HAS_ALARM, 0);
            v.put(CalendarContract.Events.AVAILABILITY, CalendarContract.Events.AVAILABILITY_FREE);
            long id = -1;
            if (existing >= 0) {
                int n = cr.update(ContentUris.withAppendedId(CalendarContract.Events.CONTENT_URI, existing), v, null, null);
                if (n > 0) id = existing;
            }
            if (id < 0) {
                v.put(CalendarContract.Events.CALENDAR_ID, calendarId);
                Uri uri = cr.insert(CalendarContract.Events.CONTENT_URI, v);
                if (uri == null) return -1;
                id = ContentUris.parseId(uri);
            }
            // No reminders on mirror events: the app already notifies, so the calendar must not double up.
            cr.delete(CalendarContract.Reminders.CONTENT_URI, CalendarContract.Reminders.EVENT_ID + "=?", new String[] { String.valueOf(id) });
            return id;
        } catch (Exception e) {
            return -1;
        }
    }

    private static boolean remove(ContentResolver cr, long id) {
        try {
            cr.delete(ContentUris.withAppendedId(CalendarContract.Events.CONTENT_URI, id), null, null);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    private static JSONObject entry(long id, String sig, String day, boolean isFinal) throws Exception {
        return new JSONObject().put("id", id).put("sig", sig).put("day", day).put("final", isFinal);
    }

    /** Carries out the app's batch. Returns { inserted, updated, deleted, failed }. */
    public static synchronized JSONObject apply(Context c, long calendarId, JSONArray ops, JSONArray plan) throws Exception {
        ContentResolver cr = c.getContentResolver();
        JSONObject map = map(c);
        int inserted = 0, updated = 0, deleted = 0, failed = 0;
        for (int i = 0; i < ops.length(); i++) {
            JSONObject op = ops.getJSONObject(i);
            String kind = op.getString("op");
            String key = op.getString("key");
            String day = op.optString("day", "");
            String sig = op.optString("sig", "");
            boolean fin = op.optBoolean("final", false);
            JSONObject have = map.optJSONObject(key);
            if ("delete".equals(kind)) {
                if (have == null || remove(cr, have.optLong("id", -1))) {
                    map.remove(key);
                    deleted++;
                } else failed++;
            } else if ("update".equals(kind) && !op.has("event")) {
                // Only "this day has ended": nothing to rewrite.
                if (have != null) map.put(key, entry(have.optLong("id", -1), have.optString("sig", sig), have.optString("day", day), true));
            } else {
                JSONObject ev = op.getJSONObject("event");
                long existing = have == null ? -1 : have.optLong("id", -1);
                long id = write(cr, calendarId, ev, existing);
                if (id < 0) {
                    failed++;
                    continue;
                }
                map.put(key, entry(id, sig, day, fin));
                if ("insert".equals(kind) && existing < 0) inserted++;
                else updated++;
            }
        }
        prefs(c).edit().putLong("calendarId", calendarId).putString("map", map.toString()).putString("plan", plan == null ? "[]" : plan.toString()).putLong("planAt", System.currentTimeMillis()).apply();
        return new JSONObject().put("inserted", inserted).put("updated", updated).put("deleted", deleted).put("failed", failed);
    }

    private static String dayString(Calendar cal) {
        return new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(cal.getTime());
    }

    /**
     * The 06:00 alarm: window = today .. today+6 of the last plan the app saved. Adds what moved into the window, rewrites what changed,
     * removes what left it, and writes yesterday's final state (then never touches that day again).
     */
    public static synchronized void reconcile(Context c) {
        try {
            long calendarId = calendarId(c);
            String planRaw = prefs(c).getString("plan", null);
            if (calendarId < 0 || planRaw == null) return;
            if (c.checkSelfPermission(android.Manifest.permission.WRITE_CALENDAR) != android.content.pm.PackageManager.PERMISSION_GRANTED) return;
            ContentResolver cr = c.getContentResolver();
            JSONArray plan = new JSONArray(planRaw);
            JSONObject map = map(c);
            Calendar cal = Calendar.getInstance();
            String today = dayString(cal);
            cal.add(Calendar.DAY_OF_MONTH, WINDOW_DAYS - 1);
            String last = dayString(cal);

            JSONObject byKey = new JSONObject();
            for (int i = 0; i < plan.length(); i++) byKey.put(plan.getJSONObject(i).getString("key"), plan.getJSONObject(i));

            // Entries in the window: insert the new, rewrite the changed.
            for (int i = 0; i < plan.length(); i++) {
                JSONObject e = plan.getJSONObject(i);
                String day = e.getString("day");
                if (day.compareTo(today) < 0 || day.compareTo(last) > 0) continue;
                String key = e.getString("key");
                JSONObject have = map.optJSONObject(key);
                if (have != null && have.optBoolean("final", false)) continue;
                if (have != null && e.getString("sig").equals(have.optString("sig"))) continue;
                long id = write(cr, calendarId, e.getJSONObject("event"), have == null ? -1 : have.optLong("id", -1));
                if (id >= 0) map.put(key, entry(id, e.getString("sig"), day, false));
            }
            // Entries that left the window (or the plan), and days that have ended.
            Iterator<String> keys = map.keys();
            java.util.ArrayList<String> gone = new java.util.ArrayList<>();
            while (keys.hasNext()) {
                String key = keys.next();
                JSONObject m = map.getJSONObject(key);
                if (m.optBoolean("final", false)) continue;
                String day = m.optString("day", "");
                if (day.compareTo(today) >= 0) {
                    JSONObject e = byKey.optJSONObject(key);
                    if (e == null && day.compareTo(last) <= 0) gone.add(key);
                    else if (e != null && day.compareTo(last) > 0) gone.add(key);
                } else {
                    JSONObject e = byKey.optJSONObject(key);
                    long id = m.optLong("id", -1);
                    if (e != null && !e.getString("sig").equals(m.optString("sig"))) id = write(cr, calendarId, e.getJSONObject("event"), id);
                    map.put(key, entry(id, e != null ? e.getString("sig") : m.optString("sig"), day, true));
                }
            }
            for (String key : gone) {
                JSONObject m = map.getJSONObject(key);
                if (remove(cr, m.optLong("id", -1))) map.remove(key);
            }
            prefs(c).edit().putString("map", map.toString()).putLong("reconciledAt", System.currentTimeMillis()).apply();
        } catch (Exception ignored) {
            // a missed roll-forward is picked up the next time the app opens
        }
    }

    // ---- The daily alarm ---------------------------------------------------------------------------------------------

    /** The next 06:00 (local) after `now`. */
    public static long next0600(long now) {
        Calendar cal = Calendar.getInstance();
        cal.setTimeInMillis(now);
        cal.set(Calendar.HOUR_OF_DAY, 6);
        cal.set(Calendar.MINUTE, 0);
        cal.set(Calendar.SECOND, 0);
        cal.set(Calendar.MILLISECOND, 0);
        if (cal.getTimeInMillis() <= now) cal.add(Calendar.DAY_OF_MONTH, 1);
        return cal.getTimeInMillis();
    }

    private static PendingIntent dailyIntent(Context c) {
        Intent i = new Intent(c, BackupReceiver.class).setAction(ACTION_DAILY);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0);
        return PendingIntent.getBroadcast(c, 4418, i, flags);
    }

    /** Sets the ~06:00 alarm (not exact: Android may shift it a little). Safe to call again; it replaces itself. */
    public static long scheduleDaily(Context c) {
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        long at = next0600(System.currentTimeMillis());
        if (am != null) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, dailyIntent(c));
            else am.set(AlarmManager.RTC_WAKEUP, at, dailyIntent(c));
        }
        return at;
    }
}
