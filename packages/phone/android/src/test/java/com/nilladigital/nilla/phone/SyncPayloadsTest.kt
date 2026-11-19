package com.nilladigital.nilla.phone

import com.nilladigital.nilla.sync.SyncController
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class SyncPayloadsTest {
    @Test
    fun aRefusedFolderStaysFolderUnavailableAndCarriesItsReason() {
        val problem = com.nilladigital.nilla.sync.core.UpstreamSyncFolder.UNPLACED
        assertEquals(mapOf("result" to "folderUnavailable", "problem" to problem), SyncPayloads.connect(com.nilladigital.nilla.sync.ConnectResult.FolderRefused(problem)))
        assertEquals(mapOf("result" to "folderUnavailable"), SyncPayloads.connect(com.nilladigital.nilla.sync.ConnectResult.FolderUnavailable))
    }

    @Test
    fun aPickedFolderIsSentWithItsNameAndARefusedOneAsFolderUnavailableWithItsReason() {
        assertEquals(mapOf("folder" to "tree:a", "name" to "Nilla Sync"), SyncPayloads.pick(FolderPicks.Choice.Picked("tree:a", "Nilla Sync")))
        val problem = com.nilladigital.nilla.sync.core.UpstreamSyncFolder.UNPLACED
        assertEquals(mapOf("result" to "folderUnavailable", "problem" to problem), SyncPayloads.pick(FolderPicks.Choice.Refused(problem)))
        assertNull(SyncPayloads.pick(FolderPicks.Choice.Failed))
        assertNull(SyncPayloads.pick(null))
    }

    @Test
    fun theViewSaysWhichProfileIsShownBeforeAnyIsPickedAndAfter() {
        val demo = SyncController.demo().apply { start() }
        try {
            PhoneTestWaits.until { demo.snapshot.value.profiles.size > 1 }
            val snapshot = demo.snapshot.value
            val default = snapshot.profiles.first { it.isDefault }
            val other = snapshot.profiles.first { !it.isDefault }
            assertEquals(default.syncId, SyncPayloads.view(snapshot, null, emptyList())["shownProfileId"])
            assertEquals(other.syncId, SyncPayloads.view(snapshot, other.syncId, emptyList())["shownProfileId"])
            assertEquals(default.syncId, SyncPayloads.view(snapshot, "gone", emptyList())["shownProfileId"])
            assertNull(SyncPayloads.view(com.nilladigital.nilla.sync.SyncSnapshot.empty, null, emptyList())["shownProfileId"])
        } finally {
            demo.close()
        }
    }

    @Test
    fun aStalledStatusSaysHowLongAgoAtTheMomentItIsSentNotWhenItWasMade() {
        val synced = 1_800_000_000_000L
        val stalled = com.nilladigital.nilla.sync.SyncState(
            phase = com.nilladigital.nilla.sync.SyncPhase.Stalled("x"),
            statusText = com.nilladigital.nilla.sync.SyncStatusText.of(com.nilladigital.nilla.sync.SyncPhase.Stalled("x"), synced, 0, synced + 5_000),
            isEnabled = true,
            lastSynced = synced,
        )
        assertEquals("Not syncing · Last synced 3 minutes ago", SyncPayloads.status(stalled, null, now = synced + 3 * 60_000 + 10_000)["statusText"])
        val updated = stalled.copy(phase = com.nilladigital.nilla.sync.SyncPhase.Updated, statusText = "Updated just now")
        assertEquals("Updated just now", SyncPayloads.status(updated, null, now = synced + 3 * 60_000)["statusText"])
        assertEquals(true, SyncPayloads.wordsAge(stalled))
        assertEquals(false, SyncPayloads.wordsAge(updated))
    }

    @Test
    fun aPinStillOnItsWayIsInTheViewUntilThatProfilesBookmarksHoldIt() {
        val demo = SyncController.demo().apply { start() }
        try {
            PhoneTestWaits.until { demo.snapshot.value.profiles.isNotEmpty() }
            val snapshot = demo.snapshot.value
            val profile = snapshot.defaultProfile!!
            val known = profile.bookmarks.first { it.url != null }.url!!
            val pins = PhonePins()
            pins.pinned(profile.syncId, "https://new.example/")
            pins.pinned(profile.syncId, known)
            val view = SyncPayloads.view(snapshot, null, emptyList(), pins.waiting(snapshot))
            assertEquals(listOf(mapOf("profileSyncId" to profile.syncId, "url" to "https://new.example/")), view["pendingPins"])
            assertEquals(setOf(profile.syncId to "https://new.example/"), pins.waiting(snapshot))
        } finally {
            demo.close()
        }
    }
}
