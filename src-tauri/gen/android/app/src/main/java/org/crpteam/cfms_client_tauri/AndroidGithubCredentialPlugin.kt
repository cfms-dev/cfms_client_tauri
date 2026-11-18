package org.crpteam.cfms_client_tauri

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.provider.OpenableColumns
import androidx.activity.result.ActivityResult
import app.tauri.annotation.ActivityCallback
import java.math.BigInteger
import java.security.KeyFactory
import java.security.KeyPairGenerator
import java.security.MessageDigest
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyInfo
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
import java.security.PrivateKey
import java.security.Signature
import java.security.UnrecoverableKeyException
import java.security.interfaces.ECPublicKey
import java.security.spec.ECGenParameterSpec
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

@InvokeArg
class HardwareAuthKeyArgs {
    var keyId: String? = null
    var challenge: String? = null
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

    private fun hardwareKeyAlias(keyId: String): String = "cfms_auth_key_$keyId"

    private fun fixed32Bytes(value: BigInteger): ByteArray {
        val raw = value.toByteArray()
        val out = ByteArray(32)
        if (raw.size == 33 && raw[0] == 0.toByte()) {
            System.arraycopy(raw, 1, out, 0, 32)
        } else if (raw.size <= 32) {
            System.arraycopy(raw, 0, out, 32 - raw.size, raw.size)
        } else {
            throw IllegalArgumentException("Invalid P-256 coordinate length")
        }
        return out
    }

    private fun generateEcKeyPair(alias: String, useStrongBox: Boolean): java.security.KeyPair {
        val generator = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore")
        val builder = KeyGenParameterSpec.Builder(
            alias,
            KeyProperties.PURPOSE_SIGN or KeyProperties.PURPOSE_VERIFY
        )
            .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
            .setDigests(KeyProperties.DIGEST_SHA256)
        if (useStrongBox && Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            builder.setIsStrongBoxBacked(true)
        }
        generator.initialize(builder.build())
        return generator.generateKeyPair()
    }

    @Command
    fun checkHardwareAuthSupport(invoke: Invoke) {
        try {
            keyStore()
            invoke.resolve(JSObject().apply {
                put("available", true)
                put("hardwareBacked", true)
            })
        } catch (_: Exception) {
            invoke.resolve(JSObject().apply {
                put("available", false)
                put("hardwareBacked", false)
            })
        }
    }

    @Command
    fun generateHardwareAuthKey(invoke: Invoke) {
        try {
            val keyId = requireNotNull(invoke.parseArgs(HardwareAuthKeyArgs::class.java).keyId)
            val alias = hardwareKeyAlias(keyId)
            val hasStrongBox = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P &&
                activity.packageManager.hasSystemFeature(PackageManager.FEATURE_STRONGBOX_KEYSTORE)
            val pair = if (hasStrongBox) {
                try {
                    generateEcKeyPair(alias, true)
                } catch (_: Exception) {
                    try { keyStore().deleteEntry(alias) } catch (_: Exception) {}
                    generateEcKeyPair(alias, false)
                }
            } else {
                generateEcKeyPair(alias, false)
            }
            val ecPublic = pair.public as? ECPublicKey ?: throw IllegalStateException("Expected ECPublicKey")
            val x = fixed32Bytes(ecPublic.w.affineX)
            val y = fixed32Bytes(ecPublic.w.affineY)
            val sec1 = ByteArray(65)
            sec1[0] = 0x04
            System.arraycopy(x, 0, sec1, 1, 32)
            System.arraycopy(y, 0, sec1, 33, 32)
            val hardwareBacked = try {
                val factory = KeyFactory.getInstance(pair.private.algorithm, "AndroidKeyStore")
                val keyInfo = factory.getKeySpec(pair.private, KeyInfo::class.java)
                @Suppress("DEPRECATION")
                keyInfo.isInsideSecureHardware
            } catch (_: Exception) {
                true
            }
            invoke.resolve(JSObject().apply {
                put("sec1PublicKey", Base64.encodeToString(sec1, Base64.NO_WRAP))
                put("hardwareBacked", hardwareBacked)
            })
        } catch (_: Exception) {
            invoke.reject("publicKey.storageUnavailable")
        }
    }

    @Command
    fun signHardwareAuthChallenge(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(HardwareAuthKeyArgs::class.java)
            val keyId = requireNotNull(args.keyId)
            val challengeB64 = requireNotNull(args.challenge)
            val alias = hardwareKeyAlias(keyId)
            val privateKey = keyStore().getKey(alias, null) as? PrivateKey
                ?: run {
                    invoke.reject("publicKey.storageInvalidated")
                    return
                }
            val challenge = Base64.decode(challengeB64, Base64.NO_WRAP)
            try {
                val signature = Signature.getInstance("SHA256withECDSA").run {
                    initSign(privateKey)
                    update(challenge)
                    sign()
                }
                invoke.resolve(JSObject().apply {
                    put("signature", Base64.encodeToString(signature, Base64.NO_WRAP))
                })
            } finally {
                challenge.fill(0)
            }
        } catch (_: Exception) {
            invoke.reject("publicKey.signingFailed")
        }
    }

    @Command
    fun deleteHardwareAuthKey(invoke: Invoke) {
        try {
            val keyId = requireNotNull(invoke.parseArgs(HardwareAuthKeyArgs::class.java).keyId)
            val alias = hardwareKeyAlias(keyId)
            val store = keyStore()
            if (store.containsAlias(alias)) {
                store.deleteEntry(alias)
            }
            invoke.resolve()
        } catch (_: Exception) {
            invoke.reject("publicKey.storageUnavailable")
        }
    }
}
