package org.crpteam.cfms_client_tauri

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.Plugin
import java.io.File

@InvokeArg
class InstallApkArgs {
    lateinit var path: String
}

@TauriPlugin
class ApkInstallerPlugin(private val activity: Activity) : Plugin(activity) {
    @Command
    fun installApk(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(InstallApkArgs::class.java)
            val apk = File(args.path)
            if (!apk.exists() || !apk.isFile) {
                invoke.reject("Downloaded update package was not found.")
                return
            }

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
                !activity.packageManager.canRequestPackageInstalls()
            ) {
                val settingsIntent = Intent(
                    Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:${activity.packageName}")
                ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                activity.startActivity(settingsIntent)
                invoke.reject(
                    "Install permission is required. Allow CFMS Client to install unknown apps, then try again."
                )
                return
            }

            val uri = FileProvider.getUriForFile(
                activity,
                "${activity.packageName}.fileprovider",
                apk
            )
            val installIntent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, "application/vnd.android.package-archive")
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }

            activity.startActivity(installIntent)
            invoke.resolve()
        } catch (ex: ActivityNotFoundException) {
            invoke.reject("No Android package installer is available.", ex)
        } catch (ex: Exception) {
            invoke.reject(ex.message ?: "Failed to open Android package installer.", ex)
        }
    }
}
