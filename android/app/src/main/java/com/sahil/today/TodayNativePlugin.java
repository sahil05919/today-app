package com.sahil.today;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.ContentResolver;
import android.content.ContentUris;
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

/**
 * Small native helper for Sahil's Today:
 *  - launch intents: "Share to Today" (text), selected text ("Add to Today"), calendar invites (.ics), app-icon shortcuts
 *  - read-only phone calendar (Android Calendar Provider, offline)
 *  - a short audio recorder (16 kHz mono WAV) so Gemini can transcribe what you said
 *  - vibration, battery optimisation status, the alarm notification channel
 */
@CapacitorPlugin(
    name = "TodayNative",
    permissions = {
        @Permission(strings = { Manifest.permission.READ_CALENDAR }, alias = "calendar"),
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
        return null;
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
        Long from = call.getLong("from");
        Long to = call.getLong("to");
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
                CalendarContract.Instances.SELF_ATTENDEE_STATUS
            };
            ContentResolver cr = getContext().getContentResolver();
            c = cr.query(builder.build(), projection, null, null, CalendarContract.Instances.BEGIN + " ASC");
            int count = 0;
            while (c != null && c.moveToNext() && count < 1500) {
                int status = c.getInt(6);
                int attendee = c.getInt(7);
                // Cancelled events, and invites you declined, don't belong in your day.
                if (status == CalendarContract.Events.STATUS_CANCELED) continue;
                if (attendee == CalendarContract.Attendees.ATTENDEE_STATUS_DECLINED) continue;
                JSObject e = new JSObject();
                e.put("id", c.getLong(0) + ":" + c.getLong(2));
                String title = c.getString(1);
                e.put("title", title == null || title.trim().isEmpty() ? "Event" : title);
                e.put("begin", c.getLong(2));
                e.put("end", c.getLong(3));
                e.put("allDay", c.getInt(4) == 1);
                String loc = c.getString(5);
                if (loc != null && !loc.isEmpty()) e.put("location", loc);
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
