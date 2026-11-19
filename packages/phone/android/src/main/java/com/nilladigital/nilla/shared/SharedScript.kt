package com.nilladigital.nilla.shared

enum class SharedScript(val fileName: String, val global: String) {
    SYNC("nilla-sync", "NillaSync"),
    SYNC_CHECKS("nilla-sync-checks", "NillaSyncChecks");

    val assetName: String get() = "$fileName.hbc"
}
