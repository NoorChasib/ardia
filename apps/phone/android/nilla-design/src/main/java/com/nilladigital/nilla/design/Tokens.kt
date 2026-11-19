package com.nilladigital.nilla.design

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp

object Palette {
    val accent = adaptive(nillaColor(0x6395FC), nillaColor(0x4A77D4))
    val formAccent = adaptive(nillaColor(0x007AFF), nillaColor(0x0A84FF))
    val primaryAction = adaptive(nillaColor(0x0F182C), nillaColor(0xDCCBD8))
    val onPrimaryAction = adaptive(Color.White, Color.Black)
    val success = adaptive(nillaColor(0x34C759), nillaColor(0x30D158))
    val panel = adaptive(Color.White, nillaColor(0x2A2A2A))
    val panelBorder = adaptive(Color.Black.copy(alpha = 0.1f), Color.White.copy(alpha = 0.1f))
    val toast = adaptive(Color.White.copy(alpha = 0.92f), nillaColor(0x2C2A2B, 0.9f))
    val toastShadow = adaptive(Color.Black.copy(alpha = 0.18f), Color.Black.copy(alpha = 0.5f))
}

object Spacing {
    val hairline = 4.dp
    val tight = 8.dp
    val small = 12.dp
    val page = 16.dp
    val medium = 20.dp
    val large = 24.dp
    val section = 32.dp
}

object Radius {
    val field = 16.dp
    val card = 20.dp
    val sheet = 32.dp
}

object Layout {
    const val swipeParallax = -0.33f
    val swipeCommit = 75.dp
    val swipeFlickCommit = 50.dp
}

object SystemPalette {
    val label = adaptive(nillaColor(0x000000), nillaColor(0xFFFFFF))
    val secondaryLabel = adaptive(nillaColor(0x3C3C43, 0.6f), nillaColor(0xEBEBF5, 0.6f))
    val tertiaryLabel = adaptive(nillaColor(0x3C3C43, 0.3f), nillaColor(0xEBEBF5, 0.3f))
    val separator = adaptive(nillaColor(0x3C3C43, 0.29f), nillaColor(0x545458, 0.6f))
    val tertiaryFill = adaptive(nillaColor(0x767680, 0.12f), nillaColor(0x767680, 0.24f))
    val background = adaptive(nillaColor(0xFFFFFF), nillaColor(0x000000))
    val secondaryBackground = adaptive(nillaColor(0xF2F2F7), nillaColor(0x1C1C1E))
    val groupedBackground = adaptive(nillaColor(0xF2F2F7), nillaColor(0x000000))
    val secondaryGroupedBackground = adaptive(nillaColor(0xFFFFFF), nillaColor(0x1C1C1E))
    val green = adaptive(nillaColor(0x34C759), nillaColor(0x30D158))
    val red = adaptive(nillaColor(0xFF3B30), nillaColor(0xFF453A))
}
