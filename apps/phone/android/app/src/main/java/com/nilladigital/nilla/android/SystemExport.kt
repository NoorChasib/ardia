package com.nilladigital.nilla.android

import android.content.Context
import com.nilladigital.nilla.android.system.NillaWidgets
import com.nilladigital.nilla.android.system.SystemSnapshotExporter
import com.nilladigital.nilla.android.system.SystemSnapshots
import com.nilladigital.nilla.android.system.SystemStore
import com.nilladigital.nilla.phone.NightChange
import com.nilladigital.nilla.phone.PhoneSync
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.launch

object SystemExport {
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    fun start(context: Context) {
        val app = context.applicationContext
        configurationChanged(app, app.resources.configuration.uiMode)
        scope.launch {
            PhoneSync.controllers.collectLatest { sync ->
                sync ?: return@collectLatest
                val demo = PhoneSync.isDemo
                val exporter = SystemSnapshotExporter(app, if (demo) SystemStore.demo(app) else SystemStore.shared(app), publishes = !demo)
                combine(sync.state, sync.snapshot, sync.selectedProfile, com.nilladigital.nilla.phone.WidgetColorChoice.flow(app)) { state, snapshot, selected, colorChoice -> SystemSnapshots.of(state, snapshot, selected, colorChoice) }
                    .distinctUntilChanged()
                    .collectLatest { runCatching { exporter.export(it) } }
            }
        }
    }

    private val night = NightChange()

    fun configurationChanged(context: Context, uiMode: Int) {
        if (!night.changed(uiMode)) return
        val app = context.applicationContext
        scope.launch {
            NillaWidgets.refreshSearch(app)
            NillaWidgets.refreshMacTabs(app)
        }
    }
}
