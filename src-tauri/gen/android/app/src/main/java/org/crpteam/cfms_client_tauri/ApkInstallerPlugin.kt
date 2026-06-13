package org.crpteam.cfms_client_tauri

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.activity.result.ActivityResult
import androidx.core.content.FileProvider
import app.tauri.annotation.ActivityCallback
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
    private var pendingInstallApk: File? = null

    @Command
    fun installApk(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(InstallApkArgs::class.java)
            val apk = requireInstallableApk(File(args.path))

            if (requiresUnknownAppInstallPermission()) {
                requestUnknownAppInstallPermission(invoke, apk)
                return
            }

            openPackageInstaller(invoke, apk)
        } catch (ex: ActivityNotFoundException) {
            invoke.reject("No Android package installer or install permission settings screen is available.", ex)
        } catch (ex: Exception) {
            invoke.reject(ex.message ?: "Failed to open Android package installer.", ex)
        }
    }

    @ActivityCallback
    fun installPermissionResult(invoke: Invoke, _result: ActivityResult) {
        try {
            val apk = pendingInstallApk
                ?: throw IllegalStateException("No pending Android update installation is available.")
            pendingInstallApk = null

            if (requiresUnknownAppInstallPermission()) {
                invoke.reject(
                    "Install permission is required. Allow CFMS Client to install unknown apps, then start the update again."
                )
                return
            }

            openPackageInstaller(invoke, requireInstallableApk(apk))
        } catch (ex: ActivityNotFoundException) {
            invoke.reject("No Android package installer is available.", ex)
        } catch (ex: Exception) {
            invoke.reject(ex.message ?: "Failed to open Android package installer.", ex)
        }
    }

    private fun requestUnknownAppInstallPermission(invoke: Invoke, apk: File) {
        if (pendingInstallApk != null) {
            invoke.reject("An Android update install permission request is already pending.")
            return
        }

        pendingInstallApk = apk
        val settingsIntent = Intent(
            Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
            Uri.parse("package:${activity.packageName}")
        )

        try {
            startActivityForResult(invoke, settingsIntent, "installPermissionResult")
        } catch (ex: Exception) {
            pendingInstallApk = null
            throw ex
        }
    }

    private fun openPackageInstaller(invoke: Invoke, apk: File) {
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
    }

    private fun requireInstallableApk(apk: File): File {
        if (!apk.exists() || !apk.isFile) {
            throw IllegalArgumentException("Downloaded update package was not found.")
        }
        return apk
    }

    private fun requiresUnknownAppInstallPermission(): Boolean =
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
            !activity.packageManager.canRequestPackageInstalls()
}
