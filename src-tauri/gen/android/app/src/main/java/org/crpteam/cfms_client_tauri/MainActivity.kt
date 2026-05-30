package org.crpteam.cfms_client_tauri

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat

class MainActivity : TauriActivity() {

    companion object {
        /** Notification channel ID used by the foreground service. */
        const val NOTIFICATION_CHANNEL_ID = "cfms_background_service"
        /** Human-readable channel name shown in system settings. */
        const val NOTIFICATION_CHANNEL_NAME = "CFMS Background Service"
    }

    /** Launcher for the POST_NOTIFICATIONS runtime permission on Android 13+. */
    private val notificationPermissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { /* granted or denied */ }

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)

        // Create the notification channel required for the foreground service.
        // This must happen before the service starts.
        createNotificationChannel()

        // Request POST_NOTIFICATIONS on Android 13+ (API 33).
        // The foreground service requires a visible notification; without
        // permission the notification is silently hidden.
        requestNotificationPermission()
    }

    /**
     * Creates the mandatory notification channel for Android 8.0+ (API 26).
     * No-op on older versions.
     */
    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                NOTIFICATION_CHANNEL_ID,
                NOTIFICATION_CHANNEL_NAME,
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Persistent notification for CFMS background services " +
                    "(token refresh, file sync, lockdown monitoring)"
                setShowBadge(false)
            }
            val manager = getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(channel)
        }
    }

    /**
     * Requests the POST_NOTIFICATIONS runtime permission on Android 13+.
     * The foreground service cannot display its mandatory notification without
     * this permission.
     */
    private fun requestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(
                    this, Manifest.permission.POST_NOTIFICATIONS
                ) != PackageManager.PERMISSION_GRANTED
            ) {
                notificationPermissionLauncher.launch(
                    Manifest.permission.POST_NOTIFICATIONS
                )
            }
        }
    }
}
