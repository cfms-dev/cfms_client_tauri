package org.crpteam.cfms_client_tauri

import android.app.Activity
import android.os.CancellationSignal
import android.os.Build
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
import org.json.JSONObject

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
            val request = CreatePublicKeyCredentialRequest(args.requestJson)
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
            invoke.reject(ex.message ?: "Failed to start Android passkey creation.", ex)
        }
    }

    @Command
    fun getPasskey(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(PasskeyRequestArgs::class.java)
            val request = GetCredentialRequest(
                listOf(GetPublicKeyCredentialOption(args.requestJson))
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
            invoke.reject(ex.message ?: "Failed to start Android passkey verification.", ex)
        }
    }

    private fun credentialIdFrom(responseJson: String): String {
        val parsed = JSONObject(responseJson)
        return parsed.optString("rawId").ifBlank {
            parsed.optString("id")
        }
    }

    private fun rejectCredentialError(invoke: Invoke, fallback: String, ex: Exception) {
        val name = ex::class.java.simpleName
        val message = ex.message?.takeIf { it.isNotBlank() } ?: fallback
        invoke.reject("$name: $message", ex)
    }
}
