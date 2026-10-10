package com.thriller.reelautomator.network

data class ReelResponse(
    val success: Boolean,
    val message: String,
    val reel: ReelItem
)