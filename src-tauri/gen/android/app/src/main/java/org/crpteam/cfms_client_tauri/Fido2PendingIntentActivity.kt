package org.crpteam.cfms_client_tauri

import android.app.Activity
import android.app.PendingIntent
import android.content.Intent
import android.content.IntentSender
import android.os.Bundle

class Fido2PendingIntentActivity : Activity() {
    private var waitingForResult = false

    @Suppress("DEPRECATION")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        overridePendingTransition(0, 0)

        waitingForResult = savedInstanceState?.getBoolean(KEY_WAITING_FOR_RESULT, false) ?: false
        if (waitingForResult) return

        val pendingIntent = intent.getParcelableExtra<PendingIntent>(EXTRA_PENDING_INTENT)
        if (pendingIntent == null) {
            setResult(RESULT_CANCELED)
            finish()
            return
        }

        try {
            waitingForResult = true
            startIntentSenderForResult(
                pendingIntent.intentSender,
                REQUEST_CODE,
                null,
                0,
                0,
                0,
                null
            )
        } catch (_: IntentSender.SendIntentException) {
            setResult(RESULT_CANCELED)
            finish()
        }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        outState.putBoolean(KEY_WAITING_FOR_RESULT, waitingForResult)
        super.onSaveInstanceState(outState)
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == REQUEST_CODE) {
            setResult(resultCode, data)
        } else {
            setResult(RESULT_CANCELED)
        }
        waitingForResult = false
        finish()
    }

    companion object {
        const val EXTRA_PENDING_INTENT = "org.crpteam.cfms_client_tauri.FIDO2_PENDING_INTENT"
        private const val KEY_WAITING_FOR_RESULT = "waiting_for_result"
        private const val REQUEST_CODE = 10073
    }
}
