package org.crpteam.cfms_client_tauri

import android.app.Activity
import android.os.Build
import android.os.CancellationSignal
import android.util.Log
import android.webkit.WebView
import androidx.core.content.ContextCompat
import androidx.credentials.CreateCredentialResponse
import androidx.credentials.CreatePublicKeyCredentialRequest
import androidx.credentials.CreatePublicKeyCredentialResponse
import androidx.credentials.CredentialManager
import androidx.credentials.CredentialManagerCallback
import androidx.credentials.GetCredentialRequest
import androidx.credentials.GetCredentialResponse
import androidx.credentials.GetPublicKeyCredentialOption
import androidx.credentials.PublicKeyCredential
import androidx.credentials.exceptions.CreateCredentialException
import androidx.credentials.exceptions.GetCredentialException
import androidx.webkit.WebSettingsCompat
import androidx.webkit.WebViewFeature
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject
import org.json.JSONTokener

@InvokeArg
class PasskeyRequestArgs {
    lateinit var requestJson: String
}

@TauriPlugin
class AndroidPasskeyPlugin(private val activity: Activity) : Plugin(activity) {
    private val credentialManager by lazy { CredentialManager.create(activity) }

    override fun load(webView: WebView) {
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_AUTHENTICATION)) {
            WebSettingsCompat.setWebAuthenticationSupport(
                webView.settings,
                WebSettingsCompat.WEB_AUTHENTICATION_SUPPORT_FOR_APP
            )
        }
    }

    @Command
    fun isAvailable(invoke: Invoke) {
        val response = JSObject().apply {
            put("available", Build.VERSION.SDK_INT >= Build.VERSION_CODES.P)
            put(
                "webViewWebAuthn",
                WebViewFeature.isFeatureSupported(WebViewFeature.WEB_AUTHENTICATION)
            )
        }
        invoke.resolve(response)
    }

    @Command
    fun createPasskey(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(PasskeyRequestArgs::class.java)
            logRequestJson("createPasskey raw", args.requestJson)
            val requestJson = normalizeRequestJson(args.requestJson, PasskeyOperation.CREATE)
            logRequestJson("createPasskey normalized", requestJson)
            val request = CreatePublicKeyCredentialRequest(
                requestJson = requestJson,
                preferImmediatelyAvailableCredentials = false
            )
            credentialManager.createCredentialAsync(
                activity,
                request,
                CancellationSignal(),
                ContextCompat.getMainExecutor(activity),
                object : CredentialManagerCallback<CreateCredentialResponse, CreateCredentialException> {
                    override fun onResult(result: CreateCredentialResponse) {
                        val publicKeyResult = result as? CreatePublicKeyCredentialResponse
                        if (publicKeyResult == null) {
                            invoke.reject("Android did not return a public-key credential.")
                            return
                        }

                        val responseJson = publicKeyResult.registrationResponseJson
                        invoke.resolve(JSObject().apply {
                            put("id", credentialIdFrom(responseJson))
                            put("registrationResponseJson", responseJson)
                        })
                    }

                    override fun onError(e: CreateCredentialException) {
                        rejectCredentialError(invoke, "Failed to create Android passkey.", e)
                    }
                }
            )
        } catch (ex: Exception) {
            logCredentialError("Failed to start Android passkey creation.", ex)
            invoke.reject(ex.message ?: "Failed to start Android passkey creation.", ex)
        }
    }

    @Command
    fun getPasskey(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(PasskeyRequestArgs::class.java)
            logRequestJson("getPasskey raw", args.requestJson)
            val requestJson = normalizeRequestJson(args.requestJson, PasskeyOperation.GET)
            logRequestJson("getPasskey normalized", requestJson)
            val request = GetCredentialRequest(
                credentialOptions = listOf(
                    GetPublicKeyCredentialOption(
                        requestJson = requestJson
                    )
                ),
                preferImmediatelyAvailableCredentials = false
            )
            credentialManager.getCredentialAsync(
                activity,
                request,
                CancellationSignal(),
                ContextCompat.getMainExecutor(activity),
                object : CredentialManagerCallback<GetCredentialResponse, GetCredentialException> {
                    override fun onResult(result: GetCredentialResponse) {
                        val credential = result.credential as? PublicKeyCredential
                        if (credential == null) {
                            invoke.reject("Android did not return a public-key credential.")
                            return
                        }

                        val responseJson = credential.authenticationResponseJson
                        invoke.resolve(JSObject().apply {
                            put("id", credentialIdFrom(responseJson))
                            put("authenticationResponseJson", responseJson)
                        })
                    }

                    override fun onError(e: GetCredentialException) {
                        rejectCredentialError(invoke, "Failed to get Android passkey.", e)
                    }
                }
            )
        } catch (ex: Exception) {
            logCredentialError("Failed to start Android passkey verification.", ex)
            invoke.reject(ex.message ?: "Failed to start Android passkey verification.", ex)
        }
    }

    private fun credentialIdFrom(responseJson: String): String {
        val parsed = JSONObject(responseJson)
        return parsed.optString("rawId").ifBlank {
            parsed.optString("id")
        }
    }

    private fun normalizeRequestJson(requestJson: String, operation: PasskeyOperation): String {
        val parsed = parsePossiblyEncodedJson(requestJson)
        val publicKeyOptions = unwrapPublicKeyOptions(parsed)
        val request = publicKeyOptions as? JSONObject
            ?: throw IllegalArgumentException("Android passkey requestJson must be a JSON object.")

        validatePublicKeyRequest(request, operation)
        return request.toString()
    }

    private fun parsePossiblyEncodedJson(value: String): Any? {
        var parsed: Any? = parseJsonValue(value)

        repeat(2) {
            if (parsed is String) {
                parsed = parseJsonValue(parsed as String)
            }
        }

        return parsed
    }

    private fun parseJsonValue(value: String): Any? {
        return try {
            JSONTokener(value).nextValue()
        } catch (ex: JSONException) {
            throw IllegalArgumentException("Android passkey requestJson must be valid JSON.", ex)
        }
    }

    private fun unwrapPublicKeyOptions(value: Any?): Any? {
        var current = value

        repeat(2) {
            current = when (current) {
                is JSONObject -> {
                    val publicKey = (current as JSONObject).opt("publicKey")
                    when (publicKey) {
                        is JSONObject -> publicKey
                        is String -> parsePossiblyEncodedJson(publicKey)
                        else -> current
                    }
                }
                is String -> parsePossiblyEncodedJson(current as String)
                else -> current
            }
        }

        return current
    }

    private fun validatePublicKeyRequest(request: JSONObject, operation: PasskeyOperation) {
        requireString(request, "challenge")

        when (operation) {
            PasskeyOperation.CREATE -> {
                val rp = requireObject(request, "rp")
                requireString(rp, "id")
                requireObject(request, "user")
                requireArray(request, "pubKeyCredParams")
            }
            PasskeyOperation.GET -> {
                requireString(request, "rpId")

                val allowCredentials = request.opt("allowCredentials")
                if (allowCredentials != null && allowCredentials != JSONObject.NULL) {
                    if (allowCredentials !is JSONArray) {
                        throw IllegalArgumentException(
                            "Android passkey requestJson.allowCredentials must be an array."
                        )
                    }

                    for (index in 0 until allowCredentials.length()) {
                        val credential = allowCredentials.opt(index) as? JSONObject
                            ?: throw IllegalArgumentException(
                                "Android passkey requestJson.allowCredentials[$index] must be an object."
                            )
                        requireString(credential, "id")
                    }
                }
            }
        }
    }

    private fun requireString(request: JSONObject, field: String): String {
        val value = request.optString(field)
        if (value.isBlank()) {
            throw IllegalArgumentException("Android passkey requestJson.$field is required.")
        }
        return value
    }

    private fun requireObject(request: JSONObject, field: String): JSONObject {
        return request.optJSONObject(field)
            ?: throw IllegalArgumentException("Android passkey requestJson.$field must be an object.")
    }

    private fun requireArray(request: JSONObject, field: String): JSONArray {
        return request.optJSONArray(field)
            ?: throw IllegalArgumentException("Android passkey requestJson.$field must be an array.")
    }

    private fun logRequestJson(operation: String, requestJson: String) {
        if (BuildConfig.DEBUG) {
            Log.d(TAG, "$operation requestJson=$requestJson")
        }
    }

    private fun rejectCredentialError(invoke: Invoke, fallback: String, ex: Exception) {
        logCredentialError(fallback, ex)
        val name = ex::class.java.simpleName
        val type = credentialExceptionType(ex)
        val message = ex.message?.takeIf { it.isNotBlank() } ?: fallback
        val prefix = if (type.isNullOrBlank()) name else "$name($type)"
        invoke.reject("$prefix: $message", ex)
    }

    private fun logCredentialError(action: String, ex: Exception) {
        val type = credentialExceptionType(ex) ?: "n/a"
        Log.e(
            TAG,
            "$action class=${ex::class.java.name}, type=$type, message=${ex.message}",
            ex
        )
    }

    private fun credentialExceptionType(ex: Exception): String? {
        return try {
            ex::class.java.methods
                .firstOrNull { it.name == "getType" && it.parameterCount == 0 }
                ?.invoke(ex) as? String
        } catch (_: Exception) {
            null
        }
    }

    private enum class PasskeyOperation {
        CREATE,
        GET
    }

    private companion object {
        private const val TAG = "AndroidPasskey"
    }
}
