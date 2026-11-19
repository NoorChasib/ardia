package com.nilladigital.nilla.phone

import java.io.File
import java.nio.file.Files
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class FolderPicksTest {
    private val file = File(Files.createTempDirectory("folder-picks").toFile(), "folder-picks.json")
    private val held = LinkedHashSet<String>()
    private val log = ArrayList<String>()
    private var connected: String? = null
    private var now = 1_000L

    private val grants = object : FolderPicks.Grants {
        override fun take(tree: String): Boolean {
            log += "take $tree"
            return held.add(tree) || true
        }

        override fun release(tree: String) {
            log += "release $tree"
            held.remove(tree)
        }

        override fun connected(): String? = connected
    }

    private fun picks() = FolderPicks(file, grants) { now }

    @Test
    fun aPickTakesTheGrantAtOnceAndARetryNeedsNoNewPick() {
        assertTrue(picks().picked("tree:a"))
        assertEquals(setOf("tree:a"), held)
        assertTrue("a later process still knows the pick", picks().holds("tree:a"))
        picks().connected("tree:a")
        connected = "tree:a"
        assertEquals(setOf("tree:a"), held)
        assertFalse(picks().holds("tree:a"))
    }

    @Test
    fun aNewPickReleasesTheOneNeverConnectedButNeverTheConnectedFolder() {
        connected = "tree:old"
        held += "tree:old"
        picks().picked("tree:a")
        picks().picked("tree:b")
        assertEquals(setOf("tree:old", "tree:b"), held)
        picks().picked("tree:old")
        assertTrue(held.contains("tree:old"))
        picks().forget("tree:old")
        assertTrue("forgetting the connected folder keeps its grant", held.contains("tree:old"))
        picks().forget("tree:b")
        assertFalse(held.contains("tree:b"))
    }

    @Test
    fun picksLeftUnusedForADayAreReleasedOnTheNextStart() {
        picks().picked("tree:a")
        now += FolderPicks.UNUSED_MILLIS - 1
        picks().sweep()
        assertTrue(held.contains("tree:a"))
        now += 2
        picks().sweep()
        assertFalse(held.contains("tree:a"))
        assertFalse(picks().holds("tree:a"))
    }

    @Test
    fun aRefusedPickIsNeitherGrantedNorRecordedNorAskedForItsName() {
        val asked = ArrayList<String>()
        val named = ArrayList<String>()
        val refusal = { tree: String -> asked += tree; "refused $tree" }
        val choice = picks().choose("tree:drive", refusal) { tree -> named += tree; "Drive" }
        assertEquals(FolderPicks.Choice.Refused("refused tree:drive"), choice)
        assertEquals(listOf("tree:drive"), asked)
        assertTrue("no grant is taken or released", log.isEmpty())
        assertTrue("the provider is never asked for the folder's name", named.isEmpty())
        assertFalse("nothing is recorded", file.exists())
        assertFalse(picks().holds("tree:drive"))
    }

    @Test
    fun aRefusedPickLeavesAnEarlierPickAndItsGrantAlone() {
        picks().picked("tree:a")
        log.clear()
        picks().choose("tree:drive", { "refused" }) { "Drive" }
        assertTrue(log.isEmpty())
        assertEquals(setOf("tree:a"), held)
        assertTrue(picks().holds("tree:a"))
    }

    @Test
    fun aPlacedPickIsGrantedRecordedAndThenNamed() {
        val order = ArrayList<String>()
        val choice = picks().choose("tree:a", { order += "check"; null }) { tree -> order += "name"; assertTrue("the grant comes before the name", held.contains(tree)); "Nilla Sync" }
        assertEquals(FolderPicks.Choice.Picked("tree:a", "Nilla Sync"), choice)
        assertEquals(listOf("check", "name"), order)
        assertEquals(listOf("take tree:a"), log)
        assertTrue(picks().holds("tree:a"))
    }

    @Test
    fun aPlacedPickWhoseGrantCannotBeTakenIsNeverNamed() {
        val refusing = FolderPicks(file, object : FolderPicks.Grants by grants {
            override fun take(tree: String): Boolean = false
        }) { now }
        var named = false
        assertEquals(FolderPicks.Choice.Failed, refusing.choose("tree:z", { null }) { named = true; "z" })
        assertFalse(named)
    }

    @Test
    fun aPickWhoseGrantCannotBeTakenIsRefused() {
        val refusing = FolderPicks(file, object : FolderPicks.Grants by grants {
            override fun take(tree: String): Boolean = false
        }) { now }
        assertFalse(refusing.picked("tree:z"))
        assertFalse(refusing.holds("tree:z"))
    }
}
