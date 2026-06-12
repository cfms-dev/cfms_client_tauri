package org.crpteam.cfms_client_tauri

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.webkit.MimeTypeMap
import androidx.core.content.FileProvider
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.Plugin
import java.io.File

@InvokeArg
class OpenFileArgs {
    lateinit var path: String
}

@TauriPlugin
class FileOpenerPlugin(private val activity: Activity) : Plugin(activity) {
    @Command
    fun openFile(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(OpenFileArgs::class.java)
            val file = File(args.path)
            if (!file.exists() || !file.isFile) {
                invoke.reject("Downloaded file was not found.")
                return
            }

            val uri = FileProvider.getUriForFile(
                activity,
                "${activity.packageName}.fileprovider",
                file
            )
            val openIntent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, mimeTypeFor(file))
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }

            activity.startActivity(openIntent)
            invoke.resolve()
        } catch (ex: ActivityNotFoundException) {
            invoke.reject("No Android app is available to open this file.", ex)
        } catch (ex: Exception) {
            invoke.reject(ex.message ?: "Failed to open downloaded file.", ex)
        }
    }

    private fun mimeTypeFor(file: File): String {
        val extension = file.extension.lowercase()
        if (extension.isEmpty()) return "*/*"

        return MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension)
            ?: when (extension) {
                "zip" -> "application/zip"
                "7z" -> "application/x-7z-compressed"
                "rar" -> "application/vnd.rar"
                "rs" -> "text/plain"
                else -> "*/*"
            }
    }
}
