import base64
import json
import mimetypes
import os
import shutil
import subprocess
import tempfile
import time

import requests

# MiniMax API base URL (domestic: api.minimaxi.com, international: api.minimax.io)
MINIMAX_API_BASE = os.getenv("MINIMAX_BASE_URL", "https://api.minimaxi.com").rstrip("/v1")

# Polling interval in seconds for video/music generation status
POLL_INTERVAL_SEC = 5
# Maximum wait time in seconds (30 minutes)
MAX_WAIT_SEC = 1800

# Default voice for TTS narration (male, warm tone)
DEFAULT_VOICE_ID = "male-qn-qingse"
# Default female voice for dialogue
DEFAULT_FEMALE_VOICE_ID = "female-shaonv"
# TTS model – use speech-2.8-hd for Token Plan (best quality with emotion tags)
TTS_MODEL = "speech-2.8-hd"


def _get_mime_type(file_path: str) -> str:
    """Detect MIME type from file path, defaulting to image/jpeg."""
    mime_type, _ = mimetypes.guess_type(file_path)
    if mime_type and mime_type.startswith("image/"):
        return mime_type
    return "image/jpeg"


def _has_ffmpeg() -> bool:
    """Check if ffmpeg is available on the system."""
    return shutil.which("ffmpeg") is not None


def _load_prompt_json(prompt_file: str) -> dict:
    """Load and parse the JSON prompt file."""
    with open(prompt_file, "r", encoding="utf-8") as f:
        return json.load(f)


def _auto_generate_narration(prompt_data: dict) -> str | None:
    """Generate fallback narration text when the prompt has no
    dialogue or narration fields.

    This is a template-based approach for simple prompts. For best results,
    the user/agent should always include a 'narration' or 'dialogue' field
    in the JSON prompt.
    """
    lines: list[str] = []

    # Try to build narration from background description
    bg = prompt_data.get("background", {})
    bg_desc = bg.get("description", "") if isinstance(bg, dict) else str(bg)

    if bg_desc:
        lines.append(bg_desc)

    # Mention characters if present
    characters = prompt_data.get("characters", [])
    if characters:
        names = characters if isinstance(characters, list) else [characters]
        char_list = "、".join(str(n) for n in names)
        lines.append(f"画面中出现：{char_list}。")

    # Mention camera / mood
    camera = prompt_data.get("camera", {})
    if isinstance(camera, dict):
        cam_desc = camera.get("type", "")
        if cam_desc:
            lines.append(f"镜头采用{cam_desc}。")

    if not lines:
        return None

    return " ".join(lines)


def _call_tts(text: str, voice_id: str, emotion: str = "neutral") -> str:
    """Call MiniMax TTS API and return the path to the generated audio file.

    Returns path to a temporary .mp3 file. Caller is responsible for cleanup.
    """
    api_key = os.getenv("MINIMAX_API_KEY")
    if not api_key:
        raise RuntimeError("MINIMAX_API_KEY is not set")

    body: dict = {
        "model": TTS_MODEL,
        "text": text,
        "stream": False,
        "voice_setting": {
            "voice_id": voice_id,
            "speed": 1.0,
            "vol": 1.0,
            "pitch": 0,
            "emotion": emotion,
        },
        "audio_setting": {
            "sample_rate": 32000,
            "bitrate": 128000,
            "format": "mp3",
            "channel": 1,
        },
        "output_format": "hex",
    }

    resp = requests.post(
        f"{MINIMAX_API_BASE}/v1/t2a_v2",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        json=body,
    )
    resp.raise_for_status()
    result = resp.json()

    base_resp = result.get("base_resp", {})
    if base_resp.get("status_code") != 0:
        raise RuntimeError(
            f"TTS API error (code={base_resp.get('status_code')}): "
            f"{base_resp.get('status_msg', 'unknown')}"
        )

    hex_audio = result.get("data", {}).get("audio")
    if not hex_audio:
        raise RuntimeError("TTS returned no audio data")

    tmp = tempfile.NamedTemporaryFile(suffix=".mp3", delete=False)
    try:
        tmp.write(bytes.fromhex(hex_audio))
    finally:
        tmp.close()

    return tmp.name


