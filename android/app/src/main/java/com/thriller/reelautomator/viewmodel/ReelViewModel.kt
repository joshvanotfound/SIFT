package com.thriller.reelautomator.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.thriller.reelautomator.network.ReelItem
import com.thriller.reelautomator.network.WebSocketClient
import com.thriller.reelautomator.repository.ReelRepository
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import org.json.JSONObject

class ReelViewModel : ViewModel() {

    private val repository =
        ReelRepository()

    private val webSocketClient =
        WebSocketClient()


    // ==========================================
    // SERVER STATUS
    // ==========================================

    private val _status =
        MutableStateFlow(
            "Connecting to PC..."
        )

    val status:
            StateFlow<String> =
        _status


    // ==========================================
    // REELS
    // ==========================================

    private val _reels =
        MutableStateFlow<List<ReelItem>>(
            emptyList()
        )

    val reels:
            StateFlow<List<ReelItem>> =
        _reels


    // ==========================================
    // INITIALIZATION
    // ==========================================

    init {

        startAutoRefresh()

        connectWebSocket()
    }


    // ==========================================
    // SERVER STATUS
    // ==========================================

    fun checkServerStatus() {

        viewModelScope.launch {

            try {

                val response =
                    repository.getStatus()


                _status.value =
                    "${response.status}\n${response.service}"


            } catch (e: Exception) {

                _status.value =
                    "Connection failed"
            }
        }
    }


    // ==========================================
    // SEND REEL
    // ==========================================

    fun sendReel(
        url: String
    ) {

        viewModelScope.launch {

            try {

                val response =
                    repository.sendReel(
                        url
                    )


                _status.value =
                    response.message


                loadReels()


            } catch (e: Exception) {

                _status.value =
                    "Failed to send reel"
            }
        }
    }


    // ==========================================
    // LOAD REELS
    // ==========================================

    fun loadReels() {

        viewModelScope.launch {

            try {

                _reels.value =
                    repository.getReels()


            } catch (e: Exception) {

                _status.value =
                    "Connection failed"
            }
        }
    }


    // ==========================================
    // WEBSOCKET CONNECTION
    // ==========================================

    private fun connectWebSocket() {

        webSocketClient.connect { message ->

            viewModelScope.launch {

                handleWebSocketMessage(
                    message
                )
            }
        }
    }


    // ==========================================
    // WEBSOCKET MESSAGE
    // ==========================================

    private fun handleWebSocketMessage(
        message: String
    ) {

        try {

            val json =
                JSONObject(
                    message
                )


            val type =
                json.optString(
                    "type"
                )


            // ==================================
            // REEL UPDATE
            // ==================================

            if (
                type ==
                "reel_update"
            ) {

                val id =
                    json.optString(
                        "id"
                    )


                if (id.isEmpty()) {
                    return
                }


                val stage =
                    json.optString(
                        "stage"
                    )


                val status =
                    json.optString(
                        "status"
                    )


                val progress =
                    json.optInt(
                        "progress"
                    )


                val detail =
                    json.optString(
                        "detail"
                    )


                val currentReels =
                    _reels.value.toMutableList()


                val index =
                    currentReels.indexOfFirst {

                        it.id == id

                    }


                /*
                ----------------------------------
                Reel doesn't exist locally yet.
                ----------------------------------
                */

                if (
                    index == -1
                ) {

                    loadReels()

                    return
                }


                val oldReel =
                    currentReels[index]


                /*
                ----------------------------------
                Update only live fields.

                Everything else is preserved.
                ----------------------------------
                */

                currentReels[index] =
                    oldReel.copy(

                        status =
                            if (
                                status.isNotEmpty()
                            ) {
                                status
                            } else {
                                oldReel.status
                            },


                        stage =
                            if (
                                stage.isNotEmpty()
                            ) {
                                stage
                            } else {
                                oldReel.stage
                            },


                        progress =
                            if (
                                json.has(
                                    "progress"
                                )
                            ) {
                                progress
                            } else {
                                oldReel.progress
                            },


                        detail =
                            if (
                                detail.isNotEmpty()
                            ) {
                                detail
                            } else {
                                oldReel.detail
                            }
                    )


                _reels.value =
                    currentReels
            }


            // ==================================
            // REEL REMOVED
            // ==================================

            else if (
                type ==
                "reel_removed"
            ) {

                val id =
                    json.optString(
                        "id"
                    )


                if (
                    id.isEmpty()
                ) {
                    return
                }


                _reels.value =
                    _reels.value.filter {

                        it.id != id

                    }
            }


            // ==================================
            // WEBSOCKET CONNECTION
            // ==================================

            else if (
                type ==
                "connection"
            ) {

                loadReels()
            }


        } catch (e: Exception) {

            println(
                "Failed to process WebSocket message: ${e.message}"
            )
        }
    }


    // ==========================================
    // AUTO REFRESH
    // ==========================================

    private fun startAutoRefresh() {

        viewModelScope.launch {

            while (
                isActive
            ) {

                try {

                    /*
                    ------------------------------
                    Server status
                    ------------------------------
                    */

                    val statusResponse =
                        repository.getStatus()


                    _status.value =
                        "${statusResponse.status}\n${statusResponse.service}"


                    /*
                    ------------------------------
                    Queue
                    ------------------------------
                    */

                    _reels.value =
                        repository.getReels()


                } catch (e: Exception) {

                    _status.value =
                        "Connection failed"
                }


                delay(
                    2000
                )
            }
        }
    }


    // ==========================================
    // CLEANUP
    // ==========================================

    override fun onCleared() {

        webSocketClient.disconnect()

        super.onCleared()
    }
}