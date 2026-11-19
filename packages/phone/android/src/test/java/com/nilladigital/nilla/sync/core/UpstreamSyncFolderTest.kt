package com.nilladigital.nilla.sync.core

import com.nilladigital.nilla.sync.LocalFolderAccess
import com.nilladigital.nilla.sync.SyncFolderLocation
import com.nilladigital.nilla.sync.SyncFolderPick
import com.nilladigital.nilla.sync.SyncFolders
import java.io.File
import java.io.IOException
import java.nio.file.Files
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class UpstreamSyncFolderTest {
    @get:Rule
    val temporary = TemporaryFolder()

    private val home: File get() = temporary.root.canonicalFile

    private fun folder(vararg parts: String): File = parts.fold(home) { at, part -> File(at, part) }.apply { mkdirs() }

    private fun link(at: File, target: File): File = Files.createSymbolicLink(at.toPath(), target.toPath()).toFile()

    @Test
    fun theUpstreamNameIsFoldedForCaseSpacesAndTrailingDots() {
        for (name in listOf(UpstreamSyncFolder.NAME, UpstreamSyncFolder.NAME.uppercase(), " ${UpstreamSyncFolder.NAME} ", "${UpstreamSyncFolder.NAME}.", "${UpstreamSyncFolder.NAME} . ")) {
            assertTrue(name, UpstreamSyncFolder.isUpstreamName(name))
        }
        for (name in listOf("Nilla Sync", "${UpstreamSyncFolder.NAME} 2", "Sync", null)) assertFalse("$name", UpstreamSyncFolder.isUpstreamName(name))
    }

    @Test
    fun aFolderInsideTheUpstreamFolderIsRefusedAndNillasOwnIsNot() {
        val upstream = folder(UpstreamSyncFolder.NAME, "chain")
        assertTrue(UpstreamSyncFolder.refuses(upstream))
        assertTrue(UpstreamSyncFolder.refuses(File(upstream, "not-yet")))
        val own = folder("Nilla Sync")
        assertFalse(UpstreamSyncFolder.refuses(own))
        assertFalse(UpstreamSyncFolder.refuses(File(own, "not-yet/deeper")))
    }

    @Test
    fun aLinkIsFollowedToWhereItReallyLeads() {
        val upstream = folder(UpstreamSyncFolder.NAME)
        val alias = link(File(home, "Nilla Sync"), upstream)
        assertTrue(UpstreamSyncFolder.refuses(alias))
        assertTrue(UpstreamSyncFolder.refuses(File(alias, "chain-not-made")))
        val inner = folder(UpstreamSyncFolder.NAME, "inner")
        val parentOfLink = File(link(File(home, "elsewhere"), inner), "..")
        assertTrue("the parent of a link is the parent of its target, not of the link", UpstreamSyncFolder.refuses(parentOfLink))
    }

    @Test
    fun aDanglingLinkIsRefusedBecauseItCannotBeResolved() {
        val dangling = link(File(home, "Nilla Sync"), File(home, "nowhere"))
        assertTrue(UpstreamSyncFolder.refuses(dangling))
        assertTrue(UpstreamSyncFolder.refuses(File(dangling, "chain")))
    }

    @Test
    fun aDocumentIdThatNamesThePathIsCheckedPartByPart() {
        assertTrue(UpstreamSyncFolder.refusesDocument("primary:Documents/${UpstreamSyncFolder.NAME}"))
        assertTrue(UpstreamSyncFolder.refusesDocument("primary:${UpstreamSyncFolder.NAME}./chain"))
        assertFalse(UpstreamSyncFolder.refusesDocument("primary:Documents/Nilla Sync"))
        assertFalse(UpstreamSyncFolder.refusesDocument("acc=1;doc=encoded=abc"))
        assertFalse(UpstreamSyncFolder.refusesDocument(null))
    }

    @Test
    fun folderStorageRefusesEveryOperationThatALinkLeadsIntoTheUpstreamFolder() {
        val upstream = folder(UpstreamSyncFolder.NAME, "chain")
        val own = folder("Nilla Sync")
        link(File(own, "chain"), upstream)
        val storage = FolderStorage(own)
        assertThrows(IOException::class.java) { storage.names(listOf("chain")) }
        assertThrows(IOException::class.java) { storage.write(listOf("chain", "a.nls"), byteArrayOf(1)) }
        assertFalse(storage.isDirectory(listOf("chain")))
        assertFalse(File(upstream, "a.nls").exists())
        assertEquals(listOf("chain"), storage.names(emptyList()))
    }

    @Test
    fun localFolderAccessNeitherOpensNorResolvesAnUpstreamFolder() {
        val access = LocalFolderAccess()
        val upstream = folder(UpstreamSyncFolder.NAME)
        assertNull(access.open(SyncFolderPick.Folder(upstream)))
        assertNull(access.open(SyncFolderPick.Folder(link(File(home, "alias"), upstream))))
        assertNull(access.resolve(SyncFolderLocation.Path(upstream.path, upstream.name)))
        assertFalse(access.keep(SyncFolderLocation.Path(upstream.path, upstream.name)))
        assertNotNull(access.open(SyncFolderPick.Folder(folder("Nilla Sync"))))
    }

    @Test
    fun discoveryNeverProbesACandidateThatLeadsIntoTheUpstreamFolder() {
        val upstream = folder(UpstreamSyncFolder.NAME)
        folder(UpstreamSyncFolder.NAME, "a".repeat(26))
        val picked = folder("Picked")
        link(File(picked, "Nilla Sync"), upstream)
        assertEquals(picked, SyncFolders.locate(picked))
        assertNull(SyncFolders.locate(upstream))
        val granted = LocalFolderAccess().open(SyncFolderPick.Folder(picked))
        assertEquals(SyncFolderLocation.Path(picked.path, picked.name), granted?.location)
    }

    @Test
    fun removingATreeDeletesALinkInsideItWithoutFollowingIt() {
        val upstream = folder(UpstreamSyncFolder.NAME)
        val marker = File(upstream, "marker").apply { writeText("kept") }
        val chain = folder("Nilla Sync", "a".repeat(26), "inner")
        link(File(chain, "into"), upstream)
        File(chain, "own.nls").writeText("gone")
        FolderStorage(folder("Nilla Sync")).removeTree(listOf("a".repeat(26)))
        assertTrue(marker.exists())
        assertFalse(File(home, "Nilla Sync/${"a".repeat(26)}").exists())
        FolderStorage(folder("Nilla Sync")).removeTree(listOf("missing"))
    }
}
