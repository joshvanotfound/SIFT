package com.thriller.reelautomator.repository

import com.thriller.reelautomator.network.ApiMessage
import com.thriller.reelautomator.network.ApiStatus
import com.thriller.reelautomator.network.ReelItem
import com.thriller.reelautomator.network.ReelRequest
import com.thriller.reelautomator.network.ReelResponse
import com.thriller.reelautomator.network.RetrofitClient

class ReelRepository {

    suspend fun getStatus(): ApiStatus {
        return RetrofitClient.api.getStatus()
    }

    suspend fun sendReel(url: String): ReelResponse {
        return RetrofitClient.api.sendReel(
            ReelRequest(url)
        )
    }

    suspend fun getReels(): List<ReelItem> {
        return RetrofitClient.api.getReels()
    }

    suspend fun deleteReelFile(id: String): ApiMessage {
        return RetrofitClient.api.deleteReelFile(id)
    }

    suspend fun deleteReel(id: String): ApiMessage {
        return RetrofitClient.api.deleteReel(id)
    }
}