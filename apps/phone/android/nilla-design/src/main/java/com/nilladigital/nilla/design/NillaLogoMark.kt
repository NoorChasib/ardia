package com.nilladigital.nilla.design

import androidx.compose.animation.core.Animatable
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.dropShadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.foundation.shape.GenericShape
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathOperation
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.asAndroidPath
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.clipPath
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.shadow.Shadow
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.DpOffset
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.min

object LogoGeometry {
    val canvas = Rect(100f, 260f, 924f, 924f)
    val aspectRatio: Float get() = canvas.width / canvas.height
    private const val FRAME_CENTER = 512f

    class LogoShape(val path: Path, val color: Color)

    val sunColor: Color = nillaColor(0xF2C14E)

    val sun: Path by lazy { Path().apply { addOval(Rect(222f, 260f, 446f, 484f)) } }

    val backHill: Path by lazy {
        Path().apply {
            moveTo(100f, 700f)
            cubicTo(320f, 640f, 560f, 610f, 924f, 560f)
            lineTo(924f, 924f)
            lineTo(100f, 924f)
            close()
        }
    }

    val frontHill: Path by lazy {
        Path().apply {
            moveTo(100f, 812f)
            cubicTo(380f, 760f, 650f, 600f, 924f, 338f)
            lineTo(924f, 924f)
            lineTo(100f, 924f)
            close()
        }
    }

    val hills: List<LogoShape> by lazy {
        listOf(
            LogoShape(backHill, nillaColor(0x8A9F6A)),
            LogoShape(frontHill, nillaColor(0x43506E)),
        )
    }

    fun frame(scale: Float = 1f): Path {
        fun at(value: Float) = FRAME_CENTER + (value - FRAME_CENTER) * scale
        return Path().apply {
            moveTo(at(360f), at(100f))
            lineTo(at(664f), at(100f))
            cubicTo(at(861.3f), at(100f), at(924f), at(162.7f), at(924f), at(360f))
            lineTo(at(924f), at(664f))
            cubicTo(at(924f), at(861.3f), at(861.3f), at(924f), at(664f), at(924f))
            lineTo(at(360f), at(924f))
            cubicTo(at(162.7f), at(924f), at(100f), at(861.3f), at(100f), at(664f))
            lineTo(at(100f), at(360f))
            cubicTo(at(100f), at(162.7f), at(162.7f), at(100f), at(360f), at(100f))
            close()
        }
    }

    val hillFrame: Path by lazy { frame() }

    internal fun fit(size: Size, inset: Float): Pair<Float, Offset> {
        val scale = min((size.width - inset * 2) / canvas.width, (size.height - inset * 2) / canvas.height)
        return scale to Offset(inset - canvas.left * scale, inset - canvas.top * scale)
    }

    private val silhouettePaths: List<Path> by lazy {
        listOf(sun) + hills.map { Path.combine(PathOperation.Intersect, it.path, hillFrame) }
    }

    internal val silhouette = GenericShape { size, _ ->
        val (scale, origin) = fit(size, 1f)
        for (shape in silhouettePaths) {
            val copy = Path().apply { addPath(shape) }
            copy.asAndroidPath().transform(android.graphics.Matrix().apply {
                setScale(scale, scale)
                postTranslate(origin.x, origin.y)
            })
            addPath(copy)
        }
    }
}

@Composable
fun NillaLogoMark(modifier: Modifier = Modifier, outline: Boolean = true, outlineWeight: Float = 0.075f) {
    Canvas(modifier.aspectRatio(LogoGeometry.aspectRatio).clearAndSetSemantics {}) { drawLogo(outline, outlineWeight) }
}

