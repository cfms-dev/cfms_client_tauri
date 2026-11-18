package org.crpteam.cfms_client_tauri

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.provider.OpenableColumns
import androidx.activity.result.ActivityResult
import app.tauri.annotation.ActivityCallback
import java.security.MessageDigest
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.security.InvalidKeyException
import java.security.KeyStore
import java.security.UnrecoverableKeyException
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

@InvokeArg
class GithubTokenArgs {
    var token: String? = null
    var service: String? = null
    var account: String? = null
}

/** Keeps the GitHub token outside SQLite and WebView storage. */
@TauriPlugin
class AndroidGithubCredentialPlugin(private val activity: Activity) : Plugin(activity) {
    companion object {
        private const val KEY_ALIAS = "cfms_github_api_token_v1"
        private const val PREFS_NAME = "cfms_github_credentials"
        private const val CIPHERTEXT = "ciphertext"
        private const val IV = "iv"
        private const val TRANSFORMATION = "AES/GCM/NoPadding"
    }

    private fun location(invoke: Invoke): Pair<String, String> {
        val args = invoke.parseArgs(GithubTokenArgs::class.java)
        if (args.service == null) return Pair(KEY_ALIAS, PREFS_NAME)
        val scope = "${args.service}:${args.account ?: ""}".toByteArray(Charsets.UTF_8)
        val id = MessageDigest.getInstance("SHA-256").digest(scope).joinToString("") { "%02x".format(it) }
        return Pair("cfms_secret_$id", "cfms_secret_$id")
    }

    @Command
    fun pickPrivateKey(invoke: Invoke) {
        try {
            val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                type = "*/*"
                addCategory(Intent.CATEGORY_OPENABLE)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            startActivityForResult(invoke, intent, "privateKeyResult")
        } catch (_: Exception) { invoke.reject("publicKey.invalidFile") }
    }

    @ActivityCallback
    fun privateKeyResult(invoke: Invoke, result: ActivityResult) {
        if (result.resultCode == Activity.RESULT_CANCELED) { invoke.resolve(JSObject()); return }
        try {
            val uri = result.data?.data ?: throw IllegalArgumentException()
            var filename = "private-key"
            activity.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use {
                if (it.moveToFirst()) filename = it.getString(0) ?: filename
            }
            val bytes = activity.contentResolver.openInputStream(uri)?.use { input ->
                val output = java.io.ByteArrayOutputStream()
                val buffer = ByteArray(8192)
                try {
                    while (true) {
                        val count = input.read(buffer)
                        if (count < 0) break
                        if (output.size() + count > 1024 * 1024) throw IllegalArgumentException()
                        output.write(buffer, 0, count)
                    }
                    output.toByteArray()
                } finally { buffer.fill(0); output.reset() }
            } ?: throw IllegalArgumentException()
            try {
                invoke.resolve(JSObject().apply {
                    put("filename", filename)
                    put("content", Base64.encodeToString(bytes, Base64.NO_WRAP))
                })
            } finally { bytes.fill(0) }
        } catch (_: Exception) { invoke.reject("publicKey.invalidFile") }
    }

    @Command
    fun read(invoke: Invoke) {
        try {
            val (keyAlias, prefsName) = location(invoke)
            val prefs = activity.getSharedPreferences(prefsName, Context.MODE_PRIVATE)
            val ciphertext = prefs.getString(CIPHERTEXT, null)
            val iv = prefs.getString(IV, null)
            val response = JSObject()
            if (ciphertext == null && iv == null) {
                response.put("needsAttention", false)
                invoke.resolve(response)
                return
            }
            if (ciphertext == null || iv == null) {
                response.put("needsAttention", true)
                invoke.resolve(response)
                return
            }
            val key = keyStore().getKey(keyAlias, null) as? SecretKey
            if (key == null) {
                response.put("needsAttention", true)
                invoke.resolve(response)
                return
            }
            try {
                val cipher = Cipher.getInstance(TRANSFORMATION)
                cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP)))
                val bytes = cipher.doFinal(Base64.decode(ciphertext, Base64.NO_WRAP))
                try {
                    response.put("token", String(bytes, Charsets.UTF_8))
                } finally {
                    bytes.fill(0)
                }
                response.put("needsAttention", false)
            } catch (_: Exception) {
                // A missing or unusable key means the saved token must be replaced.
                response.put("needsAttention", true)
            }
            invoke.resolve(response)
        } catch (_: Exception) {
            invoke.reject("GitHub credential storage is unavailable.")
        }
    }

    @Command
    fun save(invoke: Invoke) {
        try {
            val (keyAlias, prefsName) = location(invoke)
            val token = requireNotNull(invoke.parseArgs(GithubTokenArgs::class.java).token)
            var cipher = Cipher.getInstance(TRANSFORMATION)
            try {
                cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey(keyAlias))
            } catch (_: InvalidKeyException) {
                // A permanently invalidated key can be replaced without
                // exposing or reusing the previous ciphertext.
                keyStore().deleteEntry(keyAlias)
                cipher = Cipher.getInstance(TRANSFORMATION)
                cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey(keyAlias))
            }
            val plaintext = token.toByteArray(Charsets.UTF_8)
            val ciphertext = try {
                cipher.doFinal(plaintext)
            } finally {
                plaintext.fill(0)
            }
            val committed = activity.getSharedPreferences(prefsName, Context.MODE_PRIVATE)
                .edit()
                .putString(CIPHERTEXT, Base64.encodeToString(ciphertext, Base64.NO_WRAP))
                .putString(IV, Base64.encodeToString(cipher.iv, Base64.NO_WRAP))
                .commit()
            if (!committed) throw IllegalStateException("Credential write failed")
            invoke.resolve()
        } catch (_: Exception) {
            invoke.reject("GitHub credential storage is unavailable.")
        }
    }

    @Command
    fun delete(invoke: Invoke) {
        try {
            val (keyAlias, prefsName) = location(invoke)
            val committed = activity.getSharedPreferences(prefsName, Context.MODE_PRIVATE)
                .edit().clear().commit()
            if (!committed) throw IllegalStateException("Credential deletion failed")
            // The encrypted value is gone after the committed preferences
            // write. A stranded Keystore key cannot recover the token and
            // should not prevent device-data reset if Keystore is locked.
            try {
                val store = keyStore()
                if (store.containsAlias(keyAlias)) store.deleteEntry(keyAlias)
            } catch (_: Exception) {
                // Orphaned key only; no ciphertext remains.
            }
            invoke.resolve()
        } catch (_: Exception) {
            invoke.reject("GitHub credential storage is unavailable.")
        }
    }

    private fun keyStore(): KeyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }

    private fun getOrCreateKey(keyAlias: String): SecretKey {
        val store = keyStore()
        val existing = try {
            store.getKey(keyAlias, null) as? SecretKey
        } catch (_: UnrecoverableKeyException) {
            store.deleteEntry(keyAlias)
            null
        }
        if (existing != null) return existing
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(
            KeyGenParameterSpec.Builder(
                keyAlias,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build()
        )
        return generator.generateKey()
    }
}
