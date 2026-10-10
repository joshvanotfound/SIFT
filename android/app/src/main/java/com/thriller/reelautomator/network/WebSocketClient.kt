package com.thriller.reelautomator.network

import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okhttp3.Response

class WebSocketClient {

    private val client = OkHttpClient()

    private var webSocket: WebSocket? = null

    private var shouldReconnect = true

    private var reconnectAttempts = 0

    fun connect(
        onMessage: (String) -> Unit
    ) {

        shouldReconnect = true

        createConnection(onMessage)
    }

    private fun createConnection(
        onMessage: (String) -> Unit
    ) {

        val request = Request.Builder()
            .url("ws://100.77.199.96:3001")
            .build()

        webSocket = client.newWebSocket(
            request,
            object : WebSocketListener() {

                override fun onOpen(
                    webSocket: WebSocket,
                    response: Response
                ) {
                    println("WebSocket connected")
                    reconnectAttempts = 0
                }

                override fun onMessage(
                    webSocket: WebSocket,
                    text: String
                ) {
                    onMessage(text)
                }

                override fun onFailure(
                    webSocket: WebSocket,
                    t: Throwable,
                    response: Response?
                ) {
                    println("WebSocket error: ${t.message}")
                    scheduleReconnect(onMessage)
                }

                override fun onClosed(
                    webSocket: WebSocket,
                    code: Int,
                    reason: String
                ) {
                    println("WebSocket closed: $reason")

                    if (shouldReconnect) {
                        scheduleReconnect(onMessage)
                    }
                }
            }
        )
    }

    private fun scheduleReconnect(
        onMessage: (String) -> Unit
    ) {

        if (!shouldReconnect) {
            return
        }

        reconnectAttempts++

        val delay =
            minOf(
                1000L * reconnectAttempts,
                10000L
            )

        println(
            "WebSocket reconnecting in ${delay}ms"
        )

        Thread {

            try {

                Thread.sleep(delay)

            } catch (e: InterruptedException) {

                return@Thread
            }

            if (shouldReconnect) {

                createConnection(
                    onMessage
                )
            }

        }.start()
    }

    fun disconnect() {

        shouldReconnect = false

        webSocket?.close(
            1000,
            "Client disconnected"
        )

        webSocket = null
    }
}