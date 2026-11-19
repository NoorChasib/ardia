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
        val storage = UpstreamGuardedTree.storage(tree, null, "Picked")
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
        assertThrows(IOException::class.java) { UpstreamGuardedTree.storage(tree, "Nilla Sync", "Nilla Sync").names(emptyList()) }
        assertEquals(listOf(fake.rootId), tree.touched)
    }

    @Test
    fun aChildWhoseIdLeadsIntoTheUpstreamFolderIsNeitherProbedNorUsed() {
        val fake = FakeDocumentTree()
        val upstreamChild = place(fake, "primary:Documents/${UpstreamSyncFolder.NAME}/Nilla Sync", fake.rootId, "Nilla Sync", true)
        val chain = place(fake, "$upstreamChild/$tag", upstreamChild, tag, true)
        place(fake, "$chain/f.nls", chain, "f.nls", false, byteArrayOf(7))
        val tree = RecordingTree(fake)
        assertNull(UpstreamGuardedTree.locate(tree))
        val storage = UpstreamGuardedTree.storage(tree, "Nilla Sync", "Nilla Sync")
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
        val storage = UpstreamGuardedTree.storage(tree, "Nilla Sync", "Nilla Sync")
        assertEquals(emptyList<String>(), storage.names(emptyList()))
        assertThrows(IOException::class.java) { storage.read(listOf(tag, "f.nls")) }
        assertTrue(tree.touched.toString(), tree.touched.none { it.startsWith(upstreamChain) || it == named })
    }

    @Test
    fun aSafeTreeStillSyncsThroughTheGuard() {
        val fake = FakeDocumentTree()
        val sub = fake.add(fake.rootId, "Nilla Sync", directory = true)
        fake.add(sub, tag, directory = true)
        assertEquals("Nilla Sync", UpstreamGuardedTree.locate(fake))
        val storage = UpstreamGuardedTree.storage(fake, "Nilla Sync", "Nilla Sync")
        storage.write(listOf(tag, "f.nls"), byteArrayOf(1, 2))
        assertArrayEquals(byteArrayOf(1, 2), storage.read(listOf(tag, "f.nls")))
    }

    @Test
    fun theGuardRefusesUpstreamIdsAndNamesForEveryOperation() {
        val fake = FakeDocumentTree()
        val guarded = UpstreamGuardedTree(fake)
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
    fun theGuardedStorageStillReachesTheProvidersCoordination() {
        val fake = FakeDocumentTree()
        val storage = UpstreamGuardedTree.storage(fake, null, "Picked")
        fake.timedOut = true
        assertTrue(storage.timedOut)
        storage.resume()
        assertFalse(fake.timedOut)
        assertFalse(storage.timedOut)
    }
}
