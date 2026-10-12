package com.sahil.today;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * Two alarms live here:
 *  - every Sunday 21:30 (BackupStore.scheduleWeekly): the weekly backup, even when the app is closed;
 *  - every day ~06:00 (MirrorStore.scheduleDaily): rolls the "Today - Plan" calendar mirror forward from the last plan the app saved.
 * Both are put back after a reboot or an app update, which clear alarms.
 */
public class BackupReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(final Context context, Intent intent) {
        String action = intent == null ? null : intent.getAction();
        if (Intent.ACTION_BOOT_COMPLETED.equals(action) || Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)) {
            BackupStore.scheduleWeekly(context);
            MirrorStore.scheduleDaily(context);
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
        } else if (MirrorStore.ACTION_DAILY.equals(action)) {
            final PendingResult pending = goAsync();
            new Thread(() -> {
                try {
                    MirrorStore.reconcile(context);
                } finally {
                    MirrorStore.scheduleDaily(context);
                    pending.finish();
                }
            }, "today-daily-mirror").start();
        }
    }
}
