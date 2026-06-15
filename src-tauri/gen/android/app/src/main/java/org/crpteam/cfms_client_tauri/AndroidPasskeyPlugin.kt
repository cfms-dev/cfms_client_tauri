package org.crpteam.cfms_client_tauri

import android.app.Activity
import android.app.PendingIntent
import android.content.Intent
import android.os.Build
import android.os.CancellationSignal
import android.util.Base64
import android.util.Log
import android.webkit.WebView
import androidx.activity.result.ActivityResult
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
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import com.google.android.gms.fido.Fido
import com.google.android.gms.fido.common.Transport
import com.google.android.gms.fido.fido2.api.common.AuthenticatorErrorResponse
import com.google.android.gms.fido.fido2.api.common.AuthenticationExtensions
import com.google.android.gms.fido.fido2.api.common.FidoAppIdExtension
import com.google.android.gms.fido.fido2.api.common.PublicKeyCredential as Fido2PublicKeyCredential
import com.google.android.gms.fido.fido2.api.common.PublicKeyCredentialDescriptor
import com.google.android.gms.fido.fido2.api.common.PublicKeyCredentialRequestOptions
import com.google.android.gms.fido.fido2.api.common.UserVerificationRequirement
import com.google.android.gms.common.GoogleApiAvailability
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
            logDeviceCredentialEnvironment("createPasskey")
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
            logDeviceCredentialEnvironment("getPasskey")
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
                        if (shouldUseFido2GetFallback(e)) {
                            Log.w(TAG, "Credential Manager get failed with missing extra; trying FIDO2 fallback.", e)
                            startFido2GetPasskeyFallback(invoke, requestJson)
                            return
                        }
                        rejectCredentialError(invoke, "Failed to get Android passkey.", e)
                    }
                }
            )
        } catch (ex: Exception) {
            logCredentialError("Failed to start Android passkey verification.", ex)
            invoke.reject(ex.message ?: "Failed to start Android passkey verification.", ex)
        }
    }

    @ActivityCallback
    fun fido2GetPasskeyResult(invoke: Invoke, result: ActivityResult) {
        try {
            if (result.resultCode == Activity.RESULT_CANCELED) {
                invoke.reject("FIDO2 passkey verification was cancelled.")
                return
            }

            val data = result.data
                ?: throw IllegalArgumentException("FIDO2 passkey verification returned no data.")
            val responseBytes = fido2CredentialBytesFrom(data)
            val credential = Fido2PublicKeyCredential.deserializeFromBytes(responseBytes)
            val errorResponse = credential.response as? AuthenticatorErrorResponse
            if (errorResponse != null) {
                invoke.reject(
                    "FIDO2 passkey verification failed: " +
                        "${errorResponse.errorCode}: ${errorResponse.errorMessage ?: ""}".trim()
                )
                return
            }

            val responseJson = credential.toJson()
            invoke.resolve(JSObject().apply {
                put("id", credentialIdFrom(responseJson))
                put("authenticationResponseJson", responseJson)
            })
        } catch (ex: Exception) {
            logCredentialError("Failed to complete FIDO2 passkey fallback.", ex)
            invoke.reject(ex.message ?: "Failed to complete FIDO2 passkey fallback.", ex)
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

    private fun startFido2GetPasskeyFallback(invoke: Invoke, requestJson: String) {
        try {
            val requestOptions = buildFido2RequestOptions(requestJson)
            Fido.getFido2ApiClient(activity)
                .getSignPendingIntent(requestOptions)
                .addOnSuccessListener { pendingIntent ->
                    startFido2PendingIntent(invoke, pendingIntent)
                }
                .addOnFailureListener { ex ->
                    logCredentialError("Failed to start FIDO2 passkey fallback.", ex as? Exception ?: Exception(ex))
                    invoke.reject(ex.message ?: "Failed to start FIDO2 passkey fallback.", ex)
                }
        } catch (ex: Exception) {
            logCredentialError("Failed to prepare FIDO2 passkey fallback.", ex)
            invoke.reject(ex.message ?: "Failed to prepare FIDO2 passkey fallback.", ex)
        }
    }

    private fun startFido2PendingIntent(invoke: Invoke, pendingIntent: PendingIntent) {
        val intent = Intent(activity, Fido2PendingIntentActivity::class.java).apply {
            putExtra(Fido2PendingIntentActivity.EXTRA_PENDING_INTENT, pendingIntent)
        }
        startActivityForResult(invoke, intent, "fido2GetPasskeyResult")
    }

    private fun buildFido2RequestOptions(requestJson: String): PublicKeyCredentialRequestOptions {
        val request = JSONObject(requestJson)
        val builder = PublicKeyCredentialRequestOptions.Builder()
            .setChallenge(base64UrlDecode(requireString(request, "challenge")))
            .setRpId(requireString(request, "rpId"))

        if (request.has("timeout")) {
            builder.setTimeoutSeconds(request.getDouble("timeout") / 1000.0)
        }

        val allowCredentials = request.optJSONArray("allowCredentials")
        if (allowCredentials != null) {
            val allowList = mutableListOf<PublicKeyCredentialDescriptor>()
            for (index in 0 until allowCredentials.length()) {
                val credential = allowCredentials.getJSONObject(index)
                allowList.add(
                    PublicKeyCredentialDescriptor(
                        credential.optString("type", "public-key").ifBlank { "public-key" },
                        base64UrlDecode(requireString(credential, "id")),
                        transportsFrom(credential.optJSONArray("transports"))
                    )
                )
            }
            builder.setAllowList(allowList)
        }

        val extensions = request.optJSONObject("extensions")
        if (extensions != null) {
            val extensionBuilder = AuthenticationExtensions.Builder()
            val appId = extensions.optString("appid")
            if (appId.isNotBlank()) {
                extensionBuilder.setFido2Extension(FidoAppIdExtension(appId))
            }
            builder.setAuthenticationExtensions(extensionBuilder.build())
        }

        setFido2UserVerification(builder, request.optString("userVerification"))
        return builder.build()
    }

    private fun transportsFrom(transports: JSONArray?): List<Transport>? {
        if (transports == null) return null

        val parsed = mutableListOf<Transport>()
        for (index in 0 until transports.length()) {
            try {
                parsed.add(Transport.fromString(transports.getString(index)))
            } catch (ex: Transport.UnsupportedTransportException) {
                Log.w(TAG, "Ignoring unsupported FIDO2 transport: ${transports.optString(index)}", ex)
            }
        }
        return parsed.ifEmpty { null }
    }

    private fun setFido2UserVerification(
        builder: PublicKeyCredentialRequestOptions.Builder,
        userVerification: String
    ) {
        if (userVerification.isBlank()) return

        try {
            val requirement = UserVerificationRequirement.fromString(userVerification)
            val method = builder.javaClass.methods.firstOrNull {
                it.name == "setUserVerificationRequirement" && it.parameterCount == 1
            } ?: builder.javaClass.methods.firstOrNull {
                it.name == "zzc" && it.parameterCount == 1
            }
            if (method != null) {
                method.invoke(builder, requirement)
            } else {
                Log.w(TAG, "FIDO2 builder does not expose a userVerification setter.")
            }
        } catch (ex: Exception) {
            Log.w(TAG, "Failed to apply FIDO2 userVerification=$userVerification.", ex)
        }
    }

    private fun fido2CredentialBytesFrom(data: Intent): ByteArray {
        return data.getByteArrayExtra(Fido.FIDO2_KEY_CREDENTIAL_EXTRA)
            ?: throw IllegalArgumentException("FIDO2 passkey verification returned no credential extra.")
    }

    private fun shouldUseFido2GetFallback(ex: GetCredentialException): Boolean {
        val message = ex.message ?: return false
        return ex is androidx.credentials.exceptions.GetCredentialUnknownException
            && message.contains("Extra missing from request", ignoreCase = true)
    }

    private fun base64UrlDecode(value: String): ByteArray {
        return Base64.decode(value, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)
    }

    private fun logRequestJson(operation: String, requestJson: String) {
        if (BuildConfig.DEBUG) {
            Log.d(TAG, "$operation requestJson=$requestJson")
        }
    }

    private fun logDeviceCredentialEnvironment(operation: String) {
        if (!BuildConfig.DEBUG) return

        val gmsVersion = try {
            activity.packageManager
                .getPackageInfo(GoogleApiAvailability.GOOGLE_PLAY_SERVICES_PACKAGE, 0)
                .longVersionCode
        } catch (ex: Exception) {
            Log.w(TAG, "Unable to read Google Play services version.", ex)
            null
        }

        Log.d(
            TAG,
            "$operation environment sdk=${Build.VERSION.SDK_INT}, " +
                "gmsVersion=$gmsVersion, webViewWebAuthn=" +
                WebViewFeature.isFeatureSupported(WebViewFeature.WEB_AUTHENTICATION)
        )
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
