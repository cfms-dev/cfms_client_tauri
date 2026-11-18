package org.crpteam.cfms_client_tauri

import android.app.Activity
import android.content.pm.PackageManager
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyInfo
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.security.keystore.KeyProperties
import android.util.Base64
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.math.BigInteger
import java.security.InvalidKeyException
import java.security.KeyFactory
import java.security.KeyPair
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.PrivateKey
import java.security.Signature
import java.security.UnrecoverableKeyException
import java.security.interfaces.ECPublicKey
import java.security.spec.ECGenParameterSpec

@InvokeArg
class HardwareAuthKeyArgs {
    var keyId: String? = null
    var challenge: String? = null
}

/** Hardware-backed ECDSA P-256 authentication keys in Android Keystore. */
@TauriPlugin
class AndroidAuthKeyPlugin(private val activity: Activity) : Plugin(activity) {
    companion object {
        private val KEY_ID_PATTERN = Regex("^[A-Za-z0-9_-]{8,128}$")
        private const val PROBE_ALIAS = "cfms_auth_hw_probe_temp"

        @Volatile
        private var cachedHardwareSupported: Boolean? = null
    }

    private fun keyStore(): KeyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }

    private fun validatedKeyId(raw: String?): String {
        val value = requireNotNull(raw)
        if (!KEY_ID_PATTERN.matches(value)) {
            throw IllegalArgumentException("Invalid managed key ID")
        }
        return value
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

    private fun generateEcKeyPair(alias: String, useStrongBox: Boolean): KeyPair {
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

    private fun isKeyHardwareBacked(privateKey: PrivateKey): Boolean {
        return try {
            val factory = KeyFactory.getInstance(privateKey.algorithm, "AndroidKeyStore")
            val keyInfo = factory.getKeySpec(privateKey, KeyInfo::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                keyInfo.securityLevel == KeyProperties.SECURITY_LEVEL_TRUSTED_ENVIRONMENT ||
                    keyInfo.securityLevel == KeyProperties.SECURITY_LEVEL_STRONGBOX
            } else {
                @Suppress("DEPRECATION")
                keyInfo.isInsideSecureHardware
            }
        } catch (_: Exception) {
            // Fail closed: never advertise hardware backing when KeyInfo cannot be verified.
            false
        }
    }

    private fun detectHardwareSupport(): Boolean {
        cachedHardwareSupported?.let { return it }
        val pm = activity.packageManager
        val detected = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            pm.hasSystemFeature(PackageManager.FEATURE_HARDWARE_KEYSTORE) ||
                pm.hasSystemFeature(PackageManager.FEATURE_STRONGBOX_KEYSTORE)
        } else if (pm.hasSystemFeature(PackageManager.FEATURE_STRONGBOX_KEYSTORE)) {
            true
        } else {
            val store = keyStore()
            try {
                try { store.deleteEntry(PROBE_ALIAS) } catch (_: Exception) {}
                val pair = generateEcKeyPair(PROBE_ALIAS, false)
                isKeyHardwareBacked(pair.private)
            } catch (_: Exception) {
                false
            } finally {
                try { store.deleteEntry(PROBE_ALIAS) } catch (_: Exception) {}
            }
        }
        cachedHardwareSupported = detected
        return detected
    }

    @Command
    fun checkHardwareAuthSupport(invoke: Invoke) {
        try {
            keyStore()
            val hardware = detectHardwareSupport()
            invoke.resolve(JSObject().apply {
                put("available", hardware)
                put("hardwareBacked", hardware)
            })
        } catch (_: Exception) {
            invoke.resolve(JSObject().apply {
                put("available", false)
                put("hardwareBacked", false)
            })
        }
    }

    @Command
    fun verifyHardwareAuthKey(invoke: Invoke) {
        try {
            val keyId = validatedKeyId(invoke.parseArgs(HardwareAuthKeyArgs::class.java).keyId)
            val alias = hardwareKeyAlias(keyId)
            val store = keyStore()
            if (!store.containsAlias(alias)) {
                invoke.reject("publicKey.storageInvalidated")
                return
            }
            val privateKey = store.getKey(alias, null) as? PrivateKey
            if (privateKey == null) {
                invoke.reject("publicKey.storageInvalidated")
                return
            }
            invoke.resolve()
        } catch (_: UnrecoverableKeyException) {
            invoke.reject("publicKey.storageInvalidated")
        } catch (_: KeyPermanentlyInvalidatedException) {
            invoke.reject("publicKey.storageInvalidated")
        } catch (_: InvalidKeyException) {
            invoke.reject("publicKey.storageInvalidated")
        } catch (_: IllegalArgumentException) {
            invoke.reject("publicKey.selectAgain")
        } catch (_: Exception) {
            invoke.reject("publicKey.storageUnavailable")
        }
    }

    @Command
    fun generateHardwareAuthKey(invoke: Invoke) {
        var createdAlias: String? = null
        try {
            val keyId = validatedKeyId(invoke.parseArgs(HardwareAuthKeyArgs::class.java).keyId)
            val alias = hardwareKeyAlias(keyId)
            createdAlias = alias
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
            val hardwareBacked = isKeyHardwareBacked(pair.private)
            invoke.resolve(JSObject().apply {
                put("sec1PublicKey", Base64.encodeToString(sec1, Base64.NO_WRAP))
                put("hardwareBacked", hardwareBacked)
            })
        } catch (_: Exception) {
            createdAlias?.let { alias ->
                try { keyStore().deleteEntry(alias) } catch (_: Exception) {}
            }
            invoke.reject("publicKey.storageUnavailable")
        }
    }

    @Command
    fun signHardwareAuthChallenge(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(HardwareAuthKeyArgs::class.java)
            val keyId = validatedKeyId(args.keyId)
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
        } catch (_: UnrecoverableKeyException) {
            invoke.reject("publicKey.storageInvalidated")
        } catch (_: KeyPermanentlyInvalidatedException) {
            invoke.reject("publicKey.storageInvalidated")
        } catch (_: InvalidKeyException) {
            invoke.reject("publicKey.storageInvalidated")
        } catch (_: Exception) {
            invoke.reject("publicKey.signingFailed")
        }
    }

    @Command
    fun deleteHardwareAuthKey(invoke: Invoke) {
        try {
            val keyId = validatedKeyId(invoke.parseArgs(HardwareAuthKeyArgs::class.java).keyId)
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