def _call_music_generation(
    prompt: str,
    is_instrumental: bool = True,
    lyrics: str | None = None,
) -> str:
    """Call MiniMax Music-2.6 API and return path to the generated audio file.

    Returns path to a temporary .mp3 file. Caller is responsible for cleanup.
    """
    api_key = os.getenv("MINIMAX_API_KEY")
    if not api_key:
        raise RuntimeError("MINIMAX_API_KEY is not set")

    body: dict = {
        "model": "music-2.6",
        "prompt": prompt,
        "is_instrumental": is_instrumental,
        "audio_setting": {
            "sample_rate": 44100,
            "bitrate": 256000,
            "format": "mp3",
        },
        "output_format": "hex",
    }
    if lyrics:
        body["lyrics"] = lyrics

    # Step 1: Create music generation task
    resp = requests.post(
        f"{MINIMAX_API_BASE}/v1/music_generation",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        json=body,
    )
    resp.raise_for_status()
    result = resp.json()

    base_resp = result.get("base_resp", {})
    if base_resp.get("status_code") != 0:
        raise RuntimeError(
            f"Music API error (code={base_resp.get('status_code')}): "
            f"{base_resp.get('status_msg', 'unknown')}"
        )

    hex_audio = result.get("data", {}).get("audio")
    if not hex_audio:
        raise RuntimeError("Music generation returned no audio data")

    tmp = tempfile.NamedTemporaryFile(suffix=".mp3", delete=False)
    try:
        tmp.write(bytes.fromhex(hex_audio))
    finally:
        tmp.close()

    return tmp.name


def _merge_audio_tracks(
    audio_files: list[tuple[str, float, float]],
) -> str | None:
    """Merge multiple audio tracks into a single mixed audio file using ffmpeg.

    Args:
        audio_files: List of (file_path, start_offset_sec, volume_ratio) tuples.
                     volume_ratio: 1.0 = full volume, 0.3 = 30%

    Returns path to a temporary mixed .mp3 file, or None if no files.

    Optimization: If there's only ONE track with delay=0 and volume≈1.0,
    skip ffmpeg entirely and return the original path.
    """
    if not audio_files:
        return None

    # ── Fast path: single track, no processing needed ──
    if len(audio_files) == 1:
        path, delay, _vol = audio_files[0]
        if delay <= 0.01:
            return path

    if not _has_ffmpeg():
        print("⚠ ffmpeg not found — skipping audio merge. Install ffmpeg for audio support.")
        return None

    # Build ffmpeg filter complex
    filters: list[str] = []
    inputs: list[str] = []
    for i, (path, delay, vol) in enumerate(audio_files):
        inputs.extend(["-i", path])
        if delay > 0.01:
            delay_ms = int(delay * 1000)
            filters.append(f"[{i}:a]adelay={delay_ms}|{delay_ms}[d{i}]")
            filters.append(f"[d{i}]volume={vol}[a{i}]")
        else:
            filters.append(f"[{i}:a]volume={vol}[a{i}]")

    # Mix all normalized streams
    mix_inputs = "".join(f"[a{i}]" for i in range(len(audio_files)))
    filters.append(f"{mix_inputs}amix=inputs={len(audio_files)}:duration=longest:dropout_transition=2[audio]")

    filter_str = ";".join(filters)

    out = tempfile.NamedTemporaryFile(suffix=".mp3", delete=False)
    out.close()

    cmd = [
        "ffmpeg", "-y",
        *inputs,
        "-filter_complex", filter_str,
        "-map", "[audio]",
        "-c:a", "libmp3lame",
        "-q:a", "2",
        out.name,
    ]

    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"⚠ ffmpeg audio merge failed: {result.stderr[-800:]}")
        try:
            os.unlink(out.name)
        except OSError:
            pass
        return None

    return out.name


