package org.crpteam.cfms_client_tauri

import android.app.Activity
import android.app.Application
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.Plugin
import java.util.concurrent.atomic.AtomicBoolean

@TauriPlugin
class AndroidAppLifecyclePlugin(private val activity: Activity) : Plugin(activity) {
    companion object {
        private const val BACKGROUND_STOP_FALLBACK_MS = 650L
    }

    private val mainHandler = Handler(Looper.getMainLooper())

    @Command
    fun moveTaskToBack(invoke: Invoke) {
        try {
            activity.moveTaskToBack(true)
            invoke.resolve()
        } catch (ex: Exception) {
            invoke.reject(ex.message ?: "Failed to move app to background.", ex)
        }
    }

    @Command
    fun moveTaskToBackAndWaitForStop(invoke: Invoke) {
        mainHandler.post {
            val completed = AtomicBoolean(false)
            var timeout: Runnable? = null
            lateinit var callbacks: Application.ActivityLifecycleCallbacks

            fun complete(error: Exception? = null) {
                if (!completed.compareAndSet(false, true)) return

                runCatching {
                    activity.application.unregisterActivityLifecycleCallbacks(callbacks)
                }
                timeout?.let { mainHandler.removeCallbacks(it) }

                if (error == null) {
                    invoke.resolve()
                } else {
                    invoke.reject(error.message ?: "Failed to move app to background.", error)
                }
            }

            callbacks = object : Application.ActivityLifecycleCallbacks {
                override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) = Unit
                override fun onActivityStarted(activity: Activity) = Unit
                override fun onActivityResumed(activity: Activity) = Unit
                override fun onActivityPaused(activity: Activity) = Unit

                override fun onActivityStopped(stoppedActivity: Activity) {
                    if (stoppedActivity === activity) {
                        complete()
                    }
                }

                override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) = Unit
                override fun onActivityDestroyed(activity: Activity) = Unit
            }

            try {
                activity.application.registerActivityLifecycleCallbacks(callbacks)
                timeout = Runnable { complete() }
                mainHandler.postDelayed(timeout!!, BACKGROUND_STOP_FALLBACK_MS)

                if (!activity.moveTaskToBack(true)) {
                    complete()
                }
            } catch (ex: Exception) {
                complete(ex)
            }
        }
    }
}
