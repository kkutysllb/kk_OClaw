---
name: video-generation
description: Use this skill when the user requests to generate, create, or imagine videos. Supports structured prompts and reference image for guided generation.
---

# Video Generation Skill

## Overview

This skill generates high-quality videos with audio (voiceover + background music) using MiniMax Hailuo-2.3 for video, Speech-2.8 for TTS narration, and Music-2.6 for background music. The workflow includes creating JSON-formatted prompts and executing video + audio generation with optional reference image.

## Core Capabilities

- Create structured JSON prompts for AIGC video generation
- Support reference image as guidance or the first/last frame of the video
- **TTS Narration**: Auto-generate voiceover from `narration` or `dialogue` fields using MiniMax Speech-2.8
- **Background Music**: Generate instrumental BGM via Music-2.6 from `audio` cues
- **Smart Fallback**: Automatically generate narration from scene description if prompt is too simple
- Merge audio tracks with video using ffmpeg
- Generate videos through automated Python script execution

## Workflow

### Step 1: Understand Requirements

When a user requests video generation, identify:

- Subject/content: What should be in the image
- Style preferences: Art style, mood, color palette
- Technical specs: Aspect ratio, composition, lighting
- Reference image: Any image to guide generation
- You don't need to check the folder under `/mnt/user-data`

### Step 2: Create Structured Prompt

Generate a structured JSON file in `/mnt/user-data/workspace/` with naming pattern: `{descriptive-name}.json`

### Step 3: Create Reference Image (Optional when image-generation skill is available)

Generate reference image for the video generation.

- If only 1 image is provided, use it as the guided frame of the video

### Step 3: Execute Generation

Call the Python script:
```bash
python /mnt/skills/public/video-generation/scripts/generate.py \
  --prompt-file /mnt/user-data/workspace/prompt-file.json \
  --reference-images /path/to/ref1.jpg \
  --output-file /mnt/user-data/outputs/generated-video.mp4 \
  --aspect-ratio 16:9
```

Parameters:

- `--prompt-file`: Absolute path to JSON prompt file (required)
- `--reference-images`: Absolute paths to reference image (optional)
- `--output-file`: Absolute path to output video file (required)
- `--aspect-ratio`: Aspect ratio of the generated video (optional, default: 16:9)
- `--fast`: Use fast mode (Hailuo-2.3-Fast quota, separate 3/day limit)
- `--no-audio`: Skip audio generation entirely, produce silent video only

## Audio Generation

The script now automatically generates audio for your video. It reads the following fields from your JSON prompt:

### 1. Dialogue (多角色对话)
Each line is spoken by a character with its own voice:

```json
"dialogue": [
  {
    "character": "奶奶",
    "text": "孩子，你要记住…",
    "voice_id": "female-tianmei",
    "emotion": "sad"
  }
]
```

| 字段 | 说明 |
|------|------|
| `character` | 角色名（仅用于日志输出） |
| `text` | 对话文本（必填） |
| `voice_id` | 音色ID，默认 `male-qn-qingse` |
| `emotion` | 情绪标签：`happy`, `sad`, `angry`, `calm`, `neutral` |

### 2. Narration (旁白)
单段旁白由默认男声朗读：

```json
"narration": "1940年，战火中的伦敦。火车站台上，母亲与女儿做最后的告别。"
```

### 3. Background Music (背景音乐)
通过 `audio` 数组描述音乐风格，脚本会调用 Music-2.6 生成背景音乐：

```json
"audio": [
  {
    "type": "music",
    "description": "悲伤的管弦乐，缓慢的弦乐渐强",
    "genre": "orchestral",
    "volume": 0.3
  }
]
```

### 4. Simple Prompt Fallback (简单提示词自动补充)

**如果 JSON 提示词中没有 `dialogue` 和 `narration` 字段**，脚本会：
1. 自动从 `background.description` 提取场景描述
2. 结合 `characters` 和 `camera` 字段生成一段中文旁白
3. 使用 TTS 转换为语音

例如提示词：
```json
{
  "background": {"description": "A cat playing with a ball of yarn in a sunny room"},
  "characters": ["橘猫"],
  "camera": {"type": "Close-up"}
}
```

将自动生成旁白：*"A cat playing with a ball of yarn in a sunny room。画面中出现：橘猫。镜头采用Close-up。"*

> 💡 **最佳实践**：你应当始终在 JSON 提示词中主动添加 `narration` 或 `dialogue` 字段，以获得更自然、更符合语境的配音效果。自动生成只是兜底方案。

### Available Voice IDs

| voice_id | 描述 | 适合角色 |
|----------|------|---------|
| `male-qn-qingse` | 男性，青涩温柔 | 默认旁白、青年男性 |
| `female-shaonv` | 女性，少女音 | 年轻女性角色 |
| `female-tianmei` | 女性，甜美女声 | 温柔女性角色 |
| `male-chengshu` | 男性，成熟稳重 | 中年男性、权威角色 |
| `presenter_male` | 男性，播音腔 | 纪录片旁白 |
| `presenter_female` | 女性，播音腔 | 纪录片旁白 |

