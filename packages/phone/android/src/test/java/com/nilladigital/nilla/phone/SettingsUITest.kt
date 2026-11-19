package com.nilladigital.nilla.phone

import androidx.compose.foundation.shape.CircleShape
import com.nilladigital.nilla.design.NillaSymbols
import com.nilladigital.nilla.design.ProfileLook
import com.nilladigital.nilla.design.SettingsTint
import com.nilladigital.nilla.design.SetupStepProgress
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotSame
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

class SettingsUITest {
    private val tintsTheJavaScriptNames = listOf(
        "neutral", "red", "orange", "yellow", "blue", "deepBlue", "purple", "green",
        "sync", "ads", "trackers", "cookies", "search", "archive", "keyboard", "swipe", "nightShade",
        "appLinks", "bottomBar", "defaultBrowser", "clearData", "export", "onboarding", "swatch",
    )

    private val symbolsMainsSettingsUse = listOf(
        "macbook.and.iphone", "paintpalette.fill", "globe", "safari.fill", "magnifyingglass", "text.magnifyingglass",
        "keyboard.fill", "archivebox.fill", "arrow.up.forward.app.fill", "eraser.fill", "square.and.arrow.up.fill",
        "hand.wave.fill", "info", "hand.raised.fill", "eyeglasses", "list.bullet.rectangle.portrait.fill",
        "line.3.horizontal.decrease", "checkmark.shield.fill", "moon.fill", "hand.draw.fill",
        "platter.filled.bottom.and.arrow.down.iphone", "macbook",
    )

    @Test
    fun everyTintTheJavaScriptCanNameHasAColourOnAndroid() {
        assertEquals(tintsTheJavaScriptNames.toSet(), SettingsTints.names)
        val look = ProfileLook.of(ProfileLook.Preset.fromKey("green")!!)
        assertEquals("swatch follows the look", look.swatchColor, SettingsTints.color("swatch", look))
        assertEquals(SettingsTint.nightShade, SettingsTints.color("nightShade", look))
        assertEquals("an unknown name falls back to neutral", SettingsTint.neutral, SettingsTints.color("chartreuse", look))
    }

    @Test
    fun everySymbolMainsSettingsUseIsDrawnRatherThanTheFallback() {
        val fallback = NillaSymbols.gearshape
        val missing = symbolsMainsSettingsUse.filter { SettingsSymbols.vector(it) === fallback }
        assertTrue("drawn by the gear fallback: $missing", missing.isEmpty())
        assertSame(NillaSymbols.handWaveFill, SettingsSymbols.vector("hand.wave.fill"))
        assertSame(NillaSymbols.line3HorizontalDecrease, SettingsSymbols.vector("line.3.horizontal.decrease"))
        assertSame("an unknown name draws the gear", fallback, SettingsSymbols.vector("no.such.symbol"))
        assertNotSame(fallback, SettingsSymbols.vector("globe"))
    }

    @Test
    fun theStepsProgressAndTheSurfacesShapeReadTheJavaScriptsWords() {
        assertEquals(SetupStepProgress.Done, SettingsSteps.progress("done"))
        assertEquals(SetupStepProgress.Current, SettingsSteps.progress("current"))
        assertEquals(SetupStepProgress.Upcoming, SettingsSteps.progress("upcoming"))
        assertEquals(SetupStepProgress.Upcoming, SettingsSteps.progress("anything else"))
        assertSame(CircleShape, SettingsSurfaces.shape("circle", 0.0))
    }

    @Test
    fun theModifiersRegisteredAreTheOnesTheJavaScriptCreates() {
        assertEquals(
            listOf("nilla.navigationBarBackButtonHidden", "nilla.minListRowHeight", "nilla.spaceBackdrop", "nilla.settingsChrome", "nilla.settingsPage", "nilla.chromeSurface", "nilla.settingsSwitchStyle", "nilla.pressableStyle", "nilla.legibleInk", "nilla.profileLook", "nilla.contentMargins"),
            SettingsUIModifiers.names,
        )
    }
}
