package com.nilladigital.nilla.android

import android.content.Context
import android.util.Log
import com.nilladigital.nilla.phone.PhoneLab
import com.facebook.react.modules.network.OkHttpClientProvider
import okhttp3.Interceptor

object LabNetworkLog {
    private val TELEMETRY_HOST: String? = null
    private const val TELEMETRY_PATH = "/otel/"

    fun install(context: Context) {
        if (!PhoneLab.isOn) return
        val app = context.applicationContext
        OkHttpClientProvider.setOkHttpClientFactory {
            OkHttpClientProvider.createClientBuilder(app).addNetworkInterceptor(Interceptor { chain ->
                val request = chain.request()
                val telemetry = TELEMETRY_HOST != null && request.url.host == TELEMETRY_HOST && request.url.encodedPath.startsWith(TELEMETRY_PATH)
                val response = chain.proceed(request)
                if (telemetry) Log.i("PAGELAB", "PAGELAB telemetry posted: ${request.method} ${request.url.host}${request.url.encodedPath} -> ${response.code}")
                response
            }).build()
        }
    }
}
