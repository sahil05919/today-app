package com.sahil.today;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Calendar;
import java.util.List;

/**
 * The home-screen widget: "Next up" with Start and Done (small), plus the next two things and this week's % (medium).
 *
 * There is no planning logic here. The web app computes a small JSON snapshot (see lib/widget.ts) and saves it through
 * TodayNativePlugin.widgetUpdate; this class only picks "Next up" from it by the clock (the same rule as the app's
 * nextUp) and draws it. A light refresh is scheduled at each item's start and end and at midnight.
 *
 * Done: the item is hidden from the widget at once, and the action waits in a small queue in SharedPreferences. The app
 * applies it through its normal actions the next time it opens or resumes (so sessions are counted properly).
 * Start: opens the app straight into that item with its timer running (a START_ITEM intent, routed like a notification tap).
 *
 * Everything here fails soft: a broken snapshot just shows "Open Today".
 */
public class TodayWidgetProvider extends AppWidgetProvider {

    static final String PREFS = "today_widget";
    static final String ACTION_DONE = "com.sahil.today.WIDGET_DONE";
    static final String ACTION_REFRESH = "com.sahil.today.WIDGET_REFRESH";
    static final String ACTION_START = "com.sahil.today.START_ITEM";
    private static final int MAX_QUEUE = 100;