> 更多音色请查阅 MiniMax 音色列表。在 `dialogue` 中为不同角色指定不同的 `voice_id`，可实现多角色对话效果。

### ffmpeg Requirement

Audio merging requires **ffmpeg** to be installed on the system. If ffmpeg is not found:
- Video will still be generated (silent)
- A warning will be printed: `⚠ ffmpeg not found`
- Audio tracks will NOT be merged into the video

Install ffmpeg:
```bash
# macOS
brew install ffmpeg

# Ubuntu/Debian
apt-get install ffmpeg
```

## Daily Quota Strategy

MiniMax Token Plan provides TWO separate daily video quotas (Max-极速版):

| 模式        | 模型                  | 每日配额 | 参数               |
|-----------|---------------------|------|------------------|
| 标准模式      | Hailuo-2.3 768P 6s   | 3 个  | 不加 --fast        |
| 快速模式      | Hailuo-2.3-Fast 768P 6s | 3 个  | 加 `--fast`       |

**关键规则**：每次调用视频生成时，必须在标准模式和快速模式之间交替使用，以充分利用每日 6 个视频的总配额。

实现方式：
- 第 1、3、5 次调用 → 使用标准模式（不加 `--fast`）
- 第 2、4、6 次调用 → 使用快速模式（加 `--fast`）
- 如果某种模式已用完当日配额（API 返回错误），则切换到另一种模式重试

示例调用：

```bash
# 标准模式（使用 Hailuo-2.3 配额）
python /mnt/skills/public/video-generation/scripts/generate.py \
  --prompt-file /mnt/user-data/workspace/prompt.json \
  --output-file /mnt/user-data/outputs/video.mp4

# 快速模式（使用 Hailuo-2.3-Fast 配额）
python /mnt/skills/public/video-generation/scripts/generate.py \
  --prompt-file /mnt/user-data/workspace/prompt.json \
  --output-file /mnt/user-data/outputs/video.mp4 \
  --fast
```

[!NOTE]
Do NOT read the python file, instead just call it with the parameters.

## Video Generation Example

User request: "Generate a short video clip depicting the opening scene from "The Chronicles of Narnia: The Lion, the Witch and the Wardrobe"

Step 1: Search for the opening scene of "The Chronicles of Narnia: The Lion, the Witch and the Wardrobe" online

Step 2: Create a JSON prompt file with the following content:

```json
{
  "title": "The Chronicles of Narnia - Train Station Farewell",
  "narration": "In 1940s wartime Britain, a crowded London train station. Steam and smoke fill the air as children are being sent to the countryside to escape the Blitz. Mrs. Pevensie says goodbye to her youngest daughter Lucy.",
  "background": {
    "description": "World War II evacuation scene at a crowded London train station. Steam and smoke fill the air as children are being sent to the countryside to escape the Blitz.",
    "era": "1940s wartime Britain",
    "location": "London railway station platform"
  },
  "characters": ["Mrs. Pevensie", "Lucy Pevensie"],
  "camera": {
    "type": "Close-up two-shot",
    "movement": "Static with subtle handheld movement",
    "angle": "Profile view, intimate framing",
    "focus": "Both faces in focus, background soft bokeh"
  },
  "dialogue": [
    {
      "character": "Mrs. Pevensie",
      "text": "You must be brave for me, darling. I'll come for you... I promise.",
      "voice_id": "female-tianmei",
      "emotion": "sad"
    },
    {
      "character": "Lucy Pevensie",
      "text": "I will be, mother. I promise.",
      "voice_id": "female-shaonv",
      "emotion": "calm"
    }
  ],
  "audio": [
    {
      "type": "music",
      "description": "Sad orchestral music, slow swelling strings, emotional farewell atmosphere",
      "genre": "orchestral",
      "volume": 0.25
    }
  ]
}
```

Step 3: Use the image-generation skill to generate the reference image

Load the image-generation skill and generate a single reference image `narnia-farewell-scene-01.jpg` according to the skill.

Step 4: Use the generate.py script to generate the video
```bash
python /mnt/skills/public/video-generation/scripts/generate.py \
  --prompt-file /mnt/user-data/workspace/narnia-farewell-scene.json \
  --reference-images /mnt/user-data/outputs/narnia-farewell-scene-01.jpg \
  --output-file /mnt/user-data/outputs/narnia-farewell-scene-01.mp4 \
  --aspect-ratio 16:9
```
> Do NOT read the python file, just call it with the parameters.

## Output Handling

After generation:

- Videos are typically saved in `/mnt/user-data/outputs/`
- Share generated videos (come first) with user as well as generated image if applicable, using `present_files` tool
- Provide brief description of the generation result
- Offer to iterate if adjustments needed

## Notes

- Always use English for video prompts regardless of user's language
- Use Chinese for `narration` and `dialogue.text` when the target audience is Chinese-speaking
- JSON format ensures structured, parsable prompts
- Reference images enhance generation quality significantly
- Iterative refinement is normal for optimal results
- ffmpeg must be installed for audio merging; silent video is generated otherwise
- The script automatically generates fallback narration for simple prompts without `dialogue` or `narration`
