#!/system/bin/sh
P=com.nilladigital.nilla.android
dumpsys gfxinfo $P reset >/dev/null; date -u +%FT%TZ; sleep $1; dumpsys gfxinfo $P; date -u +%FT%TZ
