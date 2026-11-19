package com.nilladigital.nilla.phone

import com.nilladigital.nilla.ErrorPages
import com.nilladigital.nilla.NetworkFailure
import com.nilladigital.nilla.PageLoadFailure
import com.nilladigital.nilla.PageTone
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ErrorPagesTest {
    private val otter = "https://en.wikipedia.org/wiki/Otter"

    @Test
    fun aFailedLoadKeepsTheLastRealTitleOfThatAddressOrShowsItsHost() {
        assertEquals("Otter - Wikipedia", ErrorPages.titleOnFailure("Otter - Wikipedia", titledUrl = otter, failedUrl = "$otter#Diet"))
        assertEquals("en.wikipedia.org", ErrorPages.titleOnFailure("Hippo - Wikipedia", titledUrl = "https://en.wikipedia.org/wiki/Hippo", failedUrl = otter))
        assertEquals("en.wikipedia.org", ErrorPages.titleOnFailure("", titledUrl = otter, failedUrl = otter))
        assertEquals("en.wikipedia.org", ErrorPages.titleOnFailure("Otter - Wikipedia", titledUrl = null, failedUrl = otter))
    }

    @Test
    fun whileALoadHasFailedTheErrorPagesTitleColoursAndPixelsNeverReachTheApp() {
        assertFalse(ErrorPages.takesFromPage(failedUrl = otter))
        assertTrue(ErrorPages.takesFromPage(failedUrl = null))
        assertFalse(ErrorPages.capturable(PageLoadFailure.Network(NetworkFailure.Offline)))
        assertFalse(ErrorPages.capturable(PageLoadFailure.Crashed))
        assertTrue(ErrorPages.capturable(null))
    }

    @Test
    fun aFailingPageGivesNoToneSoTheBarsFollowTheApp() {
        val white = PageTone(top = 0xFFFFFFFF.toInt(), bottom = 0xFFFFFFFF.toInt())
        assertEquals(PageTone(null, null), ErrorPages.tone(PageLoadFailure.Network(NetworkFailure.Offline), white))
        assertEquals(white, ErrorPages.tone(null, white))
    }
}
