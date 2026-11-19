package com.nilladigital.nilla.phone

import android.os.Process
import android.os.SystemClock

object ProcessStart {
    fun epochMillis(nowMillis: Long, elapsedNow: Long, startElapsed: Long): Double =
        (nowMillis - (elapsedNow - startElapsed).coerceAtLeast(0L)).toDouble()

    fun epochMillis(): Double = epochMillis(System.currentTimeMillis(), SystemClock.elapsedRealtime(), Process.getStartElapsedRealtime())
}
