package com.sahil.today;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * Fires every Sunday at 21:30 (set by BackupStore.scheduleWeekly) and writes the weekly backup, even when the app is closed.
 * It also puts the alarm back after a reboot or an app update, which clear it.
 */
public class BackupReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(final Context context, Intent intent) {
        String action = intent == null ? null : intent.getAction();
        if (Intent.ACTION_BOOT_COMPLETED.equals(action) || Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)) {
            BackupStore.scheduleWeekly(context);
            return;
        }
        if (BackupStore.ACTION_WEEKLY.equals(action)) {
            final PendingResult pending = goAsync();
            new Thread(() -> {
                try {
                    BackupStore.runWeeklyBackup(context);
                } finally {
                    BackupStore.scheduleWeekly(context);
                    pending.finish();
                }
            }, "today-weekly-backup").start();
        }
    }
}
