package com.sahil.today;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.provider.CalendarContract;
import android.provider.Settings;
import android.util.Base64;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.List;
import java.util.TimeZone;

/**
 * Small native helper for Sahil's Today:
 *  - launch intents: "Share to Today" (text), selected text ("Add to Today"), calendar invites (.ics), app-icon shortcuts
 *  - the phone calendar (Android Calendar Provider, offline): read your events; write the ones you create in Today
 *  - weekly backups to Documents/TodayBackups (see BackupStore), and the Sunday 21:30 alarm that makes them
 *  - a short audio recorder (16 kHz mono WAV) so Gemini can transcribe what you said
 *  - vibration, battery optimisation status, the alarm notification channel
 */
@CapacitorPlugin(
    name = "TodayNative",
    permissions = {
        @Permission(strings = { Manifest.permission.READ_CALENDAR }, alias = "calendar"),
        // Writing the events you create in Today to the phone's calendar (Google Calendar syncs them).
        @Permission(strings = { Manifest.permission.READ_CALENDAR, Manifest.permission.WRITE_CALENDAR }, alias = "calendarWrite"),
        // Only used on Android 7-9: newer Android writes the backup through MediaStore without any permission.
        @Permission(strings = { Manifest.permission.WRITE_EXTERNAL_STORAGE }, alias = "storage"),
        @Permission(strings = { Manifest.permission.RECORD_AUDIO }, alias = "microphone")
    }
)
public class TodayNativePlugin extends Plugin {

    public static final String ACTION_NEW_TASK = "com.sahil.today.NEW_TASK";
    public static final String ACTION_VOICE_TASK = "com.sahil.today.VOICE_TASK";
    private static final int MAX_ICS_BYTES = 400 * 1024;

    /** The most recent launch intent that the web side has not consumed yet. */
    private JSObject pending = null;

    @Override
    public void load() {
        // Cold start: the app was opened by a share or a shortcut.
        pending = parse(getActivity().getIntent());
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        JSObject parsed = parse(intent);
        if (parsed != null) {
            pending = parsed;
            // retainUntilConsumed = true: delivered even if the page has not added its listener yet.
            notifyListeners("launchIntent", parsed, true);
        }
    }

    /**
     * A whole number from the page. Capacitor's call.getLong() only accepts a java Long, but org.json parses a small number (a
     * calendar id such as 3, an event id) as an Integer, so getLong() silently returned null and the call failed with
     * "... is required". This accepts any number, and a numeric string.
     */
    private static Long longOf(PluginCall call, String name) {
        Object v = call.getData().opt(name);
        if (v instanceof Number) return ((Number) v).longValue();
        if (v instanceof String) {
            try {
                return Long.parseLong(((String) v).trim());
            } catch (NumberFormatException e) {
                return null;
            }
        }
        return null;
    }

    /** An array from the page: a real array, or the same array sent as a JSON string. */
    private static JSArray arrayOf(PluginCall call, String name) {
        Object v = call.getData().opt(name);
        try {
            if (v instanceof org.json.JSONArray) return new JSArray(v.toString());
            if (v instanceof String) return new JSArray((String) v);
        } catch (Exception e) {
            return null;
        }
        return null;
    }

