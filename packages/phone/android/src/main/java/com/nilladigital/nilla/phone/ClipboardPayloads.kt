package com.nilladigital.nilla.phone

import android.content.Context
import com.nilladigital.nilla.search.ClipboardOffer
import com.nilladigital.nilla.search.ClipboardOffers

object ClipboardPayloads {
    fun offer(context: Context): String? = when (ClipboardOffers.peek(context)) {
        ClipboardOffer.Link -> "link"
        ClipboardOffer.Text -> "text"
        null -> null
    }
}
