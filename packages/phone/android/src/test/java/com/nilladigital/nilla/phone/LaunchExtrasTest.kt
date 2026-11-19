package com.nilladigital.nilla.phone

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class LaunchExtrasTest {
    private val extras = mapOf<String, Any?>(
        "NillaDemo" to true,
        "BrowseQuery" to "otters",
        "BrowseTab" to 2,
        "BrowseDelay" to 1.5f,
        "BrowseDeckOpen" to 3L,
        "NillaColor" to "  green ",
        "com.nilladigital.nilla.phone.PAGE_LAB" to true,
        "unrelated" to "x",
        "BrowseOverlay" to null,
    )

    @Test
    fun aLabOrTestBuildPassesEveryNillaAndBrowseExtraAsItCame() {
        assertEquals(
            mapOf("NillaDemo" to true, "BrowseQuery" to "otters", "BrowseTab" to 2.0, "BrowseDelay" to 1.5, "BrowseDeckOpen" to 3.0, "NillaColor" to "  green "),
            LaunchExtras.arguments(extras, allowed = true),
        )
    }

    @Test
    fun aStoreBuildPassesNone() {
        assertEquals(emptyMap<String, Any>(), LaunchExtras.arguments(extras, allowed = false))
        assertFalse(LaunchExtras.isDemo(extras, allowed = false))
    }

    @Test
    fun nillaDemoTurnsTheSyncDemoOnAsTheComposeAppReadsTheFlag() {
        assertTrue(LaunchExtras.isDemo(mapOf("NillaDemo" to true), allowed = true))
        assertTrue(LaunchExtras.isDemo(mapOf("NillaDemo" to "1"), allowed = true))
        assertFalse(LaunchExtras.isDemo(mapOf("NillaDemo" to "false"), allowed = true))
        assertFalse(LaunchExtras.isDemo(mapOf("NillaDemo" to "no"), allowed = true))
        assertFalse(LaunchExtras.isDemo(emptyMap(), allowed = true))
        assertTrue(LaunchExtras.isDemo(mapOf(PhoneSync.DEMO_EXTRA to true), allowed = true))
    }
}
