package com.thriller.reelautomator.network

import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.DELETE
import retrofit2.http.Path

interface ApiService {

    @GET("api/status")
    suspend fun getStatus(): ApiStatus

    @POST("api/reels")
    suspend fun sendReel(
        @Body request: ReelRequest
    ): ReelResponse

    @GET("api/reels")
    suspend fun getReels(): List<ReelItem>

    @DELETE("api/reels/{id}/file")
    suspend fun deleteReelFile(
        @Path("id") id: String
    ): ApiMessage

    @DELETE("api/reels/{id}")
    suspend fun deleteReel(
        @Path("id") id: String
    ): ApiMessage
}