def _merge_audio_with_video(
    video_path: str,
    audio_path: str,
    output_path: str,
) -> bool:
    """Merge an audio track into a video file using ffmpeg.

    Uses a two-step approach for maximum compatibility:
      1. Transcode audio to AAC in a temp .m4a file
      2. Mux video (stream copy) + AAC audio into MP4

    The video's original audio track (if any) is replaced.
    """
    if not _has_ffmpeg():
        return False

    # Step 1: Transcode the input audio to AAC (M4A container).
    # MiniMax TTS returns MP3; some MP4 muxers have trouble with certain
    # MP3 encodings.  Transcoding to AAC first eliminates this class
    # of compatibility issues.
    aac_tmp = tempfile.NamedTemporaryFile(suffix=".m4a", delete=False)
    aac_tmp.close()

    transcode_cmd = [
        "ffmpeg", "-y",
        "-i", audio_path,
        "-c:a", "aac",
        "-b:a", "192k",
        "-vn",
        aac_tmp.name,
    ]
    result1 = subprocess.run(transcode_cmd, capture_output=True, text=True)
    if result1.returncode != 0:
        print(f"⚠ ffmpeg audio-transcode failed: {result1.stderr[-800:]}")
        try:
            os.unlink(aac_tmp.name)
        except OSError:
            pass
        return False

    # Step 2: Mux video (stream copy) + transcoded AAC audio into MP4.
    # Both streams are now guaranteed MP4-compatible → safe to use -c copy.
    tmp_out = output_path + ".tmp.mp4"
    mux_cmd = [
        "ffmpeg", "-y",
        "-i", video_path,
        "-i", aac_tmp.name,
        "-c", "copy",
        "-shortest",
        "-movflags", "+faststart",
        tmp_out,
    ]
    result2 = subprocess.run(mux_cmd, capture_output=True, text=True)

    # Clean up the temp AAC file regardless of outcome
    try:
        os.unlink(aac_tmp.name)
    except OSError:
        pass

    if result2.returncode != 0:
        print(f"⚠ ffmpeg video-mux failed: {result2.stderr[-800:]}")
        # Attempt fallback: re-encode video instead of stream copy
        print("  → Trying fallback with video re-encode...")
        fallback_cmd = [
            "ffmpeg", "-y",
            "-i", video_path,
            "-i", audio_path,
            "-c:v", "libx264",
            "-preset", "ultrafast",
            "-c:a", "aac",
            "-b:a", "192k",
            "-shortest",
            "-movflags", "+faststart",
            tmp_out,
        ]
        result3 = subprocess.run(fallback_cmd, capture_output=True, text=True)
        if result3.returncode != 0:
            print(f"⚠ ffmpeg fallback also failed: {result3.stderr[-800:]}")
            try:
                os.unlink(tmp_out)
            except OSError:
                pass
            return False

    # Replace original with merged version
    os.replace(tmp_out, output_path)
    return True


def _generate_audio_for_prompt(
    prompt_data: dict,
    api_key: str,
) -> tuple[str | None, list[str]]:
    """Generate TTS + music audio from the prompt JSON.

    Returns:
        (merged_audio_path, cleanup_files_list)
        merged_audio_path is None if no audio could be generated.
    """
    cleanup: list[str] = []

    dialogue = prompt_data.get("dialogue", [])
    narration = prompt_data.get("narration", "")
    audio_cues = prompt_data.get("audio", [])

    # ---------- Determine text source for TTS ----------
    audio_tracks: list[tuple[str, float, float]] = []  # (path, delay, volume)
    current_delay: float = 0.0
    speech_duration_estimate: float = 3.0  # seconds per ~15 chars

    # 1. Dialogue lines (each character speaks)
    if isinstance(dialogue, list) and dialogue:
        for line in dialogue:
            if not isinstance(line, dict):
                continue
            text = line.get("text", "")
            if not text:
                continue

            char_name = line.get("character", "narrator")
            voice_id = line.get("voice_id", DEFAULT_VOICE_ID)
            emotion = line.get("emotion", "neutral")

            try:
                print(f"  Generating TTS for [{char_name}]: {text[:40]}...")
                audio_file = _call_tts(text, voice_id, emotion)
                cleanup.append(audio_file)
                audio_tracks.append((audio_file, current_delay, 1.0))
                # Estimate duration: ~3s per 15 Chinese chars
                est_dur = max(2.0, len(text) / 5)
                current_delay += est_dur + 0.5  # 0.5s gap between lines
            except Exception as e:
                print(f"  ⚠ TTS failed for [{char_name}]: {e}")

    # 2. Narration (single voiceover)
    if narration and isinstance(narration, str) and narration.strip():
        try:
            print(f"  Generating TTS narration: {narration[:50]}...")
            audio_file = _call_tts(narration, DEFAULT_VOICE_ID, "calm")
            cleanup.append(audio_file)
            audio_tracks.append((audio_file, current_delay, 0.9))
        except Exception as e:
            print(f"  ⚠ Narration TTS failed: {e}")

    # 3. Fallback narration for simple prompts (no dialogue, no narration)
    if not audio_tracks:
        fallback = _auto_generate_narration(prompt_data)
        if fallback:
            try:
                print(f"  ⚡ Auto-generating fallback narration: {fallback[:50]}...")
                audio_file = _call_tts(fallback, DEFAULT_VOICE_ID, "calm")
                cleanup.append(audio_file)
                audio_tracks.append((audio_file, 0.0, 0.9))
            except Exception as e:
                print(f"  ⚠ Fallback narration TTS failed: {e}")

    # 4. Background music from audio cues
    bgm_tracks: list[tuple[str, float, float]] = []
    if isinstance(audio_cues, list):
        for cue in audio_cues:
            if not isinstance(cue, dict):
                continue
            cue_type = cue.get("type", "")
            if cue_type.lower() == "music" and "description" not in cue:
                # Music cue: generate background music
                music_prompt = cue.get("description", "")
                if not music_prompt:
                    # Build from audio cue's own fields
                    music_prompt = cue.get("genre", cue.get("mood", "cinematic"))
                bg_vol = float(cue.get("volume", 0.3))
                try:
                    print(f"  Generating background music: {music_prompt[:40]}...")
                    bgm_file = _call_music_generation(music_prompt)
                    cleanup.append(bgm_file)
                    bgm_tracks.append((bgm_file, 0.0, bg_vol))
                except Exception as e:
                    print(f"  ⚠ Music generation failed: {e}")

    if not audio_tracks and not bgm_tracks:
        return None, cleanup

    # Merge speech tracks first, then mix with BGM
    speech_mix: str | None = None
    if audio_tracks:
        speech_mix = _merge_audio_tracks(audio_tracks)
        if speech_mix:
            cleanup.append(speech_mix)

    if speech_mix and bgm_tracks:
        # Mix speech with BGM (BGM plays from start at low volume)
        all_tracks = [(speech_mix, 0.0, 1.0)] + bgm_tracks
        final_mix = _merge_audio_tracks(all_tracks)
        if final_mix:
            cleanup.append(final_mix)
        return final_mix, cleanup
    elif speech_mix:
        return speech_mix, cleanup
    elif bgm_tracks:
        final_mix = _merge_audio_tracks(bgm_tracks)
        if final_mix:
            cleanup.append(final_mix)
        return final_mix, cleanup

    return None, cleanup


