package org.crpteam.cfms_client_tauri

import android.app.Activity
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.Plugin

@TauriPlugin
class AndroidAppLifecyclePlugin(private val activity: Activity) : Plugin(activity) {
    @Command
    fun moveTaskToBack(invoke: Invoke) {
        try {
            activity.moveTaskToBack(true)
            invoke.resolve()
        } catch (ex: Exception) {
            invoke.reject(ex.message ?: "Failed to move app to background.", ex)
        }
    }
}
