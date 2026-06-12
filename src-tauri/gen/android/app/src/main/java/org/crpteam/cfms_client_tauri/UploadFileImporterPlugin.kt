package org.crpteam.cfms_client_tauri

import android.app.Activity
import android.net.Uri
import android.provider.OpenableColumns
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.File
import java.io.FileInputStream
import java.util.UUID

@InvokeArg
class ImportFileArgs {
    lateinit var uri: String
}

@TauriPlugin
class UploadFileImporterPlugin(private val activity: Activity) : Plugin(activity) {
    @Command
    fun importFile(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(ImportFileArgs::class.java)
            val sourceUri = Uri.parse(args.uri)
            val displayName = displayNameFor(sourceUri, args.uri)
            val targetDir = File(activity.cacheDir, "upload_imports").apply { mkdirs() }
            val target = uniqueTargetFile(targetDir, displayName)

            openInputStream(sourceUri, args.uri).use { input ->
                target.outputStream().use { output ->
                    input.copyTo(output)
                }
            }

            val response = JSObject().apply {
                put("path", target.absolutePath)
            }
            invoke.resolve(response)
        } catch (ex: Exception) {
            invoke.reject(ex.message ?: "Failed to import selected file.", ex)
        }
    }

    private fun openInputStream(uri: Uri, raw: String) =
        when (uri.scheme?.lowercase()) {
            "content" -> activity.contentResolver.openInputStream(uri)
            "file" -> FileInputStream(File(uri.path ?: raw))
            null, "" -> FileInputStream(File(raw))
            else -> activity.contentResolver.openInputStream(uri)
        } ?: throw IllegalArgumentException("Selected file cannot be opened.")

    private fun displayNameFor(uri: Uri, raw: String): String {
        if (uri.scheme == "content") {
            activity.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)
                ?.use { cursor ->
                    if (cursor.moveToFirst()) {
                        val index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                        if (index >= 0) {
                            val name = cursor.getString(index)
                            if (!name.isNullOrBlank()) return sanitizeFileName(name)
                        }
                    }
                }
        }

        val pathName = uri.path?.let { File(it).name }.orEmpty()
        val rawName = File(raw).name
        return sanitizeFileName(pathName.ifBlank { rawName }.ifBlank { "upload.bin" })
    }

    private fun sanitizeFileName(name: String): String {
        val cleaned = name
            .replace(Regex("""[\\/:*?"<>|\u0000-\u001F]+"""), "_")
            .trim()
            .trim('.')
        return cleaned.ifBlank { "upload.bin" }
    }

    private fun uniqueTargetFile(dir: File, name: String): File {
        val prefix = UUID.randomUUID().toString()
        return File(dir, "${prefix}_$name")
    }
}
