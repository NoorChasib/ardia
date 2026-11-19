package com.nilladigital.nilla.sync

import com.nilladigital.nilla.sync.core.UpstreamSyncFolder
import java.io.IOException
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class UpstreamGuardedTreeTest {
    private val tag = "a".repeat(26)
    private val placed = listOf("Documents")

    private class RecordingTree(val inner: FakeDocumentTree) : DocumentTree by inner {
        val touched = ArrayList<String>()

        override fun root(): DocumentEntry = inner.root().also { touched += inner.rootId }

        override fun children(parentId: String): List<DocumentEntry> = inner.children(parentId).also { touched += parentId }

        override fun read(id: String): ByteArray = inner.read(id).also { touched += id }

        override fun create(parentId: String, name: String, directory: Boolean): DocumentEntry = inner.create(parentId, name, directory).also { touched += parentId }
    }

    private fun place(tree: FakeDocumentTree, id: String, parent: String, name: String, directory: Boolean, bytes: ByteArray = ByteArray(0)): String {
        tree.nodes[id] = FakeDocumentTree.Node(name, directory, parent).also {
            it.bytes = bytes
            it.modified = tree.clock
        }
        return id
    }

    @Test
    fun aSavedGrantWhoseRootIsNowTheUpstreamFolderIsRefusedBeforeAnyListing() {
        val fake = FakeDocumentTree()
        fake.add(fake.rootId, tag, directory = true)
        val tree = RecordingTree(fake)
        val storage = UpstreamGuardedTree.storage(tree, placed, null, "Picked")
        assertEquals(listOf(tag), storage.names(emptyList()))
        fake.nodes.getValue(fake.rootId).name = UpstreamSyncFolder.NAME
        tree.touched.clear()
        val refusal = assertThrows(IOException::class.java) { storage.names(emptyList()) }
        assertEquals(UpstreamSyncFolder.REFUSAL, refusal.message)
        assertEquals(listOf(fake.rootId), tree.touched)
    }

    @Test
    fun aSavedSubfolderGrantChecksTheCurrentRootFirst() {
        val fake = FakeDocumentTree()
        val sub = fake.add(fake.rootId, "Nilla Sync", directory = true)
        fake.add(sub, tag, directory = true)
        fake.nodes.getValue(fake.rootId).name = "${UpstreamSyncFolder.NAME}."
        val tree = RecordingTree(fake)
        assertThrows(IOException::class.java) { UpstreamGuardedTree.storage(tree, placed, "Nilla Sync", "Nilla Sync").names(emptyList()) }
        assertEquals(listOf(fake.rootId), tree.touched)
    }

    @Test
    fun aChildWhoseIdLeadsIntoTheUpstreamFolderIsNeitherProbedNorUsed() {
        val fake = FakeDocumentTree()
        val upstreamChild = place(fake, "primary:Documents/${UpstreamSyncFolder.NAME}/Nilla Sync", fake.rootId, "Nilla Sync", true)
        val chain = place(fake, "$upstreamChild/$tag", upstreamChild, tag, true)
        place(fake, "$chain/f.nls", chain, "f.nls", false, byteArrayOf(7))
        val tree = RecordingTree(fake)
        assertNull(UpstreamGuardedTree.locate(tree, placed))
        val storage = UpstreamGuardedTree.storage(tree, placed, "Nilla Sync", "Nilla Sync")
        assertNull(storage.names(emptyList()))
        assertThrows(IOException::class.java) { storage.read(listOf(tag, "f.nls")) }
        assertTrue(tree.touched.toString(), tree.touched.none { it.startsWith(upstreamChild) })
    }

    @Test
    fun aNestedChildThatLeadsIntoTheUpstreamFolderIsHiddenAndNeverRead() {
        val fake = FakeDocumentTree()
        val sub = fake.add(fake.rootId, "Nilla Sync", directory = true)
        val upstreamChain = place(fake, "primary:${UpstreamSyncFolder.NAME}/$tag", sub, tag, true)
        place(fake, "$upstreamChain/f.nls", upstreamChain, "f.nls", false, byteArrayOf(7))
        val named = fake.add(sub, UpstreamSyncFolder.NAME.uppercase(), directory = true)
        val tree = RecordingTree(fake)
        val storage = UpstreamGuardedTree.storage(tree, placed, "Nilla Sync", "Nilla Sync")
        assertEquals(emptyList<String>(), storage.names(emptyList()))
        assertThrows(IOException::class.java) { storage.read(listOf(tag, "f.nls")) }
        assertTrue(tree.touched.toString(), tree.touched.none { it.startsWith(upstreamChain) || it == named })
    }

    @Test
    fun aSafeTreeStillSyncsThroughTheGuard() {
        val fake = FakeDocumentTree()
        val sub = fake.add(fake.rootId, "Nilla Sync", directory = true)
        fake.add(sub, tag, directory = true)
        assertEquals("Nilla Sync", UpstreamGuardedTree.locate(fake, placed))
        val storage = UpstreamGuardedTree.storage(fake, placed, "Nilla Sync", "Nilla Sync")
        storage.write(listOf(tag, "f.nls"), byteArrayOf(1, 2))
        assertArrayEquals(byteArrayOf(1, 2), storage.read(listOf(tag, "f.nls")))
    }

    @Test
    fun theGuardRefusesUpstreamIdsAndNamesForEveryOperation() {
        val fake = FakeDocumentTree()
        val guarded = UpstreamGuardedTree(fake, placed)
        val upstream = "primary:${UpstreamSyncFolder.NAME}"
        assertThrows(IOException::class.java) { guarded.children(upstream) }
        assertThrows(IOException::class.java) { guarded.read(upstream) }
        assertThrows(IOException::class.java) { guarded.write(upstream, byteArrayOf(1)) }
        assertThrows(IOException::class.java) { guarded.delete(upstream) }
        assertThrows(IOException::class.java) { guarded.create(upstream, "x", directory = false) }
        assertThrows(IOException::class.java) { guarded.create(fake.rootId, UpstreamSyncFolder.NAME, directory = true) }
        assertNull(fake.find(fake.rootId, UpstreamSyncFolder.NAME))
    }

    @Test
    fun aTreeFromAProviderWithOpaqueIdsIsRefusedBeforeAnythingIsListedOrRead() {
        val fake = FakeDocumentTree()
        val hidden = place(fake, "acc=1;doc=encoded=parent", "acc=1;doc=encoded=top", UpstreamSyncFolder.NAME, true)
        fake.nodes.getValue(fake.rootId).apply { name = "Nilla Sync"; parent = hidden }
        fake.add(fake.rootId, tag, directory = true)
        val tree = RecordingTree(fake)
        val ancestry = UpstreamSyncFolder.ancestry("com.google.android.apps.docs.storage", "acc=1;doc=encoded=root")
        assertNull(ancestry)
        val refusal = assertThrows(IOException::class.java) { UpstreamGuardedTree.storage(tree, ancestry, null, "Nilla Sync").names(emptyList()) }
        assertEquals(UpstreamSyncFolder.UNPLACED, refusal.message)
        assertThrows(IOException::class.java) { UpstreamGuardedTree.locate(tree, ancestry) }
        assertEquals(emptyList<String>(), tree.touched)
    }

    @Test
    fun withoutAncestryEveryOperationIsRefusedAndNothingReachesTheProvider() {
        val fake = FakeDocumentTree()
        val file = fake.add(fake.rootId, "f.nls", bytes = byteArrayOf(7))
        val tree = RecordingTree(fake)
        val guarded = UpstreamGuardedTree(tree, null)
        for (operation in listOf<() -> Unit>(
            { guarded.root() },
            { guarded.children(fake.rootId) },
            { guarded.read(file) },
            { guarded.write(file, byteArrayOf(1)) },
            { guarded.rename(file, "g.nls") },
            { guarded.delete(file) },
            { guarded.create(fake.rootId, "x", directory = false) },
        )) {
            assertEquals(UpstreamSyncFolder.UNPLACED, assertThrows(IOException::class.java) { operation() }.message)
        }
        assertEquals(emptyList<String>(), tree.touched)
        assertArrayEquals(byteArrayOf(7), fake.nodes.getValue(file).bytes)
        assertEquals("f.nls", fake.nodes.getValue(file).name)
        assertNull(fake.find(fake.rootId, "x"))
    }

    @Test
    fun aNillaSyncFolderNestedInsideTheUpstreamFolderIsRefusedFromItsAncestry() {
        val fake = FakeDocumentTree()
        fake.nodes.getValue(fake.rootId).name = "Nilla Sync"
        fake.add(fake.rootId, tag, directory = true)
        for (id in listOf("primary:Documents/${UpstreamSyncFolder.NAME}/Nilla Sync", "1234-ABCD:${UpstreamSyncFolder.NAME.uppercase()}./Nilla Sync", "home:${UpstreamSyncFolder.NAME}/Inner/Nilla Sync")) {
            val ancestry = UpstreamSyncFolder.ancestry(UpstreamSyncFolder.EXTERNAL_STORAGE, id)
            assertTrue(id, UpstreamSyncFolder.refusesAncestry(ancestry))
            val tree = RecordingTree(fake)
            val refusal = assertThrows(IOException::class.java) { UpstreamGuardedTree.storage(tree, ancestry, null, "Nilla Sync").names(emptyList()) }
            assertEquals(UpstreamSyncFolder.REFUSAL, refusal.message)
            assertEquals(emptyList<String>(), tree.touched)
        }
        assertTrue(UpstreamSyncFolder.refusesAncestry(UpstreamSyncFolder.ancestry(UpstreamSyncFolder.DOWNLOADS, "raw:/storage/emulated/0/Download/${UpstreamSyncFolder.NAME}/Nilla Sync")))
    }

    @Test
    fun aProviderWithoutPathIdsGivesNoAncestryAndIsRefused() {
        for ((authority, id) in listOf(
            "com.example.cloud.documents" to "root/Documents/Nilla Sync",
            "com.example.cloud.documents" to "primary:Documents/Nilla Sync",
            UpstreamSyncFolder.DOWNLOADS to "msf:42",
            UpstreamSyncFolder.DOWNLOADS to "raw:relative/Nilla Sync",
            UpstreamSyncFolder.EXTERNAL_STORAGE to "Documents/Nilla Sync",
            UpstreamSyncFolder.EXTERNAL_STORAGE to "primary:Documents/../${UpstreamSyncFolder.NAME}/Nilla Sync",
            UpstreamSyncFolder.EXTERNAL_STORAGE to "primary:./Nilla Sync",
            null to "primary:Documents/Nilla Sync",
        )) {
            assertNull("$authority $id", UpstreamSyncFolder.ancestry(authority, id))
            assertTrue(UpstreamSyncFolder.refusesAncestry(UpstreamSyncFolder.ancestry(authority, id)))
        }
        assertNull(UpstreamSyncFolder.ancestry(UpstreamSyncFolder.EXTERNAL_STORAGE, null))
    }

    @Test
    fun aPickIsRefusedFromItsTreeIdAloneWhenItsPlaceIsUnknownOrUpstream() {
        assertEquals(UpstreamSyncFolder.UNPLACED, UpstreamSyncFolder.pickRefusal("com.google.android.apps.docs.storage", "acc=1;doc=encoded=root"))
        assertEquals(UpstreamSyncFolder.UNPLACED, UpstreamSyncFolder.pickRefusal("com.microsoft.skydrive.content.StorageAccessProvider", "1234!56"))
        assertEquals(UpstreamSyncFolder.UNPLACED, UpstreamSyncFolder.pickRefusal(null, "primary:Documents"))
        assertEquals(UpstreamSyncFolder.UNPLACED, UpstreamSyncFolder.pickRefusal(UpstreamSyncFolder.EXTERNAL_STORAGE, null))
        assertEquals(UpstreamSyncFolder.UNPLACED, UpstreamSyncFolder.pickRefusal(UpstreamSyncFolder.EXTERNAL_STORAGE, "primary:Documents/../${UpstreamSyncFolder.NAME}"))
        assertEquals(UpstreamSyncFolder.REFUSAL, UpstreamSyncFolder.pickRefusal(UpstreamSyncFolder.EXTERNAL_STORAGE, "primary:Documents/${UpstreamSyncFolder.NAME}/Nilla Sync"))
        assertEquals(UpstreamSyncFolder.REFUSAL, UpstreamSyncFolder.pickRefusal(UpstreamSyncFolder.EXTERNAL_STORAGE, "primary:Documents/${UpstreamSyncFolder.NAME.lowercase()}. "))
        assertEquals(UpstreamSyncFolder.REFUSAL, UpstreamSyncFolder.pickRefusal(UpstreamSyncFolder.DOWNLOADS, "raw:/storage/emulated/0/Download/${UpstreamSyncFolder.NAME}"))
        assertNull(UpstreamSyncFolder.pickRefusal(UpstreamSyncFolder.EXTERNAL_STORAGE, "primary:Documents/Nilla Sync"))
        assertNull(UpstreamSyncFolder.pickRefusal(UpstreamSyncFolder.DOWNLOADS, "downloads"))
    }

    @Test
    fun aFolderOnThePhonesStorageIsPlacedAndStillSyncs() {
        assertEquals(listOf("Documents", "Nilla Sync"), UpstreamSyncFolder.ancestry(UpstreamSyncFolder.EXTERNAL_STORAGE, "primary:Documents/Nilla Sync"))
        assertEquals(emptyList<String>(), UpstreamSyncFolder.ancestry(UpstreamSyncFolder.EXTERNAL_STORAGE, "primary:"))
        assertEquals(emptyList<String>(), UpstreamSyncFolder.ancestry(UpstreamSyncFolder.DOWNLOADS, "downloads"))
        assertEquals(listOf("storage", "emulated", "0", "Download", "Nilla Sync"), UpstreamSyncFolder.ancestry(UpstreamSyncFolder.DOWNLOADS, "raw:/storage/emulated/0/Download/Nilla Sync"))
        val fake = FakeDocumentTree()
        val sub = fake.add(fake.rootId, "Nilla Sync", directory = true)
        fake.add(sub, tag, directory = true)
        val ancestry = UpstreamSyncFolder.ancestry(UpstreamSyncFolder.EXTERNAL_STORAGE, "primary:Documents")
        assertFalse(UpstreamSyncFolder.refusesAncestry(ancestry))
        assertEquals("Nilla Sync", UpstreamGuardedTree.locate(fake, ancestry))
        val storage = UpstreamGuardedTree.storage(fake, ancestry, "Nilla Sync", "Nilla Sync")
        storage.write(listOf(tag, "f.nls"), byteArrayOf(3))
        assertArrayEquals(byteArrayOf(3), storage.read(listOf(tag, "f.nls")))
    }

    @Test
    fun theGuardedStorageStillReachesTheProvidersCoordination() {
        val fake = FakeDocumentTree()
        val storage = UpstreamGuardedTree.storage(fake, placed, null, "Picked")
        fake.timedOut = true
        assertTrue(storage.timedOut)
        storage.resume()
        assertFalse(fake.timedOut)
        assertFalse(storage.timedOut)
    }
}