def generate_video(
    prompt_file: str,
    reference_images: list[str],
    output_file: str,
    aspect_ratio: str = "16:9",
    fast_mode: bool = False,
    no_audio: bool = False,
) -> str:
    prompt_data = _load_prompt_json(prompt_file)
    # Flatten prompt to string for the video generation API
    prompt_text = json.dumps(prompt_data, ensure_ascii=False)

    api_key = os.getenv("MINIMAX_API_KEY")
    if not api_key:
        return "MINIMAX_API_KEY is not set"

    # Build request body for MiniMax video generation.
    # MiniMax Token Plan provides TWO separate daily video quotas (3 each):
    #   - Hailuo-2.3 768P 6s  → 3/day (standard mode)
    #   - Hailuo-2.3-Fast 768P 6s → 3/day (fast mode, fast_pretreatment=true)
    # Both use the same API model 'MiniMax-Hailuo-2.3'. Calling with
    # --fast uses the Fast quota, giving up to 6 videos/day total.
    request_body: dict = {
        "model": "MiniMax-Hailuo-2.3",
        "prompt": prompt_text,
        "prompt_optimizer": True,
        "duration": 6,
    }
    if fast_mode:
        request_body["fast_pretreatment"] = True
        print("Using fast mode (Hailuo-2.3-Fast quota)")

    # If there are reference images, use the image-to-video endpoint
    if reference_images:
        valid_refs = []
        for ref_img in reference_images:
            try:
                with open(ref_img, "rb") as f:
                    data = f.read()
                if data:
                    valid_refs.append(ref_img)
            except Exception as e:
                print(f"Skipping invalid reference image {ref_img}: {e}")

        if valid_refs:
            print(
                f"Note: MiniMax T2V model does not support reference images. "
                f"Only the prompt will be used for generation. "
                f"({len(valid_refs)} reference image(s) ignored)"
            )

    # ========== Step 1: Create video generation task ==========
    print("Creating video generation task...")
    response = requests.post(
        f"{MINIMAX_API_BASE}/v1/video_generation",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        json=request_body,
    )
    response.raise_for_status()
    result = response.json()

    base_resp = result.get("base_resp", {})
    if base_resp.get("status_code") != 0:
        raise Exception(
            f"MiniMax API error (code={base_resp.get('status_code')}): "
            f"{base_resp.get('status_msg', 'unknown error')}"
        )

    task_id = result.get("task_id")
    if not task_id:
        raise Exception(f"No task_id in response: {result}")
    print(f"Task created: {task_id}")

    # ========== Step 2: Poll for video task completion ==========
    start_time = time.time()
    file_id = None
    while True:
        elapsed = time.time() - start_time
        if elapsed > MAX_WAIT_SEC:
            raise Exception(
                f"Video generation timed out after {MAX_WAIT_SEC}s. "
                f"Task ID: {task_id}"
            )

        time.sleep(POLL_INTERVAL_SEC)

        query_resp = requests.get(
            f"{MINIMAX_API_BASE}/v1/query/video_generation",
            params={"task_id": task_id},
            headers={"Authorization": f"Bearer {api_key}"},
        )
        query_resp.raise_for_status()
        query_result = query_resp.json()

        status = query_result.get("status", "")
        print(f"  Task status: {status} (elapsed: {int(elapsed)}s)")

        if status == "Success":
            file_id = query_result.get("file_id")
            if not file_id:
                raise Exception(f"Task succeeded but no file_id: {query_result}")
            break
        elif status == "Fail":
            query_base = query_result.get("base_resp", {})
            raise Exception(
                f"Video generation failed. "
                f"Code: {query_base.get('status_code')}, "
                f"Msg: {query_base.get('status_msg', 'unknown')}"
            )
        elif status in ("Preparing", "Queueing", "Processing"):
            continue
        else:
            raise Exception(f"Unknown task status: {status}")

    print(f"Video generated successfully. File ID: {file_id}")

    # ========== Step 3: Get download URL ==========
    file_resp = requests.get(
        f"{MINIMAX_API_BASE}/v1/files/retrieve",
        params={"file_id": file_id},
        headers={"Authorization": f"Bearer {api_key}"},
    )
    file_resp.raise_for_status()
    file_result = file_resp.json()

    file_base = file_result.get("base_resp", {})
    if file_base.get("status_code") != 0:
        raise Exception(
            f"Failed to retrieve file info: {file_base.get('status_msg', 'unknown')}"
        )

    download_url = file_result.get("file", {}).get("download_url")
    if not download_url:
        raise Exception(f"No download_url in file response: {file_result}")

    # ========== Step 4: Download the video file ==========
    print(f"Downloading video from {download_url}...")
    dl_resp = requests.get(download_url)
    dl_resp.raise_for_status()

    with open(output_file, "wb") as f:
        f.write(dl_resp.content)

    # ========== Step 5: Generate audio and merge ==========
    audio_result = " (no audio)"
    cleanup_files: list[str] = []

    if not no_audio:
        try:
            print("\n--- Generating audio ---")
            merged_audio, cleanup_files = _generate_audio_for_prompt(prompt_data, api_key)

            if merged_audio:
                print("--- Merging audio with video ---")
                success = _merge_audio_with_video(output_file, merged_audio, output_file)
                if success:
                    audio_result = " (with audio)"
                else:
                    audio_result = " (audio generated but merge failed)"
            elif not _has_ffmpeg():
                audio_result = " (audio skipped — ffmpeg not installed)"
            else:
                audio_result = " (silent — no dialogue/narration in prompt)"
        except Exception as e:
            print(f"⚠ Audio processing failed: {e}")
            audio_result = " (audio error — see logs above)"
        finally:
            # Clean up temporary audio files
            for f in cleanup_files:
                try:
                    os.unlink(f)
                except OSError:
                    pass
    else:
        audio_result = " (--no-audio)"

    return f"The video has been generated successfully to {output_file}{audio_result}"


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Generate videos using MiniMax API")
    parser.add_argument(
        "--prompt-file",
        required=True,
        help="Absolute path to JSON prompt file",
    )
    parser.add_argument(
        "--reference-images",
        nargs="*",
        default=[],
        help="Absolute paths to reference images (space-separated)",
    )
    parser.add_argument(
        "--output-file",
        required=True,
        help="Output path for generated video",
    )
    parser.add_argument(
        "--aspect-ratio",
        required=False,
        default="16:9",
        help="Aspect ratio of the generated video",
    )
    parser.add_argument(
        "--fast",
        action="store_true",
        default=False,
        help="Use fast mode (Hailuo-2.3-Fast quota, separate 3/day limit)",
    )
    parser.add_argument(
        "--no-audio",
        action="store_true",
        default=False,
        help="Skip audio generation (produce silent video only)",
    )

    args = parser.parse_args()

    try:
        print(
            generate_video(
                args.prompt_file,
                args.reference_images,
                args.output_file,
                args.aspect_ratio,
                args.fast,
                args.no_audio,
            )
        )
    except Exception as e:
        print(f"Error while generating video: {e}")
