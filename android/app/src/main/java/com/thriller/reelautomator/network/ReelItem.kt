package com.thriller.reelautomator.network

data class ReelItem(
    val id: String,
    val url: String,
    val status: String,
    val stage: String,
    val progress: Int,
    val detail: String,
    val createdAt: String,

    // Video metadata
    val width: Int? = null,
    val height: Int? = null,
    val sizeBytes: Long? = null,
    val downloadedAt: String? = null,

    // Instagram / Cloudinary
    val cloudinaryPublicId: String? = null,
    val cloudinaryUrl: String? = null,
    val instagramContainerId: String? = null,
    val instagramMediaId: String? = null,
    val publishedAt: String? = null
)