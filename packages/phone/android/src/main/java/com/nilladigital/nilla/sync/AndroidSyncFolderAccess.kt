package com.nilladigital.nilla.sync

import android.content.ContentResolver
import android.content.Intent
import android.net.Uri
import android.provider.DocumentsContract
import com.nilladigital.nilla.sync.core.UpstreamSyncFolder

open class AndroidSyncFolderAccess(
    protected val resolver: ContentResolver,
    protected val timeoutMs: Long = ResolverDocumentTree.DEFAULT_TIMEOUT_MS,
) : LocalFolderAccess() {
    override fun open(pick: SyncFolderPick): SyncFolderGrant? {
        val tree = (pick as? SyncFolderPick.Tree)?.let { tree(it.treeUri) } ?: return super.open(pick)
        val ancestry = ancestry(tree)
        if (UpstreamSyncFolder.refusesAncestry(ancestry)) return null
        return try {
            val root = UpstreamGuardedTree(tree, ancestry).root()
            val subfolder = UpstreamGuardedTree.locate(tree, ancestry)
            val name = subfolder ?: root.name
            val location = SyncFolderLocation.Tree(pick.treeUri, subfolder, name)
            SyncFolderGrant(UpstreamGuardedTree.storage(tree, ancestry, subfolder, name), location)
        } catch (error: Exception) {
            null
        }
    }

    override fun refusal(pick: SyncFolderPick): String? {
        val tree = (pick as? SyncFolderPick.Tree)?.let { tree(it.treeUri) } ?: return super.refusal(pick)
        return UpstreamSyncFolder.ancestryRefusal(ancestry(tree))
    }

    override fun resolve(location: SyncFolderLocation): SyncFolderGrant? {
        if (location !is SyncFolderLocation.Tree) return super.resolve(location)
        val tree = tree(location.treeUri) ?: return null
        val ancestry = ancestry(tree)
        if (UpstreamSyncFolder.refusesAncestry(ancestry) || UpstreamSyncFolder.refusesDocument(tree.rootId) || UpstreamSyncFolder.isUpstreamName(location.name) || UpstreamSyncFolder.isUpstreamName(location.subfolder)) return null
        if (!tree.hasPersistedAccess()) return null
        return SyncFolderGrant(UpstreamGuardedTree.storage(tree, ancestry, location.subfolder, location.name), location)
    }

    override fun hasAccess(location: SyncFolderLocation): Boolean {
        if (location !is SyncFolderLocation.Tree) return super.hasAccess(location)
        return tree(location.treeUri)?.hasPersistedAccess() == true
    }

    override fun keep(location: SyncFolderLocation): Boolean {
        if (location !is SyncFolderLocation.Tree) return super.keep(location)
        if (pickRefusal(location.treeUri) != null) return false
        return try {
            resolver.takePersistableUriPermission(Uri.parse(location.treeUri), READ_AND_WRITE)
            true
        } catch (error: SecurityException) {
            false
        }
    }

    override fun release(location: SyncFolderLocation, keeping: SyncFolderLocation?) {
        if (location !is SyncFolderLocation.Tree) return
        if ((keeping as? SyncFolderLocation.Tree)?.treeUri == location.treeUri) return
        try {
            resolver.releasePersistableUriPermission(Uri.parse(location.treeUri), READ_AND_WRITE)
        } catch (error: SecurityException) {
        }
    }

    protected open fun ancestry(tree: ResolverDocumentTree): List<String>? = UpstreamSyncFolder.ancestry(tree.treeUri.authority, tree.rootId)

    private fun tree(uri: String): ResolverDocumentTree? = try {
        ResolverDocumentTree(resolver, Uri.parse(uri), timeoutMs)
    } catch (error: IllegalArgumentException) {
        null
    }

    companion object {
        const val READ_AND_WRITE = Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION

        fun pickRefusal(treeUri: String): String? = try {
            val uri = Uri.parse(treeUri)
            UpstreamSyncFolder.pickRefusal(uri.authority, DocumentsContract.getTreeDocumentId(uri))
        } catch (error: RuntimeException) {
            UpstreamSyncFolder.UNPLACED
        }
    }
}