    // ---- Provider callbacks ------------------------------------------------------------------------------

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        for (int id : ids) render(context, manager, id);
        schedule(context);
    }

    @Override
    public void onAppWidgetOptionsChanged(Context context, AppWidgetManager manager, int id, Bundle options) {
        render(context, manager, id);
    }

    @Override
    public void onDisabled(Context context) {
        cancelSchedule(context);
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        super.onReceive(context, intent);
        String action = intent == null ? null : intent.getAction();
        try {
            if (ACTION_DONE.equals(action)) {
                markDone(context, intent);
                renderAll(context);
                schedule(context);
            } else if (ACTION_REFRESH.equals(action)) {
                renderAll(context);
                schedule(context);
            }
        } catch (Throwable ignored) {
            // a widget must never crash the app
        }
    }

    // ---- Storage -----------------------------------------------------------------------------------------

    private static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private static JSONArray readArray(Context c, String key) {
        try {
            String s = prefs(c).getString(key, null);
            return s == null ? new JSONArray() : new JSONArray(s);
        } catch (Exception e) {
            return new JSONArray();
        }
    }

    /** Called by the plugin whenever the web app has a fresh snapshot. */
    static void saveSnapshot(Context c, String json) {
        try {
            new JSONObject(json); // refuse anything that is not JSON
        } catch (Exception e) {
            return;
        }
        // Items already ticked on the widget but not yet applied by the app stay hidden; everything else resets.
        JSONArray queue = readArray(c, "queue");
        JSONArray done = new JSONArray();
        for (int i = 0; i < queue.length(); i++) {
            JSONObject q = queue.optJSONObject(i);
            if (q != null) done.put(q.optString("key"));
        }
        prefs(c).edit().putString("snapshot", json).putString("done", done.toString()).apply();
        renderAll(c);
        schedule(c);
    }

    /** The Dones waiting for the app, as a JSON array string. Clears the queue. */
    static String takePending(Context c) {
        String s = readArray(c, "queue").toString();
        prefs(c).edit().putString("queue", "[]").apply();
        return s;
    }

    private static void markDone(Context c, Intent intent) {
        String key = intent.getStringExtra("key");
        if (key == null) return;
        JSONArray queue = readArray(c, "queue");
        for (int i = 0; i < queue.length(); i++) {
            JSONObject q = queue.optJSONObject(i);
            if (q != null && key.equals(q.optString("key"))) return; // already waiting
        }
        try {
            JSONObject a = new JSONObject();
            a.put("type", "done");
            a.put("kind", intent.getStringExtra("itemKind"));
            a.put("key", key);
            String ref = intent.getStringExtra("ref");
            String taskId = intent.getStringExtra("taskId");
            if (ref != null && !ref.isEmpty()) a.put("ref", ref);
            if (taskId != null && !taskId.isEmpty()) a.put("taskId", taskId);
            a.put("date", intent.getStringExtra("date"));
            a.put("at", System.currentTimeMillis());
            queue.put(a);
            // Keep the queue small: drop the oldest.
            while (queue.length() > MAX_QUEUE) queue.remove(0);
            JSONArray done = readArray(c, "done");
            done.put(key);
            prefs(c).edit().putString("queue", queue.toString()).putString("done", done.toString()).apply();
        } catch (Exception ignored) {
            // nothing to do
        }
    }

    // ---- The model: what to show right now ---------------------------------------------------------------

    private static final class Item {
        String key, title, emoji, kind, ref, taskId;
        int start, end;
        boolean act, carried;
    }

    private static final class Model {
        boolean ready;
        boolean stale;
        String name = "friend";
        String pace = "";
        String tomorrowTitle, tomorrowTime;
        int pct = -1;
        String mode = "next"; // now | ahead | missed | none
        Item next;
        final List<Item> later = new ArrayList<>();
        final List<Item> open = new ArrayList<>();
        String date;
    }

    private static String todayString(Calendar cal) {
        return String.format(java.util.Locale.US, "%04d-%02d-%02d", cal.get(Calendar.YEAR), cal.get(Calendar.MONTH) + 1, cal.get(Calendar.DAY_OF_MONTH));
    }

    private static String hhmm(int minutes) {
        return String.format(java.util.Locale.US, "%02d:%02d", (minutes / 60) % 24, minutes % 60);
    }

    private static Model load(Context c) {
        Model m = new Model();
        try {
            String raw = prefs(c).getString("snapshot", null);
            if (raw == null) return m;
            JSONObject s = new JSONObject(raw);
            m.ready = true;
            m.date = s.optString("date");
            m.name = s.optString("name", "friend");
            m.pct = s.optInt("pct", -1);
            m.pace = s.optString("pace", "");
            JSONObject tomorrow = s.optJSONObject("tomorrow");
            if (tomorrow != null) {
                m.tomorrowTitle = tomorrow.optString("title");
                m.tomorrowTime = tomorrow.optString("time");
            }
            Calendar cal = Calendar.getInstance();
            m.stale = !todayString(cal).equals(m.date);
            if (m.stale) return m;

            JSONArray done = readArray(c, "done");
            List<String> doneKeys = new ArrayList<>();
            for (int i = 0; i < done.length(); i++) doneKeys.add(done.optString(i));

            JSONArray items = s.optJSONArray("items");
            if (items != null) {
                for (int i = 0; i < items.length(); i++) {
                    JSONObject o = items.optJSONObject(i);
                    if (o == null) continue;
                    String key = o.optString("key");
                    if (doneKeys.contains(key)) continue;
                    Item it = new Item();
                    it.key = key;
                    it.title = o.optString("title");
                    it.emoji = o.optString("emoji", "");
                    it.kind = o.optString("kind");
                    it.ref = o.optString("ref", "");
                    it.taskId = o.optString("taskId", "");
                    it.start = o.optInt("start");
                    it.end = o.optInt("end");
                    it.act = o.optBoolean("act");
                    it.carried = o.optBoolean("carried");
                    m.open.add(it);
                }
            }

            // The same rule as the app's nextUp: what is happening now, else the next thing ahead, else something missed.
            int now = cal.get(Calendar.HOUR_OF_DAY) * 60 + cal.get(Calendar.MINUTE);
            for (Item it : m.open) {
                if (it.start <= now && now < it.end) {
                    m.next = it;
                    m.mode = "now";
                    break;
                }
            }
            if (m.next == null) {
                for (Item it : m.open) {
                    if (it.start > now) {
                        m.next = it;
                        m.mode = "ahead";
                        break;
                    }
                }
            }
            if (m.next == null) {
                for (Item it : m.open) {
                    if (it.end <= now) {
                        m.next = it;
                        m.mode = "missed";
                        break;
                    }
                }
            }
            if (m.next == null) m.mode = "none";
            for (Item it : m.open) {
                if (m.later.size() >= 2) break;
                if (it != m.next && (m.next == null || it.start >= m.next.start)) m.later.add(it);
            }
        } catch (Exception e) {
            m.ready = false;
        }
        return m;
    }

    private static String inMinutes(int minutes) {
        if (minutes < 1) return "now";
        if (minutes < 60) return "in " + minutes + " min";
        return "at " + hhmm(minutes);
    }

    // ---- Drawing -----------------------------------------------------------------------------------------

    static void renderAll(Context c) {
        AppWidgetManager m = AppWidgetManager.getInstance(c);
        int[] ids = m.getAppWidgetIds(new ComponentName(c, TodayWidgetProvider.class));
        for (int id : ids) render(c, m, id);
    }

    private static PendingIntent openApp(Context c) {
        Intent i = new Intent(c, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED);
        return PendingIntent.getActivity(c, 1, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static void render(Context c, AppWidgetManager manager, int id) {
        try {
            Bundle o = manager.getAppWidgetOptions(id);
            int minW = o == null ? 110 : o.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 110);
            int minH = o == null ? 110 : o.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 110);
            boolean medium = minW >= 180 && minH >= 110;
            RemoteViews rv = new RemoteViews(c.getPackageName(), medium ? R.layout.widget_medium : R.layout.widget_small);
            Model m = load(c);

            String state;
            String title;
            String time = "";
            boolean buttons = false;
            Item next = m.next;

            if (!m.ready) {
                state = "Today";
                title = "Open Today once to set this up";
            } else if (m.stale) {
                state = "New day";
                title = "Open Today to see your day";
            } else if (next == null) {
                state = "All clear";
                title = "All done, " + m.name + " 🌿";
                if (m.tomorrowTitle != null && !m.tomorrowTitle.isEmpty()) time = "Tomorrow: " + m.tomorrowTitle + " " + m.tomorrowTime;
            } else {
                Calendar cal = Calendar.getInstance();
                int now = cal.get(Calendar.HOUR_OF_DAY) * 60 + cal.get(Calendar.MINUTE);
                if ("now".equals(m.mode)) state = "Now";
                else if ("ahead".equals(m.mode)) state = "Next up · " + inMinutes(next.start - now);
                else state = "Still to do";
                title = (next.emoji != null && !next.emoji.isEmpty() ? next.emoji + " " : "") + next.title;
                time = hhmm(next.start) + "–" + hhmm(next.end) + (next.carried ? " · carried over" : "");
                buttons = next.act;
            }

            rv.setTextViewText(R.id.w_state, state);
            rv.setTextViewText(R.id.w_title, title);
            rv.setTextViewText(R.id.w_time, time);
            rv.setViewVisibility(R.id.w_time, time.isEmpty() ? View.GONE : View.VISIBLE);
            rv.setViewVisibility(R.id.w_buttons, buttons ? View.VISIBLE : View.GONE);
            rv.setViewVisibility(R.id.w_open, buttons || next == null && m.ready && !m.stale ? View.GONE : View.VISIBLE);
            rv.setOnClickPendingIntent(R.id.w_root, openApp(c));
            rv.setOnClickPendingIntent(R.id.w_open, openApp(c));

            if (buttons) {
                // Start: straight into the item with its timer running.
                Intent start = new Intent(c, MainActivity.class)
                    .setAction(ACTION_START)
                    .setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED)
                    .putExtra("itemKind", next.kind)
                    .putExtra("ref", next.ref)
                    .putExtra("taskId", next.taskId)
                    .putExtra("key", next.key);
                rv.setOnClickPendingIntent(R.id.w_start, PendingIntent.getActivity(c, 2, start, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
                // Done: hidden at once, applied by the app later.
                Intent done = new Intent(c, TodayWidgetProvider.class)
                    .setAction(ACTION_DONE)
                    .putExtra("itemKind", next.kind)
                    .putExtra("ref", next.ref)
                    .putExtra("taskId", next.taskId)
                    .putExtra("key", next.key)
                    .putExtra("date", m.date);
                rv.setOnClickPendingIntent(R.id.w_done, PendingIntent.getBroadcast(c, 3, done, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
            }

            if (medium) {
                boolean show = m.ready && !m.stale;
                bindLater(rv, R.id.w_later1, show && m.later.size() > 0 ? m.later.get(0) : null);
                bindLater(rv, R.id.w_later2, show && m.later.size() > 1 ? m.later.get(1) : null);
                boolean pct = show && m.pct >= 0;
                rv.setViewVisibility(R.id.w_week, pct ? View.VISIBLE : View.GONE);
                rv.setViewVisibility(R.id.w_progress, pct ? View.VISIBLE : View.GONE);
                if (pct) {
                    rv.setTextViewText(R.id.w_week, "This week " + m.pct + "%" + (m.pace.isEmpty() ? "" : " · " + m.pace));
                    rv.setProgressBar(R.id.w_progress, 100, Math.min(100, m.pct), false);
                }
            }
            manager.updateAppWidget(id, rv);
        } catch (Throwable ignored) {
            // keep whatever the widget showed before
        }
    }

    private static void bindLater(RemoteViews rv, int viewId, Item it) {
        if (it == null) {
            rv.setViewVisibility(viewId, View.GONE);
            return;
        }
        rv.setViewVisibility(viewId, View.VISIBLE);
        rv.setTextViewText(viewId, hhmm(it.start) + "  " + (it.emoji != null && !it.emoji.isEmpty() ? it.emoji + " " : "") + it.title);
    }

    // ---- Light refresh: at each item's start and end, and at midnight -------------------------------------

    private static PendingIntent refreshIntent(Context c) {
        Intent i = new Intent(c, TodayWidgetProvider.class).setAction(ACTION_REFRESH);
        return PendingIntent.getBroadcast(c, 77, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    static void cancelSchedule(Context c) {
        try {
            AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
            if (am != null) am.cancel(refreshIntent(c));
        } catch (Throwable ignored) {
            // nothing scheduled
        }
    }

    static void schedule(Context c) {
        try {
            AppWidgetManager m = AppWidgetManager.getInstance(c);
            if (m.getAppWidgetIds(new ComponentName(c, TodayWidgetProvider.class)).length == 0) {
                cancelSchedule(c);
                return;
            }
            Calendar now = Calendar.getInstance();
            long nowMs = now.getTimeInMillis();
            Calendar midnight = (Calendar) now.clone();
            midnight.set(Calendar.HOUR_OF_DAY, 0);
            midnight.set(Calendar.MINUTE, 0);
            midnight.set(Calendar.SECOND, 5);
            midnight.set(Calendar.MILLISECOND, 0);
            midnight.add(Calendar.DAY_OF_MONTH, 1);
            long next = midnight.getTimeInMillis();

            Model model = load(c);
            if (model.ready && !model.stale) {
                Calendar day = (Calendar) now.clone();
                for (Item it : model.open) {
                    for (int minute : new int[] { it.start, it.end }) {
                        day.set(Calendar.HOUR_OF_DAY, minute / 60);
                        day.set(Calendar.MINUTE, minute % 60);
                        day.set(Calendar.SECOND, 1);
                        day.set(Calendar.MILLISECOND, 0);
                        long t = day.getTimeInMillis();
                        if (t > nowMs + 1000 && t < next) next = t;
                    }
                }
            }
            AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
            if (am == null) return;
            // Inexact on purpose: no special permission, and a widget a few minutes late is fine.
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) am.setAndAllowWhileIdle(AlarmManager.RTC, next, refreshIntent(c));
            else am.set(AlarmManager.RTC, next, refreshIntent(c));
        } catch (Throwable ignored) {
            // the widget still refreshes when the app opens
        }
    }
}
