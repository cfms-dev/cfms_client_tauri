package org.crpteam.cfms_client_tauri

import android.Manifest
import android.app.Activity
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.view.View
import android.widget.RemoteViews
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.Plugin

@InvokeArg
class UpdateNotificationArgs {
    lateinit var title: String
    lateinit var body: String
    var ongoing: Boolean = false
    var showProgress: Boolean = true
}

@TauriPlugin
class UpdateNotificationPlugin(private val activity: Activity) : Plugin(activity) {
    companion object {
        private const val CHANNEL_ID = "cfms_update_downloads"
        private const val CHANNEL_NAME = "CFMS Updates"
        private const val NOTIFICATION_ID = 24001
        private const val REQUEST_CODE = 24001
    }

    @Command
    fun show(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(UpdateNotificationArgs::class.java)
            if (!hasNotificationPermission()) {
                invoke.resolve()
                return
            }

            createChannel()

            val views = RemoteViews(activity.packageName, R.layout.update_notification).apply {
                setTextViewText(R.id.update_notification_title, args.title)
                setTextViewText(R.id.update_notification_body, args.body)
                setViewVisibility(
                    R.id.update_notification_progress,
                    if (args.showProgress) View.VISIBLE else View.GONE
                )
                setProgressBar(R.id.update_notification_progress, 0, 0, true)
            }

            val notification = NotificationCompat.Builder(activity, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_update_notification)
                .setContentTitle(args.title)
                .setContentText(args.body)
                .setCustomContentView(views)
                .setStyle(NotificationCompat.DecoratedCustomViewStyle())
                .setContentIntent(contentIntent())
                .setOngoing(args.ongoing)
                .setAutoCancel(!args.ongoing)
                .setOnlyAlertOnce(true)
                .setSilent(true)
                .setLocalOnly(true)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .build()

            NotificationManagerCompat.from(activity).notify(NOTIFICATION_ID, notification)
            invoke.resolve()
        } catch (ex: Exception) {
            invoke.reject(ex.message ?: "Failed to show update notification.", ex)
        }
    }

    @Command
    fun cancel(invoke: Invoke) {
        try {
            NotificationManagerCompat.from(activity).cancel(NOTIFICATION_ID)
            invoke.resolve()
        } catch (ex: Exception) {
            invoke.reject(ex.message ?: "Failed to cancel update notification.", ex)
        }
    }

    private fun createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return

        val channel = NotificationChannel(
            CHANNEL_ID,
            CHANNEL_NAME,
            NotificationManager.IMPORTANCE_LOW
        ).apply {
            description = "Progress notifications for app updates"
            setShowBadge(false)
        }

        activity.getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }

    private fun hasNotificationPermission(): Boolean {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
            ContextCompat.checkSelfPermission(
                activity,
                Manifest.permission.POST_NOTIFICATIONS
            ) == PackageManager.PERMISSION_GRANTED
    }

    private fun contentIntent(): PendingIntent {
        val intent = Intent(activity, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val flags = PendingIntent.FLAG_UPDATE_CURRENT or
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0

        return PendingIntent.getActivity(activity, REQUEST_CODE, intent, flags)
    }
}
