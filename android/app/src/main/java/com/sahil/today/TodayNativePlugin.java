package com.sahil.today;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Small native helper for Sahil's Today:
 *  - launch intents: "Share to Today" (ACTION_SEND text) and the two app-icon shortcuts
 *  - battery optimisation status + a shortcut to the right settings screen
 */
@CapacitorPlugin(name = "TodayNative")
public class TodayNativePlugin extends Plugin {

    public static final String ACTION_NEW_TASK = "com.sahil.today.NEW_TASK";
    public static final String ACTION_VOICE_TASK = "com.sahil.today.VOICE_TASK";

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

    private JSObject parse(Intent intent) {
        if (intent == null || intent.getAction() == null) return null;
        String action = intent.getAction();
        JSObject out = new JSObject();
        if (Intent.ACTION_SEND.equals(action)) {
            String text = intent.getStringExtra(Intent.EXTRA_TEXT);
            String subject = intent.getStringExtra(Intent.EXTRA_SUBJECT);
            if (text == null && subject == null) return null;
            out.put("kind", "share");
            if (text != null) out.put("text", text);
            if (subject != null) out.put("title", subject);
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
