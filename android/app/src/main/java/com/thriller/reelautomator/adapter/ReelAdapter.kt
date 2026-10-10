package com.thriller.reelautomator.adapter

import android.animation.ObjectAnimator
import android.app.AlertDialog
import android.graphics.Color
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import androidx.lifecycle.LifecycleCoroutineScope
import androidx.recyclerview.widget.RecyclerView
import com.thriller.reelautomator.R
import com.thriller.reelautomator.network.ReelItem
import com.thriller.reelautomator.repository.ReelRepository
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class ReelAdapter(
    private val lifecycleScope: LifecycleCoroutineScope
) : RecyclerView.Adapter<ReelAdapter.ReelViewHolder>() {

    private var reels =
        emptyList<ReelItem>()

    fun submitList(
        newReels: List<ReelItem>
    ) {
        reels = newReels
        notifyDataSetChanged()
    }

    override fun onCreateViewHolder(
        parent: ViewGroup,
        viewType: Int
    ): ReelViewHolder {

        val view =
            LayoutInflater.from(parent.context)
                .inflate(
                    R.layout.reel_item,
                    parent,
                    false
                )

        return ReelViewHolder(
            view,
            lifecycleScope
        )
    }

    override fun onBindViewHolder(
        holder: ReelViewHolder,
        position: Int
    ) {

        holder.bind(
            reels[position],
            reels.size - position
        )
    }

    override fun getItemCount(): Int {
        return reels.size
    }

    class ReelViewHolder(
        itemView: View,
        private val lifecycleScope: LifecycleCoroutineScope
    ) : RecyclerView.ViewHolder(itemView) {

        private val numberText =
            itemView.findViewById<TextView>(
                R.id.reelNumberText
            )

        private val urlText =
            itemView.findViewById<TextView>(
                R.id.reelUrlText
            )

        private val operationText =
            itemView.findViewById<TextView>(
                R.id.reelOperationText
            )

        private val detailText =
            itemView.findViewById<TextView>(
                R.id.reelDetailText
            )

        private val fileInfoText =
            itemView.findViewById<TextView>(
                R.id.reelFileInfoText
            )

        private val percentText =
            itemView.findViewById<TextView>(
                R.id.reelPercentText
            )

        private val progressBar =
            itemView.findViewById<ProgressBar>(
                R.id.reelProgressBar
            )

        private val statusAccentBar =
            itemView.findViewById<View>(
                R.id.statusAccentBar
            )

        private val actionButton =
            itemView.findViewById<TextView>(
                R.id.reelActionButton
            )

        private val repository =
            ReelRepository()

        fun bind(
            reel: ReelItem,
            reelNumber: Int
        ) {

            actionButton.isEnabled = true

            numberText.text =
                "reel_$reelNumber"

            urlText.text =
                reel.url

            operationText.text =
                getSimpleStage(
                    reel.stage,
                    reel.status
                )

            detailText.text =
                getReadableDetail(
                    reel.detail
                )

            val currentProgress =
                progressBar.progress

            val targetProgress =
                reel.progress.coerceIn(
                    0,
                    100
                )

            if (
                currentProgress !=
                targetProgress
            ) {

                ObjectAnimator.ofInt(
                    progressBar,
                    "progress",
                    currentProgress,
                    targetProgress
                ).apply {

                    duration = 350L

                    start()
                }
            }

            percentText.text =
                "$targetProgress%"

            applyStatusAppearance(
                reel
            )

            if (
                reel.status ==
                "published"
            ) {

                fileInfoText.visibility =
                    View.VISIBLE

                fileInfoText.text =
                    buildFileInfo(
                        reel
                    )

            } else {

                fileInfoText.visibility =
                    View.GONE
            }

            actionButton.setOnClickListener {

                // ========================================
                // DELETED INSTAGRAM REEL
                // ========================================

                if (
                    reel.status.equals("deleted", ignoreCase = true) ||
                    reel.status.equals("failed", ignoreCase = true)
                ) {
                    showRemoveHistoryDialog(reel)
                    return@setOnClickListener
                }

                // ========================================
                // PUBLISHED REEL
                // ========================================

                if (
                    reel.status ==
                    "published"
                ) {

                    Toast.makeText(
                        itemView.context,
                        "Delete this Reel from Instagram first",
                        Toast.LENGTH_SHORT
                    ).show()

                    return@setOnClickListener
                }


                // ========================================
                // FILE MISSING
                // ========================================

                if (
                    reel.status ==
                    "file_missing"
                ) {

                    actionButton.isEnabled =
                        false

                    lifecycleScope.launch {

                        try {

                            val response =
                                repository.deleteReel(
                                    reel.id
                                )

                            Toast.makeText(
                                itemView.context,
                                response.message,
                                Toast.LENGTH_SHORT
                            ).show()

                        } catch (
                            error: Exception
                        ) {

                            Toast.makeText(
                                itemView.context,
                                "Failed to remove from queue",
                                Toast.LENGTH_SHORT
                            ).show()

                            actionButton.isEnabled =
                                true
                        }
                    }

                    return@setOnClickListener
                }


                // ========================================
                // OTHER STATES
                // ========================================

                if (
                    reel.status !=
                    "downloaded"
                ) {

                    Toast.makeText(
                        itemView.context,
                        "No downloaded video to delete",
                        Toast.LENGTH_SHORT
                    ).show()

                    return@setOnClickListener
                }

                actionButton.isEnabled =
                    false

                lifecycleScope.launch {

                    try {

                        val response =
                            repository.deleteReelFile(
                                reel.id
                            )

                        Toast.makeText(
                            itemView.context,
                            response.message,
                            Toast.LENGTH_SHORT
                        ).show()

                    } catch (
                        error: Exception
                    ) {

                        Toast.makeText(
                            itemView.context,
                            "Failed to delete video",
                            Toast.LENGTH_SHORT
                        ).show()

                        actionButton.isEnabled =
                            true
                    }
                }
            }
        }


        // ========================================
        // REMOVE DELETED REEL DIALOG
        // ========================================

        // ========================================
// REMOVE RECORD FROM SIFT HISTORY
// ========================================

        private fun showRemoveHistoryDialog(
            reel: ReelItem
        ) {
            AlertDialog.Builder(itemView.context)
                .setTitle("Remove from SIFT?")
                .setMessage(
                    "This will remove this record from SIFT history. " +
                            "It will not delete the Reel from Instagram."
                )
                .setNegativeButton("Cancel", null)
                .setPositiveButton("Remove") { _, _ ->
                    removeHistoryRecord(reel)
                }
                .show()
        }


        // ========================================
// REMOVE RECORD FROM SIFT HISTORY
// ========================================

        private fun removeHistoryRecord(
            reel: ReelItem
        ) {
            actionButton.isEnabled = false

            lifecycleScope.launch {
                try {
                    val response = repository.deleteReel(reel.id)

                    Toast.makeText(
                        itemView.context,
                        response.message,
                        Toast.LENGTH_SHORT
                    ).show()

                } catch (error: Exception) {
                    Toast.makeText(
                        itemView.context,
                        "Failed to remove from SIFT",
                        Toast.LENGTH_SHORT
                    ).show()

                    actionButton.isEnabled = true
                }
            }
        }


        // ========================================
        // SIMPLE STAGE
        // ========================================

        private fun getSimpleStage(
            stage: String?,
            status: String?
        ): String {

            return when {

                status.equals(
                    "queued",
                    ignoreCase = true
                ) ->
                    "Queued"

                status.equals(
                    "downloading",
                    ignoreCase = true
                ) ->
                    "Downloading"

                status.equals(
                    "processing",
                    ignoreCase = true
                ) ->
                    "Processing"

                status.equals(
                    "uploading",
                    ignoreCase = true
                ) ->
                    "Cloud Uploading"

                status.equals(
                    "publishing",
                    ignoreCase = true
                ) ->
                    "Publishing"

                status.equals(
                    "published",
                    ignoreCase = true
                ) ->
                    "Published"

                status.equals(
                    "deleted",
                    ignoreCase = true
                ) ->
                    "Deleted"

                status.equals(
                    "failed",
                    ignoreCase = true
                ) ->
                    "Failed"

                status.equals(
                    "file_missing",
                    ignoreCase = true
                ) ->
                    "File Missing"

                else ->
                    stage?.ifBlank {
                        "Waiting"
                    } ?: "Waiting"
            }
        }


        // ========================================
        // READABLE DETAIL
        // ========================================

        private fun getReadableDetail(
            detail: String?
        ): String {

            return when (
                detail?.lowercase(
                    Locale.US
                )
            ) {

                "keyword_added_to_queue" ->
                    "Waiting to start"

                "initializing_download" ->
                    "Initializing download"

                "fetching_media" ->
                    "Fetching media"

                "downloading_media" ->
                    "Downloading media"

                "download_completed" ->
                    "Download completed"

                "checking_download" ->
                    "Checking downloaded file"

                "checking_video_format" ->
                    "Checking video format"

                "verifying_prepared_video" ->
                    "Verifying prepared video"

                "processing_video" ->
                    "Processing video"

                "processing_completed" ->
                    "Processing completed"

                "setting_up_cloud_upload" ->
                    "Setting up cloud upload"

                "uploading_to_cloudinary" ->
                    "Uploading to Cloudinary"

                "cloud_upload_completed" ->
                    "Cloud upload completed"

                "setting_up_instagram_publish" ->
                    "Setting up Instagram publishing"

                "creating_instagram_container" ->
                    "Creating Instagram container"

                "instagram_publish_completed" ->
                    "Instagram publish completed"

                "instagram_publish_complete" ->
                    "Instagram publish completed"

                "reel_deleted_on_instagram" ->
                    "Reel deleted on Instagram"

                "video_processing_failed" ->
                    "Video processing failed"

                "downloaded_file_not_found" ->
                    "Downloaded file not found"

                else ->

                    if (
                        detail.isNullOrBlank()
                    ) {

                        "Waiting..."

                    } else {

                        detail
                            .replace(
                                "_",
                                " "
                            )
                            .replaceFirstChar {
                                it.uppercase()
                            }
                    }
            }
        }


        // ========================================
        // STATUS APPEARANCE
        // ========================================

        private fun applyStatusAppearance(
            reel: ReelItem
        ) {

            when (
                reel.status.lowercase(
                    Locale.US
                )
            ) {

                "queued" -> {
                    setStatusColor("#555A5F")
                    setDetailColor("#555A5F")
                }

                "downloading" -> {
                    setStatusColor("#D8952E")
                    setDetailColor("#555A5F")
                }

                "processing" -> {
                    setStatusColor("#8E63D2")
                    setDetailColor("#555A5F")
                }

                "uploading" -> {
                    setStatusColor("#4A90E2")
                    setDetailColor("#555A5F")
                }

                "publishing" -> {
                    setStatusColor("#C45BD6")
                    setDetailColor("#555A5F")
                }

                "published" -> {
                    setStatusColor("#3EE089")
                    setDetailColor("#555A5F")
                }

                "deleted" -> {
                    setStatusColor("#E05252")
                    setDetailColor("#555A5F")
                }

                "file_missing" -> {
                    setStatusColor("#E05252")
                    setDetailColor("#555A5F")
                }

                "failed" -> {
                    setStatusColor("#E05252")
                    setDetailColor("#555A5F")
                }

                "interrupted" -> {
                    setStatusColor("#D8952E")
                    setDetailColor("#555A5F")
                }

                else -> {
                    setStatusColor("#555A5F")
                    setDetailColor("#555A5F")
                }
            }
        }


        // ========================================
        // STATUS COLOR
        // ========================================

        private fun setStatusColor(
            color: String
        ) {

            val parsedColor =
                Color.parseColor(
                    color
                )

            statusAccentBar
                .setBackgroundColor(
                    parsedColor
                )

            percentText
                .setTextColor(
                    parsedColor
                )
        }


        // ========================================
        // DETAIL COLOR
        // ========================================

        private fun setDetailColor(
            color: String
        ) {

            detailText
                .setTextColor(
                    Color.parseColor(
                        color
                    )
                )
        }


        // ========================================
        // FILE INFO
        // ========================================

        private fun buildFileInfo(
            reel: ReelItem
        ): String {

            val resolution =
                if (
                    reel.width != null &&
                    reel.height != null
                ) {

                    "${reel.width}×${reel.height}"

                } else {

                    "Unknown"
                }

            val formattedSize =
                reel.sizeBytes?.let {
                        bytes ->

                    when {

                        bytes >=
                                1024L * 1024L ->

                            String.format(
                                Locale.US,
                                "%.1f MB",
                                bytes /
                                        (
                                                1024.0 *
                                                        1024.0
                                                )
                            )

                        bytes >=
                                1024L ->

                            String.format(
                                Locale.US,
                                "%.1f KB",
                                bytes /
                                        1024.0
                            )

                        else ->
                            "$bytes B"
                    }

                } ?: "Unknown"

            val date =
                try {

                    val inputFormat =
                        SimpleDateFormat(
                            "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",
                            Locale.US
                        )

                    inputFormat.timeZone =
                        java.util.TimeZone
                            .getTimeZone(
                                "UTC"
                            )

                    val parsedDate =
                        inputFormat.parse(
                            reel.createdAt
                        )

                    val outputFormat =
                        SimpleDateFormat(
                            "dd MMM · HH:mm",
                            Locale.US
                        )

                    outputFormat.format(
                        parsedDate ?: Date()
                    )

                } catch (
                    error: Exception
                ) {

                    "Unknown date"
                }

            return "MP4 · $resolution · $formattedSize    $date"
        }
    }
}