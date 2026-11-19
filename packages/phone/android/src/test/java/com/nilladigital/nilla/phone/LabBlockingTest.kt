package com.nilladigital.nilla.phone

import com.nilladigital.nilla.blocking.BlockingSettings
import com.nilladigital.nilla.blocking.ContentBlocker
import com.nilladigital.nilla.blocking.FetchResponse
import com.nilladigital.nilla.blocking.FilterListDownloader
import com.nilladigital.nilla.blocking.FilterLists
import com.nilladigital.nilla.blocking.InMemoryBlockingStore
import com.nilladigital.nilla.blocking.NetworkUnavailableException
import java.nio.file.Files
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class LabBlockingTest {
    private val labPage = "https://lab.example.test/blocking"

    private val labRequests = listOf(
        "https://securepubads.g.doubleclick.net/tag/js/gpt.js",
        "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js",
        "https://ad.doubleclick.net/ddm/ad/lab.gif",
        "https://www.google-analytics.com/analytics.js",
        "https://connect.facebook.net/en_US/fbevents.js",
        "https://static.hotjar.com/c/hotjar-1.js",
        "https://cdn.taboola.com/libtrc/lab/loader.js",
    )

    private fun blocker(): ContentBlocker {
        val store = InMemoryBlockingStore()
        val offline = object : FilterListDownloader {
            override suspend fun fetch(url: String, etag: String?, lastModified: String?, allowExpensive: Boolean): FetchResponse =
                throw NetworkUnavailableException()
        }
        val directory = Files.createTempDirectory("lab-blocking").toFile().apply { deleteOnExit() }
        return ContentBlocker(BlockingSettings(store), FilterLists(directory, store, offline))
    }

    @Test
    fun theLabPageRequestsAreBlockedBySeedsAlone() {
        val blocker = blocker()
        val blocked = labRequests.filter { blocker.blocks(it, labPage, false) }
        assertEquals(labRequests, blocked)
        val busted = labRequests.map { "$it?nilla=k3x9" }
        assertEquals(busted, busted.filter { blocker.blocks(it, "https://example.com/?lab=1", false) })
    }

    @Test
    fun turningBlockersOffForTheLabSiteLetsEveryRequestThrough() {
        val blocker = blocker()
        blocker.setBlockersEnabled(labPage, false)
        assertTrue(labRequests.none { blocker.blocks(it, labPage, false) })
        blocker.setBlockersEnabled("https://example.com/", false)
        assertTrue(labRequests.none { blocker.blocks("$it?nilla=k3x9", "https://example.com/?lab=2", false) })
        blocker.setBlockersEnabled(labPage, true)
        assertTrue(labRequests.all { blocker.blocks(it, labPage, false) })
    }
}
