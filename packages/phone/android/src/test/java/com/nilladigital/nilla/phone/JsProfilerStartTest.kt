package com.nilladigital.nilla.phone

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class JsProfilerStartTest {
    @Test
    fun aColdStartIsProfiledOnlyWhenTheLabArgumentAsks() {
        assertTrue(JsProfiler.startAsked(LaunchExtras.arguments(mapOf("NillaProfileStart" to true), allowed = true)))
        assertFalse(JsProfiler.startAsked(LaunchExtras.arguments(emptyMap(), allowed = true)))
        assertFalse(JsProfiler.startAsked(LaunchExtras.arguments(mapOf("NillaProfileStart" to "true"), allowed = true)))
    }

    @Test
    fun aStoreBuildIgnoresTheArgument() {
        assertFalse(JsProfiler.startAsked(LaunchExtras.arguments(mapOf("NillaProfileStart" to true), allowed = false)))
    }
}
