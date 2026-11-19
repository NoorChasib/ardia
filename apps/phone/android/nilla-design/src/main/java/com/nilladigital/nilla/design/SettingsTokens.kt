package com.nilladigital.nilla.design

import androidx.compose.ui.unit.dp

object SettingsTile {
    val side = 29.dp
    val heroSide = 64.dp
}

object SettingsTint {
    val neutral = nillaColor(0x86888D)
    val red = nillaColor(0xFF5A5F)
    val orange = nillaColor(0xFF901A)
    val yellow = nillaColor(0xFFC829)
    val blue = nillaColor(0x458AFF)
    val deepBlue = nillaColor(0x007AFF)
    val purple = nillaColor(0xB059EE)
    val green = nillaColor(0x3EA82E)

    val sync = blue
    val ads = red
    val trackers = yellow
    val cookies = orange
    val search = deepBlue
    val archive = purple
    val keyboard = yellow
    val swipe = blue
    val nightShade = nillaColor(0x5856D6)
    val appLinks = green
    val bottomBar = nillaColor(0x30B0C7)
    val defaultBrowser = deepBlue
    val clearData = red
    val export = nillaColor(0x0153FF)
    val onboarding = orange
}

object MenuLayout {
    val sheetRadius = 38.dp
    val inset = 16.dp
    val innerRadius = sheetRadius - inset
    val capsuleHeight = innerRadius * 2
    val tileHeight = 68.dp
    val rowHeight = 50.dp
}

object NillaColors {
    val accentText = Palette.formAccent
    val title = SystemPalette.label
}
