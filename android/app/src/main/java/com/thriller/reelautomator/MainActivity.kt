package com.thriller.reelautomator
import android.content.Intent
import android.os.Bundle
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.thriller.reelautomator.adapter.ReelAdapter
import com.thriller.reelautomator.viewmodel.ReelViewModel
import kotlinx.coroutines.launch
class MainActivity : AppCompatActivity() {
    private val viewModel: ReelViewModel by viewModels()
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContentView(R.layout.activity_main)
        // ========================================
        // UI REFERENCES
        // ========================================
        val statusText =
            findViewById<TextView>(R.id.statusText)
        val urlInput =
            findViewById<EditText>(R.id.urlInput)
        val sendButton =
            findViewById<Button>(R.id.sendButton)
        val recyclerView =
            findViewById<RecyclerView>(
                R.id.reelRecyclerView
            )
        // ========================================
        // WINDOW INSETS
        // ========================================
        ViewCompat.setOnApplyWindowInsetsListener(
            findViewById(R.id.main)
        ) { v, insets ->
            val systemBars =
                insets.getInsets(
                    WindowInsetsCompat.Type.systemBars()
                )
            v.setPadding(
                systemBars.left,
                systemBars.top,
                systemBars.right,
                systemBars.bottom
            )
            insets
        }
        // ========================================
        // RECYCLER VIEW
        // ========================================
        val adapter =
            ReelAdapter(lifecycleScope)
        recyclerView.layoutManager =
            LinearLayoutManager(this)
        recyclerView.adapter =
            adapter
        // ========================================
        // SEND REEL
        // ========================================
        sendButton.setOnClickListener {
            val url =
                urlInput.text
                    .toString()
                    .trim()
            if (url.isEmpty()) {
                statusText.text =
                    "Please enter a URL"
                return@setOnClickListener
            }
            if (
                !url.startsWith("http://") &&
                !url.startsWith("https://")
            ) {
                statusText.text =
                    "Please enter a valid URL"
                return@setOnClickListener
            }
            viewModel.sendReel(url)
            urlInput.text.clear()
        }
        // ========================================
        // HANDLE SHARED URL
        // ========================================
        handleSharedText(intent)
        // ========================================
        // STATUS OBSERVER
        // ========================================
        lifecycleScope.launch {
            viewModel.status.collect { status ->
                statusText.text =
                    status
            }
        }
        // ========================================
        // REEL LIST OBSERVER
        // ========================================
        lifecycleScope.launch {
            viewModel.reels.collect { reels ->
                adapter.submitList(
                    reels.reversed()
                )
            }
        }
    }
    // ========================================
    // SHARED TEXT
    // ========================================
    private fun handleSharedText(
        intent: Intent?
    ) {
        if (
            intent?.action ==
            Intent.ACTION_SEND
        ) {
            val sharedText =
                intent.getStringExtra(
                    Intent.EXTRA_TEXT
                )
            if (!sharedText.isNullOrBlank()) {
                val urlPattern =
                    Regex(
                        """https?://\S+"""
                    )
                val match =
                    urlPattern.find(
                        sharedText
                    )
                if (match != null) {
                    val url =
                        match.value
                    val urlInput =
                        findViewById<EditText>(
                            R.id.urlInput
                        )
                    urlInput.setText(url)
                    urlInput.setSelection(
                        url.length
                    )
                } else {
                    val statusText =
                        findViewById<TextView>(
                            R.id.statusText
                        )
                    statusText.text =
                        "No URL found in shared content"
                }
            }
        }
    }
}