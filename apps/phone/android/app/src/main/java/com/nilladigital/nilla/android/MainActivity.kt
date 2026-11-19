package com.nilladigital.nilla.android

import android.content.Intent
import android.content.res.Configuration
import android.os.Bundle
import com.nilladigital.nilla.phone.FirstScreenDrawn
import com.nilladigital.nilla.phone.InsetHold
import com.nilladigital.nilla.phone.InsetsLab
import com.nilladigital.nilla.phone.JsProfiler
import com.nilladigital.nilla.phone.LookBudget
import com.nilladigital.nilla.phone.PhoneSystemLinks
import com.nilladigital.nilla.phone.ReactBack
import com.nilladigital.nilla.phone.RestorableState
import com.nilladigital.nilla.phone.SystemBars
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate
import expo.modules.ReactActivityDelegateWrapper

class MainActivity : ReactActivity() {
    @Suppress("DEPRECATION")
    private val reactBack = ReactBack { onBackPressed() }

    override fun onCreate(savedInstanceState: Bundle?) {
        JsProfiler.profileStart(this)
        RestorableState.restore(savedInstanceState)
        super.onCreate(null)
        onBackPressedDispatcher.addCallback(this, reactBack)
        FirstScreenDrawn.watch(this)
        InsetsLab.watch(this)
        InsetHold.install(this)
        SystemBars.apply(window)
        PhoneSystemLinks.activityStarted(intent, restored = savedInstanceState != null)
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        InsetHold.window.configurationChanged(newConfig)
        LookBudget.configurationChanged(newConfig)
        super.onConfigurationChanged(newConfig)
    }

    override fun onResume() {
        super.onResume()
        SystemBars.apply(window)
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        RestorableState.save(outState)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        PhoneSystemLinks.receive(intent)
    }

    override fun getMainComponentName(): String = "main"

    override fun createReactActivityDelegate(): ReactActivityDelegate = ReactActivityDelegateWrapper(
        this,
        BuildConfig.IS_NEW_ARCHITECTURE_ENABLED,
        object : DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled) {},
    )

    override fun invokeDefaultOnBackPressed() {
        if (ReactBack.leaveToTheBackground(this)) return
        reactBack.bypassed { super.invokeDefaultOnBackPressed() }
    }
}
