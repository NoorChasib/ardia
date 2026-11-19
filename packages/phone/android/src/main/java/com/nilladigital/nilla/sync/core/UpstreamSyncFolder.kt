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
    const val REFUSAL = "Nilla keeps its sync data apart from Ardia’s and doesn’t open the Ardia Sync folder"

    private val upstream = fold(NAME)

    fun fold(part: String): String = Normalizer.normalize(part, Normalizer.Form.NFC).trim().trimEnd('.', ' ').lowercase(Locale.ROOT)

    fun isUpstreamName(part: String?): Boolean = part != null && fold(part) == upstream

    fun refuses(folder: File): Boolean {
        val absolute = folder.absoluteFile
        if (namesUpstream(absolute.path)) return true
        val real = realPath(absolute) ?: return true
        return namesUpstream(real)
    }

    fun refusesDocument(documentId: String?): Boolean = documentId != null && namesUpstream(documentId.substringAfter(':', ""))

    private fun namesUpstream(path: String): Boolean = path.split('/', '\\').any(::isUpstreamName)

    private fun realPath(file: File): String? = try {
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
