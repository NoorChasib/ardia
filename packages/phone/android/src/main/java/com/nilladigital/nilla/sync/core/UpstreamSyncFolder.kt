package com.nilladigital.nilla.sync.core

import java.io.File
import java.io.IOException
import java.nio.file.Files
import java.nio.file.InvalidPathException
import java.nio.file.Path
import java.text.Normalizer
import java.util.Locale

object UpstreamSyncFolder {
    const val NAME = "Ardia Sync"
    const val REFUSAL = "Nilla keeps its sync data in its own folder and doesn’t open this one"
    const val UNPLACED = "This storage app doesn’t tell Nilla which folders the one you chose is in, so Nilla can’t use it for Nilla Sync. Choose a folder on this phone’s storage instead."
    const val EXTERNAL_STORAGE = "com.android.externalstorage.documents"
    const val DOWNLOADS = "com.android.providers.downloads.documents"
    private const val DOWNLOADS_ROOT = "downloads"
    private const val RAW_PATH = "raw:"

    private val upstream = fold(NAME)

    fun fold(part: String): String = Normalizer.normalize(part, Normalizer.Form.NFC).trim().trimEnd('.', ' ').lowercase(Locale.ROOT)

    fun isUpstreamName(part: String?): Boolean = part != null && fold(part) == upstream

    fun refuses(folder: File): Boolean {
        val absolute = folder.absoluteFile
        if (namesUpstream(absolute.path)) return true
        val real = realPath(absolute) ?: return true
        return namesUpstream(real)
    }

    fun ancestry(authority: String?, documentId: String?): List<String>? {
        if (authority == null || documentId == null) return null
        return when (authority) {
            EXTERNAL_STORAGE -> documentId.indexOf(':').takeIf { it > 0 }?.let { pathParts(documentId.substring(it + 1)) }
            DOWNLOADS -> when {
                documentId == DOWNLOADS_ROOT -> emptyList()
                documentId.startsWith("$RAW_PATH/") -> pathParts(documentId.removePrefix(RAW_PATH))
                else -> null
            }
            else -> null
        }
    }

    fun refusesAncestry(ancestry: List<String>?): Boolean = ancestryRefusal(ancestry) != null

    fun pickRefusal(authority: String?, treeDocumentId: String?): String? =
        ancestryRefusal(ancestry(authority, treeDocumentId)) ?: REFUSAL.takeIf { refusesDocument(treeDocumentId) }

    fun ancestryRefusal(ancestry: List<String>?): String? = when {
        ancestry == null -> UNPLACED
        ancestry.any(::isUpstreamName) -> REFUSAL
        else -> null
    }

    private fun pathParts(path: String): List<String>? {
        val parts = path.split('/').filter { it.isNotEmpty() }
        return if (parts.any { it == "." || it == ".." }) null else parts
    }

    fun refusesDocument(documentId: String?): Boolean = documentId != null && namesUpstream(documentId.substringAfter(':', ""))

    private fun namesUpstream(path: String): Boolean = path.split('/', '\\').any(::isUpstreamName)

    private fun realPath(file: File): String? {
        return try {
            var existing: Path? = file.toPath()
            val missing = ArrayDeque<Path>()
            while (existing != null && !Files.exists(existing)) {
                if (Files.isSymbolicLink(existing)) return null
                missing.addFirst(existing.fileName)
                existing = existing.parent
            }
            if (existing == null) null else missing.fold(existing.toRealPath()) { at, part -> at.resolve(part) }.toString()
        } catch (error: IOException) {
            null
        } catch (error: InvalidPathException) {
            null
        } catch (error: SecurityException) {
            null
        }
    }
}
