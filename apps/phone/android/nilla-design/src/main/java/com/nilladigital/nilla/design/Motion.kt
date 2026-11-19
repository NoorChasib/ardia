package com.nilladigital.nilla.design

import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.Easing
import androidx.compose.animation.core.FiniteAnimationSpec
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.runtime.Immutable
import kotlin.math.PI
import kotlin.math.pow
import kotlin.math.sqrt

object SwiftEasing {
    val easeOut: Easing = CubicBezierEasing(0f, 0f, 0.58f, 1f)
    val easeIn: Easing = CubicBezierEasing(0.42f, 0f, 1f, 1f)
    val easeInOut: Easing = CubicBezierEasing(0.42f, 0f, 0.58f, 1f)
    val linear: Easing = LinearEasing
    val logoSpin: Easing = CubicBezierEasing(0.12f, 0.7f, 0.25f, 1f)
}

@Immutable
sealed interface NillaMotion {
    fun <T> spec(visibilityThreshold: T? = null): FiniteAnimationSpec<T>
}

@Immutable
data class NillaSpring(val response: Float, val dampingFraction: Float) : NillaMotion {
    val stiffness: Float get() = (2.0 * PI / response).pow(2).toFloat()

    val dampingRatio: Float get() = dampingFraction

    val damping: Float get() = (2.0 * dampingFraction * sqrt(stiffness.toDouble())).toFloat()

    override fun <T> spec(visibilityThreshold: T?): FiniteAnimationSpec<T> =
        spring(dampingRatio = dampingRatio, stiffness = stiffness, visibilityThreshold = visibilityThreshold)

    companion object {
        fun withBounce(duration: Float, bounce: Float): NillaSpring =
            NillaSpring(response = duration, dampingFraction = if (bounce >= 0f) 1f - bounce else 1f / (1f + bounce))
    }
}

@Immutable
data class NillaTween(val durationMillis: Int, val easing: Easing, val delayMillis: Int = 0) : NillaMotion {
    override fun <T> spec(visibilityThreshold: T?): FiniteAnimationSpec<T> =
        tween(durationMillis = durationMillis, delayMillis = delayMillis, easing = easing)
}

object Motion {
    val snappy = NillaSpring(response = 0.3f, dampingFraction = 0.86f)
    val smooth = NillaSpring(response = 0.42f, dampingFraction = 0.9f)
    val tabStack = NillaSpring.withBounce(duration = 0.4f, bounce = 0.2f)
    val modeToggle = NillaSpring.withBounce(duration = 0.3f, bounce = 0.15f)

    val searchRise = NillaSpring(response = 0.39f, dampingFraction = 1f)
    val surfaceSwap = NillaTween(300, SwiftEasing.easeOut)
    val surfaceFade = NillaTween(200, SwiftEasing.easeOut)
    val trayDim = NillaTween(300, SwiftEasing.easeInOut)
    val trayDismiss = NillaSpring(response = 0.32f, dampingFraction = 1f)
    val traySettle = NillaSpring(response = 0.34f, dampingFraction = 0.86f)
    val resultsIn = NillaTween(140, SwiftEasing.easeOut)
    val pager = NillaSpring(response = 0.3f, dampingFraction = 0.9f)
    val press = NillaSpring(response = 0.2f, dampingFraction = 0.7f)
    val barPressIn = NillaSpring.withBounce(duration = 0.08f, bounce = 0f)
    val barPressOut = NillaSpring.withBounce(duration = 0.16f, bounce = 0.1f)
    val barCollapse = NillaSpring.withBounce(duration = 0.4f, bounce = 0f)
    val progressReveal = NillaTween(200, SwiftEasing.easeOut)
    val progressAdvance = NillaTween(450, SwiftEasing.easeOut)
    val progressFill = NillaTween(200, SwiftEasing.easeOut)
    val progressFade = NillaTween(250, SwiftEasing.easeOut)
    const val progressRevealDelayMillis = 150L
    const val placeholderDelayMillis = 300L
    val placeholderIn = NillaTween(220, SwiftEasing.easeOut)
    val pagerSettle = NillaSpring.withBounce(duration = 0.38f, bounce = 0f)
    val pagerFade = NillaTween(200, SwiftEasing.easeOut)
    val barTone = NillaTween(250, SwiftEasing.easeOut)
    val logoSpin = NillaTween(2200, SwiftEasing.logoSpin)
    val reducedFade = NillaTween(200, SwiftEasing.easeInOut)
    val reducedSettle = NillaTween(200, SwiftEasing.easeOut)
    val logoReset = NillaTween(300, SwiftEasing.easeOut)
}
