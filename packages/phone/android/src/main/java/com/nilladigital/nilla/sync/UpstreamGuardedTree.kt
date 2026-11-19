package com.nilladigital.nilla.sync

import com.nilladigital.nilla.sync.core.UpstreamSyncFolder
import java.io.IOException

class UpstreamGuardedTree(private val inner: DocumentTree) : DocumentTree, CoordinatedStorage {
    private val coordination = inner as? CoordinatedStorage

    override val rootId: String get() = inner.rootId

    override val timedOut: Boolean get() = coordination?.timedOut ?: false

    override fun resume() {
        coordination?.resume()
    }

    override fun cancelAll() {
        coordination?.cancelAll()
    }

    override fun root(): DocumentEntry {
        refuseId(inner.rootId)
        return admitted(inner.root())
    }

    override fun children(parentId: String): List<DocumentEntry> {
        if (parentId == inner.rootId) root() else refuseId(parentId)
        return inner.children(parentId).filterNot(::isUpstream)
    }

    override fun create(parentId: String, name: String, directory: Boolean): DocumentEntry {
        refuseId(parentId)
        refuseName(name)
        return admitted(inner.create(parentId, name, directory))
    }

    override fun rename(id: String, name: String): DocumentEntry {
        refuseId(id)
        refuseName(name)
        return admitted(inner.rename(id, name))
    }

    override fun delete(id: String) {
        refuseId(id)
        inner.delete(id)
    }

    override fun read(id: String): ByteArray {
        refuseId(id)
        return inner.read(id)
    }

    override fun write(id: String, bytes: ByteArray) {
        refuseId(id)
        inner.write(id, bytes)
    }

    private fun admitted(entry: DocumentEntry): DocumentEntry {
        if (isUpstream(entry)) throw IOException(UpstreamSyncFolder.REFUSAL)
        return entry
    }

    private fun refuseId(id: String) {
        if (UpstreamSyncFolder.refusesDocument(id)) throw IOException(UpstreamSyncFolder.REFUSAL)
    }

    private fun refuseName(name: String) {
        if (UpstreamSyncFolder.isUpstreamName(name)) throw IOException(UpstreamSyncFolder.REFUSAL)
    }

    companion object {
        fun isUpstream(entry: DocumentEntry): Boolean =
            UpstreamSyncFolder.isUpstreamName(entry.name) || UpstreamSyncFolder.refusesDocument(entry.id)

        fun storage(tree: DocumentTree, subfolder: String?, name: String): DocumentTreeStorage =
            DocumentTreeStorage(UpstreamGuardedTree(tree), subfolder, name)

        fun locate(tree: DocumentTree): String? = DocumentTreeStorage.locate(UpstreamGuardedTree(tree))
    }
}
