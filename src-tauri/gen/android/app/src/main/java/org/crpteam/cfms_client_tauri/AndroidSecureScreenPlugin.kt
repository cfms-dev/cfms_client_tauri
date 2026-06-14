package org.crpteam.cfms_client_tauri

import android.app.Activity
import android.view.WindowManager
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.Plugin

@InvokeArg
class SecureScreenArgs {
    var enabled: Boolean = false
}

@TauriPlugin
class AndroidSecureScreenPlugin(private val activity: Activity) : Plugin(activity) {
    @Command
    fun setSecureScreen(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(SecureScreenArgs::class.java)
            activity.runOnUiThread {
                try {
                    if (args.enabled) {
                        activity.window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
                    } else {
                        activity.window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
                    }
                    invoke.resolve()
                } catch (ex: Exception) {
                    invoke.reject(ex.message ?: "Failed to update secure screen mode.", ex)
                }
            }
        } catch (ex: Exception) {
            invoke.reject(ex.message ?: "Failed to update secure screen mode.", ex)
        }
    }
}
