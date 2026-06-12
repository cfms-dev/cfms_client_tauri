package org.crpteam.cfms_client_tauri

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.provider.DocumentsContract
import android.provider.OpenableColumns
import androidx.activity.result.ActivityResult
import app.tauri.annotation.ActivityCallback
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

@InvokeArg
class ImportDirectoryArgs {
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
                put("displayName", displayName)
            }
            invoke.resolve(response)
        } catch (ex: Exception) {
            invoke.reject(ex.message ?: "Failed to import selected file.", ex)
        }
    }

    @Command
    fun selectDirectory(invoke: Invoke) {
        try {
            val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).apply {
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                addFlags(Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
                addFlags(Intent.FLAG_GRANT_PREFIX_URI_PERMISSION)
            }
            startActivityForResult(invoke, intent, "selectDirectoryResult")
        } catch (ex: Exception) {
            invoke.reject(ex.message ?: "Failed to open folder picker.", ex)
        }
    }

    @ActivityCallback
    fun selectDirectoryResult(invoke: Invoke, result: ActivityResult) {
        try {
            when (result.resultCode) {
                Activity.RESULT_OK -> {
                    val treeUri = result.data?.data
                        ?: throw IllegalArgumentException("No folder was selected.")
                    persistReadPermission(treeUri, result.data)
                    val response = JSObject().apply {
                        put("uri", treeUri.toString())
                        put("name", displayNameForDirectory(treeUri))
                    }
                    invoke.resolve(response)
                }
                Activity.RESULT_CANCELED -> invoke.reject("Folder picker cancelled")
                else -> invoke.reject("Failed to pick folder")
            }
        } catch (ex: Exception) {
            invoke.reject(ex.message ?: "Failed to read selected folder.", ex)
        }
    }

    @Command
    fun importDirectory(invoke: Invoke) {
        Thread {
            try {
                val args = invoke.parseArgs(ImportDirectoryArgs::class.java)
                val sourceUri = Uri.parse(args.uri)
                val displayName = displayNameForDirectory(sourceUri)
                val target = copyDirectoryToCache(sourceUri)
                val response = JSObject().apply {
                    put("path", target.absolutePath)
                    put("displayName", displayName)
                }
                invoke.resolve(response)
            } catch (ex: Exception) {
                invoke.reject(ex.message ?: "Failed to import selected folder.", ex)
            }
        }.start()
    }

    private fun openInputStream(uri: Uri, raw: String) =
        when (uri.scheme?.lowercase()) {
            "content" -> activity.contentResolver.openInputStream(uri)
            "file" -> FileInputStream(File(uri.path ?: raw))
            null, "" -> FileInputStream(File(raw))
            else -> activity.contentResolver.openInputStream(uri)
        } ?: throw IllegalArgumentException("Selected file cannot be opened.")

    private fun persistReadPermission(uri: Uri, intent: Intent?) {
        val readFlags = (intent?.flags ?: 0) and Intent.FLAG_GRANT_READ_URI_PERMISSION
        if (readFlags == 0) return

        try {
            activity.contentResolver.takePersistableUriPermission(uri, readFlags)
        } catch (_: SecurityException) {
            // Some providers grant only a transient permission; immediate import still works.
        }
    }

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

    private fun displayNameForDirectory(treeUri: Uri): String {
        if (treeUri.scheme == "file" || treeUri.scheme.isNullOrBlank()) {
            return sanitizeFileName(File(treeUri.path ?: treeUri.toString()).name.ifBlank { "folder" })
        }

        val rootDocumentId = DocumentsContract.getTreeDocumentId(treeUri)
        val rootUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, rootDocumentId)
        val queried = queryDocumentName(rootUri)
        if (!queried.isNullOrBlank()) return sanitizeFileName(queried)

        val fallback = rootDocumentId.substringAfterLast(':').substringAfterLast('/')
        return sanitizeFileName(fallback.ifBlank { "folder" })
    }

    private fun queryDocumentName(documentUri: Uri): String? {
        activity.contentResolver.query(
            documentUri,
            arrayOf(DocumentsContract.Document.COLUMN_DISPLAY_NAME),
            null,
            null,
            null
        )?.use { cursor ->
            if (cursor.moveToFirst()) {
                val index = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_DISPLAY_NAME)
                if (index >= 0) return cursor.getString(index)
            }
        }
        return null
    }

    private fun copyDirectoryToCache(treeUri: Uri): File {
        if (treeUri.scheme == "file" || treeUri.scheme.isNullOrBlank()) {
            val source = File(treeUri.path ?: treeUri.toString())
            if (!source.isDirectory) {
                throw IllegalArgumentException("Selected path is not a folder.")
            }
            return copyFileDirectoryToCache(source)
        }

        val rootName = displayNameForDirectory(treeUri)
        val targetBase = File(activity.cacheDir, "upload_imports").apply { mkdirs() }
        val targetRoot = uniqueTargetFile(targetBase, rootName).apply { mkdirs() }
        val rootDocumentId = DocumentsContract.getTreeDocumentId(treeUri)
        copyDocumentTree(treeUri, rootDocumentId, targetRoot)
        return targetRoot
    }

    private fun copyFileDirectoryToCache(source: File): File {
        val targetBase = File(activity.cacheDir, "upload_imports").apply { mkdirs() }
        val targetRoot = uniqueTargetFile(targetBase, sanitizeFileName(source.name.ifBlank { "folder" }))
            .apply { mkdirs() }

        source.walkTopDown().forEach { entry ->
            if (entry == source) return@forEach
            val target = File(targetRoot, entry.relativeTo(source).path)
            if (entry.isDirectory) {
                target.mkdirs()
            } else if (entry.isFile) {
                target.parentFile?.mkdirs()
                entry.inputStream().use { input ->
                    target.outputStream().use { output ->
                        input.copyTo(output)
                    }
                }
            }
        }
        return targetRoot
    }

    private fun copyDocumentTree(treeUri: Uri, documentId: String, targetDir: File) {
        val childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, documentId)
        activity.contentResolver.query(
            childrenUri,
            arrayOf(
                DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                DocumentsContract.Document.COLUMN_MIME_TYPE
            ),
            null,
            null,
            null
        )?.use { cursor ->
            val idIndex = cursor.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_DOCUMENT_ID)
            val nameIndex = cursor.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_DISPLAY_NAME)
            val mimeIndex = cursor.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_MIME_TYPE)

            while (cursor.moveToNext()) {
                val childId = cursor.getString(idIndex)
                val childName = sanitizeFileName(cursor.getString(nameIndex) ?: "item")
                val childMime = cursor.getString(mimeIndex)
                val target = uniqueChildTarget(targetDir, childName)

                if (childMime == DocumentsContract.Document.MIME_TYPE_DIR) {
                    target.mkdirs()
                    copyDocumentTree(treeUri, childId, target)
                } else {
                    copyDocumentFile(treeUri, childId, target)
                }
            }
        } ?: throw IllegalArgumentException("Selected folder cannot be opened.")
    }

    private fun copyDocumentFile(treeUri: Uri, documentId: String, target: File) {
        val documentUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, documentId)
        target.parentFile?.mkdirs()
        activity.contentResolver.openInputStream(documentUri).use { input ->
            if (input == null) {
                throw IllegalArgumentException("A selected file cannot be opened.")
            }
            target.outputStream().use { output ->
                input.copyTo(output)
            }
        }
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

    private fun uniqueChildTarget(dir: File, name: String): File {
        var candidate = File(dir, name)
        if (!candidate.exists()) return candidate

        val base = name.substringBeforeLast('.', name)
        val extension = name.substringAfterLast('.', "")
        var index = 2
        while (candidate.exists()) {
            val nextName = if (extension.isBlank()) {
                "$base ($index)"
            } else {
                "$base ($index).$extension"
            }
            candidate = File(dir, nextName)
            index += 1
        }
        return candidate
    }
}