internal fun DrawScope.drawLogo(outline: Boolean, outlineWeight: Float) {
    val strokeWidth = if (outline) size.width * outlineWeight else 0f
    val inset = strokeWidth / 2 + 1.dp.toPx()
    val (scale, origin) = LogoGeometry.fit(size, inset)
    translate(origin.x, origin.y) {
        scale(scale, scale, pivot = Offset.Zero) {
            if (outline) {
                val width = strokeWidth / scale
                val stroke = Stroke(width = width, cap = StrokeCap.Round, join = StrokeJoin.Round)
                drawPath(LogoGeometry.sun, Color.White, style = stroke)
                drawPath(LogoGeometry.sun, Color.White)
                clipPath(LogoGeometry.frame(1f + width / LogoGeometry.canvas.width)) {
                    for (hill in LogoGeometry.hills) {
                        drawPath(hill.path, Color.White, style = stroke)
                        drawPath(hill.path, Color.White)
                    }
                }
            }
            drawPath(LogoGeometry.sun, LogoGeometry.sunColor)
            clipPath(LogoGeometry.hillFrame) {
                for (hill in LogoGeometry.hills) drawPath(hill.path, hill.color)
            }
        }
    }
}

@Composable
fun FidgetLogo(modifier: Modifier = Modifier, contentDescription: String = "Nilla") {
    val reduceMotion = LocalReduceMotion.current
    val haptics = LocalHapticFeedback.current
    val scope = rememberCoroutineScope()
    val angle = remember { Animatable(0f) }
    Box(
        modifier
            .semantics {
                this.contentDescription = contentDescription
                role = Role.Image
            }
            .pointerInput(reduceMotion) {
                var dragStart = 0f
                var startBearing = 0f
                var lastAngle = 0f
                var lastTime = 0L
                var velocity = 0f
                detectDragGestures(
                    onDragStart = { position ->
                        scope.launch { angle.stop() }
                        dragStart = angle.value
                        startBearing = bearing(position, Offset(size.width / 2f, size.height / 2f))
                        lastAngle = dragStart
                        lastTime = 0L
                        velocity = 0f
                    },
                    onDrag = { change, _ ->
                        val now = bearing(change.position, Offset(size.width / 2f, size.height / 2f))
                        var delta = now - startBearing
                        if (delta > 180f) delta -= 360f
                        if (delta < -180f) delta += 360f
                        val target = dragStart + delta
                        val time = change.uptimeMillis
                        if (lastTime != 0L) {
                            val elapsed = (time - lastTime) / 1000f
                            if (elapsed > 0.004f) velocity = (target - lastAngle) / elapsed
                        }
                        lastAngle = target
                        lastTime = time
                        scope.launch { angle.snapTo(target) }
                        change.consume()
                    },
                    onDragEnd = {
                        val clamped = velocity.coerceIn(-2400f, 2400f)
                        velocity = 0f
                        if (abs(clamped) <= 60f) return@detectDragGestures
                        if (reduceMotion) {
                            scope.launch { angle.animateTo(0f, Motion.logoReset.spec()) }
                            return@detectDragGestures
                        }
                        val travel = clamped * 0.42f
                        if (abs(travel) >= 360f) haptics.performHapticFeedback(HapticFeedbackType.ContextClick)
                        scope.launch { angle.animateTo(angle.value + travel, Motion.logoSpin.spec()) }
                    },
                )
            },
        contentAlignment = Alignment.Center,
    ) {
        Box(
            Modifier
                .fillMaxSize()
                .graphicsLayer { rotationZ = angle.value },
            contentAlignment = Alignment.Center,
        ) {
            Canvas(
                Modifier
                    .aspectRatio(LogoGeometry.aspectRatio)
                    .dropShadow(LogoGeometry.silhouette, Shadow(radius = 14.dp, color = Color.Black.copy(alpha = 0.22f), offset = DpOffset(0.dp, 6.dp))),
            ) { drawLogo(outline = true, outlineWeight = 0.05f) }
        }
    }
}

private fun bearing(point: Offset, center: Offset): Float =
    (atan2(point.y - center.y, point.x - center.x) * 180.0 / PI).toFloat()