    private String readText(Uri uri) {
        if (uri == null) return null;
        try (InputStream in = getContext().getContentResolver().openInputStream(uri)) {
            if (in == null) return null;
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0 && out.size() < MAX_ICS_BYTES) out.write(buf, 0, n);
            return out.toString("UTF-8");
        } catch (Exception e) {
            return null;
        }
    }

    private JSObject parse(Intent intent) {
        if (intent == null || intent.getAction() == null) return null;
        String action = intent.getAction();
        String type = intent.getType();
        JSObject out = new JSObject();

        // A calendar invite opened with "Open with Today", or shared to it.
        boolean calendarType = type != null && (type.startsWith("text/calendar") || type.equals("application/ics"));
        Uri data = intent.getData();
        boolean icsName = data != null && data.getLastPathSegment() != null && data.getLastPathSegment().toLowerCase().endsWith(".ics");
        if (Intent.ACTION_VIEW.equals(action) && (calendarType || icsName)) {
            String text = readText(data);
            if (text == null) return null;
            out.put("kind", "ics");
            out.put("text", text);
            return out;
        }
        if (Intent.ACTION_SEND.equals(action) && calendarType) {
            Uri stream = intent.getParcelableExtra(Intent.EXTRA_STREAM);
            String text = readText(stream);
            if (text == null) text = intent.getStringExtra(Intent.EXTRA_TEXT);
            if (text == null) return null;
            out.put("kind", "ics");
            out.put("text", text);
            return out;
        }

        // Text shared from WhatsApp, Gmail, Chrome…
        if (Intent.ACTION_SEND.equals(action)) {
            String text = intent.getStringExtra(Intent.EXTRA_TEXT);
            String subject = intent.getStringExtra(Intent.EXTRA_SUBJECT);
            if (text == null && subject == null) return null;
            out.put("kind", "share");
            if (text != null) out.put("text", text);
            if (subject != null) out.put("title", subject);
            return out;
        }
        // Text selected in any app, then "Add to Today" from the selection menu.
        if (Intent.ACTION_PROCESS_TEXT.equals(action)) {
            CharSequence selected = intent.getCharSequenceExtra(Intent.EXTRA_PROCESS_TEXT);
            if (selected == null) return null;
            out.put("kind", "share");
            out.put("text", selected.toString());
            return out;
        }
        if (ACTION_NEW_TASK.equals(action)) {
            out.put("kind", "new");
            return out;
        }
        if (ACTION_VOICE_TASK.equals(action)) {
            out.put("kind", "voice");
            return out;
        }
        // The widget's Start button: open straight into that item with its timer running.
        if (TodayWidgetProvider.ACTION_START.equals(action)) {
            out.put("kind", "start");
            String itemKind = intent.getStringExtra("itemKind");
            String ref = intent.getStringExtra("ref");
            String taskId = intent.getStringExtra("taskId");
            String key = intent.getStringExtra("key");
            if (itemKind != null) out.put("itemKind", itemKind);
            if (ref != null && !ref.isEmpty()) out.put("ref", ref);
            if (taskId != null && !taskId.isEmpty()) out.put("taskId", taskId);
            if (key != null) out.put("key", key);
            return out;
        }
        return null;
    }

    // ---- Home-screen widget ----------------------------------------------------------------------------

    /** Saves the widget's snapshot (JSON, built by lib/widget.ts) and redraws every widget. */
    @PluginMethod
    public void widgetUpdate(PluginCall call) {
        String snapshot = call.getString("snapshot");
        if (snapshot == null || snapshot.length() > 200_000) {
            call.reject("snapshot is required");
            return;
        }
        TodayWidgetProvider.saveSnapshot(getContext(), snapshot);
        call.resolve();
    }

    /** { actions: [{ type: "done", kind, key, ref?, taskId?, date, at }] }: Dones tapped on the widget. Clears them. */
    @PluginMethod
    public void widgetTakePending(PluginCall call) {
        JSObject result = new JSObject();
        try {
            result.put("actions", new JSArray(TodayWidgetProvider.takePending(getContext())));
        } catch (Exception e) {
            result.put("actions", new JSArray());
        }
        call.resolve(result);
    }

    /** Returns { intent?: {kind, text?, title?} } once, then clears it. */
    @PluginMethod
    public void consumeLaunchIntent(PluginCall call) {
        JSObject result = new JSObject();
        if (pending != null) {
            result.put("intent", pending);
            pending = null;
        }
        call.resolve(result);
    }

    // ---- Calendar (read-only) --------------------------------------------------------------------------

    private String stateOf(String alias) {
        PermissionState s = getPermissionState(alias);
        if (s == PermissionState.GRANTED) return "granted";
        if (s == PermissionState.DENIED) return "denied";
        return "prompt";
    }

    /** { state: "granted" | "denied" | "prompt" } */
    @PluginMethod
    public void calendarPermission(PluginCall call) {
        JSObject r = new JSObject();
        r.put("state", stateOf("calendar"));
        call.resolve(r);
    }

    /** Asks once, with Android's own dialog. */
    @PluginMethod
    public void requestCalendarPermission(PluginCall call) {
        if (getPermissionState("calendar") == PermissionState.GRANTED) {
            calendarPermission(call);
            return;
        }
        requestPermissionForAlias("calendar", call, "calendarPermissionResult");
    }

    @PermissionCallback
    private void calendarPermissionResult(PluginCall call) {
        calendarPermission(call);
    }

    /**
     * Events between from and to (epoch ms), recurring ones already expanded, as
     * { events: [{ id, title, begin, end, allDay, location }] }. All-day events come as UTC midnights (Android's rule).
     */
    @PluginMethod
    public void queryCalendar(PluginCall call) {
        if (getPermissionState("calendar") != PermissionState.GRANTED) {
            call.reject("Calendar permission is not granted");
            return;
        }
        Long from = longOf(call, "from");
        Long to = longOf(call, "to");
        if (from == null || to == null || to <= from) {
            call.reject("from and to are required");
            return;
        }
        JSArray events = new JSArray();
        Cursor c = null;
        try {
            Uri.Builder builder = CalendarContract.Instances.CONTENT_URI.buildUpon();
            ContentUris.appendId(builder, from);
            ContentUris.appendId(builder, to);
            String[] projection = new String[] {
                CalendarContract.Instances.EVENT_ID,
                CalendarContract.Instances.TITLE,
                CalendarContract.Instances.BEGIN,
                CalendarContract.Instances.END,
                CalendarContract.Instances.ALL_DAY,
                CalendarContract.Instances.EVENT_LOCATION,
                CalendarContract.Instances.STATUS,
                CalendarContract.Instances.SELF_ATTENDEE_STATUS,
                CalendarContract.Instances.CALENDAR_ID,
                CalendarContract.Instances.DESCRIPTION
            };
            ContentResolver cr = getContext().getContentResolver();
            // Calendars to leave out (Today's own "Today - Plan" / "Today - Inbox") or to read exclusively. Numbers only: safe to inline.
            String selection = null;
            JSArray exclude = arrayOf(call, "excludeCalendarIds");
            JSArray only = arrayOf(call, "calendarIds");
            if (only != null && only.length() > 0) selection = CalendarContract.Instances.CALENDAR_ID + " IN (" + joinIds(only) + ")";
            else if (exclude != null && exclude.length() > 0) selection = CalendarContract.Instances.CALENDAR_ID + " NOT IN (" + joinIds(exclude) + ")";
            c = cr.query(builder.build(), projection, selection, null, CalendarContract.Instances.BEGIN + " ASC");
            int count = 0;
            while (c != null && c.moveToNext() && count < 1500) {
                int status = c.getInt(6);
                int attendee = c.getInt(7);
                // Cancelled events, and invites you declined, don't belong in your day.
                if (status == CalendarContract.Events.STATUS_CANCELED) continue;
                if (attendee == CalendarContract.Attendees.ATTENDEE_STATUS_DECLINED) continue;
                JSObject e = new JSObject();
                e.put("id", c.getLong(0) + ":" + c.getLong(2));
                // The phone's own id of the event, so an event Today wrote itself is not read back in as a second one.
                e.put("eventId", c.getLong(0));
                String title = c.getString(1);
                e.put("title", title == null || title.trim().isEmpty() ? "Event" : title);
                e.put("begin", c.getLong(2));
                e.put("end", c.getLong(3));
                e.put("allDay", c.getInt(4) == 1);
                String loc = c.getString(5);
                if (loc != null && !loc.isEmpty()) e.put("location", loc);
                e.put("calendarId", c.getLong(8));
                String desc = c.getString(9);
                if (desc != null && !desc.isEmpty()) e.put("description", desc.length() > 2000 ? desc.substring(0, 2000) : desc);
                events.put(e);
                count++;
            }
            JSObject result = new JSObject();
            result.put("events", events);
            call.resolve(result);
        } catch (SecurityException se) {
            call.reject("Calendar permission is not granted");
        } catch (Exception ex) {
            call.reject("Could not read the calendar");
        } finally {
            if (c != null) c.close();
        }
    }

    private static String joinIds(JSArray ids) throws Exception {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < ids.length(); i++) {
            if (i > 0) sb.append(',');
            sb.append(ids.getLong(i));
        }
        return sb.toString();
    }

    // ---- The "Today - Plan" mirror --------------------------------------------------------------------------

    /** { calendarId, map }: the calendar the mirror writes to and the occurrence key -> event id map. */
    @PluginMethod
    public void mirrorState(PluginCall call) {
        try {
            call.resolve(new JSObject(MirrorStore.state(getContext()).toString()));
        } catch (Exception e) {
            call.reject("Could not read the mirror state");
        }
    }

    /** { calendarId, ops: [{op, key, day, sig, event?, final?}], plan: [...] }. Resolves { inserted, updated, deleted, failed }. */
    @PluginMethod
    public void mirrorApply(PluginCall call) {
        if (getPermissionState("calendarWrite") != PermissionState.GRANTED) {
            call.reject("Calendar permission is not granted");
            return;
        }
        Long calendarId = longOf(call, "calendarId");
        JSArray ops = arrayOf(call, "ops");
        if (calendarId == null) {
            call.reject("calendarId is missing or not a number (got: " + call.getData().opt("calendarId") + ")");
            return;
        }
        if (ops == null) {
            call.reject("ops is missing or not an array");
            return;
        }
        try {
            call.resolve(new JSObject(MirrorStore.apply(getContext(), calendarId, ops, arrayOf(call, "plan")).toString()));
        } catch (SecurityException se) {
            call.reject("Calendar permission is not granted");
        } catch (Exception e) {
            call.reject("Could not update the Plan calendar");
        }
    }

    /** Arms the daily ~06:00 alarm that rolls the mirror forward (also after a reboot, see BackupReceiver). */
    @PluginMethod
    public void scheduleDailyMirror(PluginCall call) {
        JSObject r = new JSObject();
        r.put("at", MirrorStore.scheduleDaily(getContext()));
        call.resolve(r);
    }

    // ---- Calendar (write) --------------------------------------------------------------------------------

    /** { state } for reading AND writing the calendar. */
    @PluginMethod
    public void calendarWritePermission(PluginCall call) {
        JSObject r = new JSObject();
        r.put("state", stateOf("calendarWrite"));
        call.resolve(r);
    }

    @PluginMethod
    public void requestCalendarWritePermission(PluginCall call) {
        if (getPermissionState("calendarWrite") == PermissionState.GRANTED) {
            calendarWritePermission(call);
            return;
        }
        requestPermissionForAlias("calendarWrite", call, "calendarWritePermissionResult");
    }

    @PermissionCallback
    private void calendarWritePermissionResult(PluginCall call) {
        calendarWritePermission(call);
    }

    /** The calendars an event can be written to: { calendars: [{ id, name, account, accountType, primary }] }. */
    @PluginMethod
    public void listCalendars(PluginCall call) {
        if (getPermissionState("calendarWrite") != PermissionState.GRANTED) {
            call.reject("Calendar permission is not granted");
            return;
        }
        JSArray list = new JSArray();
        Cursor c = null;
        try {
            String[] projection = new String[] {
                CalendarContract.Calendars._ID,
                CalendarContract.Calendars.CALENDAR_DISPLAY_NAME,
                CalendarContract.Calendars.ACCOUNT_NAME,
                CalendarContract.Calendars.ACCOUNT_TYPE,
                CalendarContract.Calendars.OWNER_ACCOUNT,
                CalendarContract.Calendars.IS_PRIMARY
            };
            c = getContext().getContentResolver().query(
                CalendarContract.Calendars.CONTENT_URI,
                projection,
                CalendarContract.Calendars.CALENDAR_ACCESS_LEVEL + " >= ?",
                new String[] { String.valueOf(CalendarContract.Calendars.CAL_ACCESS_CONTRIBUTOR) },
                CalendarContract.Calendars.ACCOUNT_NAME + " ASC"
            );
            while (c != null && c.moveToNext()) {
                JSObject o = new JSObject();
                o.put("id", c.getLong(0));
                o.put("name", c.getString(1));
                o.put("account", c.getString(2));
                o.put("accountType", c.getString(3));
                String owner = c.getString(4);
                // The account's own calendar: its owner is the account, or it says it is the primary one.
                o.put("primary", c.getInt(5) == 1 || (owner != null && owner.equals(c.getString(2))));
                list.put(o);
            }
            JSObject r = new JSObject();
            r.put("calendars", list);
            call.resolve(r);
        } catch (SecurityException se) {
            call.reject("Calendar permission is not granted");
        } catch (Exception e) {
            call.reject("Could not list the calendars");
        } finally {
            if (c != null) c.close();
        }
    }

    /**
     * Adds an event to a calendar, or updates it when `eventId` is given (and still exists). Resolves { eventId }.
     * { calendarId, eventId?, title, start, end (epoch ms), allDay?, description?, location? }
     */
    @PluginMethod
    public void upsertCalendarEvent(PluginCall call) {
        if (getPermissionState("calendarWrite") != PermissionState.GRANTED) {
            call.reject("Calendar permission is not granted");
            return;
        }
        Long calendarId = longOf(call, "calendarId");
        Long start = longOf(call, "start");
        Long end = longOf(call, "end");
        String title = call.getString("title");
        if (calendarId == null || start == null || end == null || title == null) {
            call.reject("calendarId, title, start and end are required");
            return;
        }
        boolean allDay = Boolean.TRUE.equals(call.getBoolean("allDay", false));
        try {
            ContentValues v = new ContentValues();
            v.put(CalendarContract.Events.TITLE, title);
            v.put(CalendarContract.Events.DTSTART, start);
            v.put(CalendarContract.Events.DTEND, Math.max(end, start + 60_000L));
            v.put(CalendarContract.Events.ALL_DAY, allDay ? 1 : 0);
            // All-day events live in UTC (Android's rule); timed ones in the phone's zone.
            v.put(CalendarContract.Events.EVENT_TIMEZONE, allDay ? "UTC" : TimeZone.getDefault().getID());
            String description = call.getString("description");
            String location = call.getString("location");
            if (description != null) v.put(CalendarContract.Events.DESCRIPTION, description);
            if (location != null) v.put(CalendarContract.Events.EVENT_LOCATION, location);
            ContentResolver cr = getContext().getContentResolver();
            Long eventId = longOf(call, "eventId");
            if (eventId != null) {
                int n = cr.update(ContentUris.withAppendedId(CalendarContract.Events.CONTENT_URI, eventId), v, null, null);
                if (n > 0) {
                    JSObject r = new JSObject();
                    r.put("eventId", eventId);
                    call.resolve(r);
                    return;
                }
                // It was deleted in the calendar app: write it again.
            }
            v.put(CalendarContract.Events.CALENDAR_ID, calendarId);
            Uri uri = cr.insert(CalendarContract.Events.CONTENT_URI, v);
            if (uri == null) {
                call.reject("Could not add the event");
                return;
            }
            JSObject r = new JSObject();
            r.put("eventId", ContentUris.parseId(uri));
            call.resolve(r);
        } catch (SecurityException se) {
            call.reject("Calendar permission is not granted");
        } catch (Exception e) {
            call.reject("Could not write the event");
        }
    }

    @PluginMethod
    public void deleteCalendarEvent(PluginCall call) {
        if (getPermissionState("calendarWrite") != PermissionState.GRANTED) {
            call.reject("Calendar permission is not granted");
            return;
        }
        Long eventId = longOf(call, "eventId");
        if (eventId == null) {
            call.reject("eventId is required");
            return;
        }
        try {
            getContext().getContentResolver().delete(ContentUris.withAppendedId(CalendarContract.Events.CONTENT_URI, eventId), null, null);
            call.resolve();
        } catch (Exception e) {
            call.reject("Could not delete the event");
        }
    }

    // ---- Backups ---------------------------------------------------------------------------------------------

    /** Writes { name, text } to Documents/TodayBackups. Resolves { name, uri }. */
    @PluginMethod
    public void saveBackup(PluginCall call) {
        String name = call.getString("name");
        String text = call.getString("text");
        if (name == null || text == null || !name.matches("^today-[A-Za-z0-9._-]+\\.json$")) {
            call.reject("A backup needs a name (today-….json) and text");
            return;
        }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q && getPermissionState("storage") != PermissionState.GRANTED) {
            requestPermissionForAlias("storage", call, "storagePermissionResult");
            return;
        }
        doSaveBackup(call);
    }

    @PermissionCallback
    private void storagePermissionResult(PluginCall call) {
        if (getPermissionState("storage") != PermissionState.GRANTED) {
            call.reject("Storage permission is not granted");
            return;
        }
        doSaveBackup(call);
    }

    private void doSaveBackup(PluginCall call) {
        String name = call.getString("name");
        try {
            Uri uri = BackupStore.save(getContext(), name, call.getString("text"));
            if (BackupStore.WEEKLY_NAME.matcher(name).matches()) BackupStore.markDone(getContext(), name);
            JSObject r = new JSObject();
            r.put("name", name);
            r.put("uri", uri.toString());
            call.resolve(r);
        } catch (Exception e) {
            call.reject(e.getMessage() == null ? "Could not write the backup" : e.getMessage());
        }
    }

    /** { backups: [{ name, uri, size, modified }] }, newest name first. */
    @PluginMethod
    public void listBackups(PluginCall call) {
        JSArray list = new JSArray();
        for (BackupStore.Info i : BackupStore.list(getContext())) {
            JSObject o = new JSObject();
            o.put("name", i.name);
            o.put("uri", i.uri);
            o.put("size", i.size);
            o.put("modified", i.modified);
            list.put(o);
        }
        JSObject r = new JSObject();
        r.put("backups", list);
        call.resolve(r);
    }

    /** Keeps the newest `keep` of the weekly backups (today-YYYY-MM-DD.json), or of the pre-restore ones. */
    @PluginMethod
    public void pruneBackups(PluginCall call) {
        int keep = Math.max(1, Math.min(60, call.getInt("keep", 8)));
        String kind = call.getString("kind");
        java.util.regex.Pattern pattern = "restore".equals(kind) ? java.util.regex.Pattern.compile("^today-pre-restore-.*\\.json$") : "history".equals(kind) ? java.util.regex.Pattern.compile("^today-history-.*\\.json$") : BackupStore.WEEKLY_NAME;
        int n = BackupStore.prune(getContext(), pattern, keep);
        JSObject r = new JSObject();
        r.put("deleted", n);
        call.resolve(r);
    }

    @PluginMethod
    public void readBackup(PluginCall call) {
        String uri = call.getString("uri");
        if (uri == null) {
            call.reject("uri is required");
            return;
        }
        try {
            JSObject r = new JSObject();
            r.put("text", BackupStore.read(getContext(), Uri.parse(uri)));
            call.resolve(r);
        } catch (Exception e) {
            call.reject("Could not read that backup");
        }
    }

    /** Opens Android's share sheet for a backup file (Google Drive, email, WhatsApp…). */
    @PluginMethod
    public void shareBackup(PluginCall call) {
        String uri = call.getString("uri");
        if (uri == null) {
            call.reject("uri is required");
            return;
        }
        try {
            Uri u = Uri.parse(uri);
            if ("file".equals(u.getScheme())) {
                u = androidx.core.content.FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", new java.io.File(u.getPath()));
            }
            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType("application/json");
            send.putExtra(Intent.EXTRA_STREAM, u);
            send.putExtra(Intent.EXTRA_SUBJECT, "Today backup");
            send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            Intent chooser = Intent.createChooser(send, "Share backup");
            chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(chooser);
            call.resolve();
        } catch (Exception e) {
            call.reject("Could not share that backup");
        }
    }

    /** { lastAt, count, nextAt }: the last weekly backup (epoch ms, 0 = never), how many files the app can see, and when the alarm is set for. */
    @PluginMethod
    public void backupStatus(PluginCall call) {
        List<BackupStore.Info> all = BackupStore.list(getContext());
        int weekly = 0;
        for (BackupStore.Info i : all) if (BackupStore.WEEKLY_NAME.matcher(i.name).matches()) weekly++;
        JSObject r = new JSObject();
        r.put("lastAt", BackupStore.lastAt(getContext()));
        r.put("count", weekly);
        r.put("nextAt", BackupStore.nextSunday2130(System.currentTimeMillis()));
        call.resolve(r);
    }

    /** Sets the Sunday 21:30 alarm that writes the weekly backup (also after a reboot, see BackupReceiver). */
    @PluginMethod
    public void scheduleWeeklyBackup(PluginCall call) {
        JSObject r = new JSObject();
        r.put("at", BackupStore.scheduleWeekly(getContext()));
        call.resolve(r);
    }

    // ---- Vibration -------------------------------------------------------------------------------------

    @PluginMethod
    public void vibrate(PluginCall call) {
        try {
            int ms = Math.max(1, Math.min(500, call.getInt("ms", 20)));
            Vibrator v = (Vibrator) getContext().getSystemService(Context.VIBRATOR_SERVICE);
            if (v != null && v.hasVibrator()) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) v.vibrate(VibrationEffect.createOneShot(ms, VibrationEffect.DEFAULT_AMPLITUDE));
                else v.vibrate(ms);
            }
        } catch (Exception ignored) {
            // a missing buzz is never worth an error
        }
        call.resolve();
    }

    // ---- Audio recorder: 16 kHz mono WAV for Gemini ------------------------------------------------------

    private static final int SAMPLE_RATE = 16000;
    private AudioRecord recorder = null;
    private Thread recordThread = null;
    private volatile boolean recording = false;
    private ByteArrayOutputStream pcm = null;
    private long recordStartedAt = 0;

    /** { state } for the microphone, the same shape as the calendar's. */
    @PluginMethod
    public void micPermission(PluginCall call) {
        JSObject r = new JSObject();
        r.put("state", stateOf("microphone"));
        call.resolve(r);
    }

    /** Starts recording (asking for the microphone first if needed). Resolves once recording has begun. */
    @PluginMethod
    public void startRecording(PluginCall call) {
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            requestPermissionForAlias("microphone", call, "micPermissionResult");
            return;
        }
        beginRecording(call);
    }

    @PermissionCallback
    private void micPermissionResult(PluginCall call) {
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            call.reject("Microphone permission is not granted");
            return;
        }
        beginRecording(call);
    }

    private void beginRecording(PluginCall call) {
        stopQuietly();
        int maxMs = Math.max(3000, Math.min(120000, call.getInt("maxMs", 60000)));
        try {
            int min = AudioRecord.getMinBufferSize(SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
            if (min <= 0) {
                call.reject("This phone can't record audio");
                return;
            }
            final int bufSize = Math.max(min, SAMPLE_RATE);
            recorder = new AudioRecord(MediaRecorder.AudioSource.MIC, SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, bufSize);
            if (recorder.getState() != AudioRecord.STATE_INITIALIZED) {
                recorder.release();
                recorder = null;
                call.reject("Could not open the microphone");
                return;
            }
            pcm = new ByteArrayOutputStream();
            recording = true;
            recordStartedAt = System.currentTimeMillis();
            final AudioRecord rec = recorder;
            final ByteArrayOutputStream sink = pcm;
            rec.startRecording();
            recordThread = new Thread(() -> {
                byte[] buf = new byte[4096];
                while (recording && System.currentTimeMillis() - recordStartedAt < maxMs) {
                    int n = rec.read(buf, 0, buf.length);
                    if (n > 0) {
                        synchronized (sink) {
                            sink.write(buf, 0, n);
                        }
                    } else if (n < 0) {
                        break;
                    }
                }
            }, "today-recorder");
            recordThread.start();
            call.resolve();
        } catch (Exception e) {
            stopQuietly();
            call.reject("Could not start recording");
        }
    }

    /** Stops and returns { base64, mime: "audio/wav", ms }. */
    @PluginMethod
    public void stopRecording(PluginCall call) {
        if (recorder == null || pcm == null) {
            call.reject("Not recording");
            return;
        }
        byte[] data;
        long ms = System.currentTimeMillis() - recordStartedAt;
        recording = false;
        try {
            if (recordThread != null) recordThread.join(800);
        } catch (InterruptedException ignored) {
            Thread.currentThread().interrupt();
        }
        synchronized (pcm) {
            data = pcm.toByteArray();
        }
        stopQuietly();
        JSObject r = new JSObject();
        r.put("base64", Base64.encodeToString(wav(data), Base64.NO_WRAP));
        r.put("mime", "audio/wav");
        r.put("ms", ms);
        call.resolve(r);
    }

    /** Throws the recording away. */
    @PluginMethod
    public void cancelRecording(PluginCall call) {
        recording = false;
        stopQuietly();
        call.resolve();
    }

    private void stopQuietly() {
        recording = false;
        try {
            if (recorder != null) {
                try {
                    recorder.stop();
                } catch (Exception ignored) {
                    // not started
                }
                recorder.release();
            }
        } catch (Exception ignored) {
            // nothing to release
        }
        recorder = null;
        recordThread = null;
        pcm = null;
    }

    private static byte[] wav(byte[] pcmData) {
        int byteRate = SAMPLE_RATE * 2;
        ByteBuffer b = ByteBuffer.allocate(44 + pcmData.length).order(ByteOrder.LITTLE_ENDIAN);
        b.put(new byte[] { 'R', 'I', 'F', 'F' });
        b.putInt(36 + pcmData.length);
        b.put(new byte[] { 'W', 'A', 'V', 'E', 'f', 'm', 't', ' ' });
        b.putInt(16);
        b.putShort((short) 1); // PCM
        b.putShort((short) 1); // mono
        b.putInt(SAMPLE_RATE);
        b.putInt(byteRate);
        b.putShort((short) 2); // block align
        b.putShort((short) 16); // bits per sample
        b.put(new byte[] { 'd', 'a', 't', 'a' });
        b.putInt(pcmData.length);
        b.put(pcmData);
        return b.array();
    }

    // ---- Notifications and battery ---------------------------------------------------------------------

    /**
     * Creates the notification channel timed reminders use: the phone's alarm ringtone, played at alarm volume,
     * heads-up on the lock screen. Capacitor can only set a bundled sound file on a channel, so this is done natively.
     * Safe to call repeatedly (Android keeps the first definition of a channel).
     */
    @PluginMethod
    public void createAlarmChannel(PluginCall call) {
        String id = call.getString("id", "today-alarm");
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            call.resolve();
            return;
        }
        try {
            NotificationManager nm = (NotificationManager) getContext().getSystemService(Context.NOTIFICATION_SERVICE);
            Uri sound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
            if (sound == null) sound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
            NotificationChannel channel = new NotificationChannel(id, "Alarms", NotificationManager.IMPORTANCE_HIGH);
            channel.setDescription("Reminders you set for a specific time. Rings like an alarm.");
            channel.setSound(
                sound,
                new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ALARM)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build()
            );
            channel.enableVibration(true);
            channel.setVibrationPattern(new long[] { 0, 500, 300, 500, 300, 800 });
            channel.setLockscreenVisibility(android.app.Notification.VISIBILITY_PUBLIC);
            channel.setBypassDnd(true); // only takes effect if the user has granted Do Not Disturb access
            nm.createNotificationChannel(channel);
            call.resolve();
        } catch (Exception e) {
            call.reject("Could not create the alarm channel");
        }
    }

    /** { ignoring: true } when Android will not put the app to sleep to save battery. */
    @PluginMethod
    public void batteryStatus(PluginCall call) {
        boolean ignoring = true;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            PowerManager pm = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
            ignoring = pm != null && pm.isIgnoringBatteryOptimizations(getContext().getPackageName());
        }
        JSObject result = new JSObject();
        result.put("ignoring", ignoring);
        call.resolve(result);
    }

    /** Opens the battery optimisation list (or the app's own settings page as a fallback). */
    @PluginMethod
    public void openBatterySettings(PluginCall call) {
        try {
            Intent intent = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception first) {
            try {
                Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
                intent.setData(Uri.parse("package:" + getContext().getPackageName()));
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(intent);
                call.resolve();
            } catch (Exception second) {
                call.reject("Could not open settings");
            }
        }
    }
}
