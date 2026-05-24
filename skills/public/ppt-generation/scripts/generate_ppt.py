#!/usr/bin/env python3
"""
PPT Generator - Generate PPT slide images using Google Gemini API.

This script generates PPT slide images based on a slide plan and style template,
then creates an HTML viewer for playback.

Based on NanoBanana-PPT-Skills v2.0 by 歸藏.
Adapted for KKOCLAW skill deployment with GEMINI_BASE_URL proxy support,
bug fixes and path improvements.
"""

import argparse
import base64
import io
import json
import os
import sys
import urllib.request
import urllib.error
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

# Ensure UTF-8 output for Chinese characters
if sys.stdout.encoding != 'utf-8':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
if sys.stderr.encoding != 'utf-8':
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

from dotenv import load_dotenv


# =============================================================================
# Constants
# =============================================================================

DEFAULT_RESOLUTION = "2K"
SCRIPT_DIR = Path(__file__).parent.resolve()
DEFAULT_TEMPLATE_PATH = str(SCRIPT_DIR / "viewer.html")
OUTPUT_BASE_DIR = "outputs"

# Gemini model name
GEMINI_MODEL = "gemini-3-pro-image-preview"


# =============================================================================
# Environment Configuration
# =============================================================================

def find_and_load_env() -> bool:
    """
    Find and load .env file from multiple locations.

    Search priority:
    1. Current script directory
    2. Parent directories up to project root (containing .git or .env)
    3. KKOCLAW project root .env
    4. System environment variables

    Returns:
        True if .env file was found and loaded, False otherwise.
    """
    current_dir = Path(__file__).parent
    env_locations = [
        current_dir / ".env",
        *[parent / ".env" for parent in current_dir.parents],
    ]

    for env_path in env_locations:
        if env_path.exists():
            load_dotenv(env_path, override=True)
            print(f"Loaded environment from: {env_path}")
            return True

        # Stop at project root if .git exists
        if env_path.parent != current_dir and (env_path.parent / ".git").exists():
            break

    # Fallback: try default loading from system environment
    load_dotenv(override=True)
    print("Warning: No .env file found, using system environment variables")
    return False


# =============================================================================
# Style Template
# =============================================================================

def load_style_template(style_path: str) -> str:
    """
    Load and parse style template file.

    Extracts the '## 基础提示词模板' section and everything after it,
    stopping at the next level-1 heading (# ) or end of file.

    Args:
        style_path: Path to the style template markdown file.

    Returns:
        Extracted base prompt template string.
    """
    with open(style_path, "r", encoding="utf-8") as f:
        content = f.read()

    # Find '## 基础提示词模板' section
    marker = "## 基础提示词模板"
    start_idx = content.find(marker)
    if start_idx == -1:
        print("Warning: Could not find '基础提示词模板' section, using full content")
        return content

    # Extract everything after this marker until the next level-1 heading or end of file
    section_content = content[start_idx + len(marker):]
    # Stop at next level-1 heading (# ) if exists
    next_h1 = section_content.find("\n# ")
    if next_h1 != -1:
        section_content = section_content[:next_h1]

    return section_content.strip()


# =============================================================================
# Prompt Generation
# =============================================================================

def generate_prompt(
    style_template: str,
    page_type: str,
    content_text: str,
    slide_number: int,
    total_slides: int,
) -> str:
    """
    Generate a prompt for a single slide.

    Args:
        style_template: Base style template text.
        page_type: Type of page (cover, data, content).
        content_text: Text content for the slide.
        slide_number: Current slide number (1-indexed).
        total_slides: Total number of slides.

    Returns:
        Complete prompt string for image generation.
    """
    prompt_parts = [style_template, "\n\n"]

    # Determine page type based on slide position or explicit type
    is_cover = page_type == "cover" or slide_number == 1
    is_data = page_type == "data" or slide_number == total_slides

    if is_cover:
        prompt_parts.append(
            f"""Please generate a cover page based on visual balance aesthetics.
Place a large complex 3D glass object in the center, overlaid with bold text:

{content_text}

Background with extended aurora waves."""
        )
    elif is_data:
        prompt_parts.append(
            f"""Please generate a data/summary page using split-screen design.
Left side: typeset the following text.
Right side: floating large glowing 3D data visualization:

{content_text}"""
        )
    else:
        prompt_parts.append(
            f"""Please generate a content page using Bento grid layout.
Organize the following content in modular rounded rectangle containers.
Container material must be frosted glass with blur effect:

{content_text}"""
        )

    return "".join(prompt_parts)


# =============================================================================
# Image Generation - Direct HTTP API (for custom base URL)
# =============================================================================

def _generate_slide_via_http(
    prompt: str,
    slide_number: int,
    output_dir: str,
    resolution: str = DEFAULT_RESOLUTION,
) -> Optional[str]:
    """
    Generate a slide using direct HTTP request to a custom Gemini endpoint.

    Used when GEMINI_BASE_URL is set to a custom proxy endpoint.
    The URL should be a full endpoint like:
    https://api.vectorengine.ai/v1beta/models/gemini-3-pro-image-preview:generateContent

    Args:
        prompt: The generation prompt.
        slide_number: Slide number for filename.
        output_dir: Output directory path.
        resolution: Image resolution (2K or 4K).

    Returns:
        Path to saved image, or None if generation failed.
    """
    api_key = os.environ.get("GEMINI_API_KEY")
    base_url = os.environ.get("GEMINI_BASE_URL", "")

    # Build request URL - append api key as query param if not already in URL
    url = base_url
    if "?" not in url:
        url = f"{url}?key={api_key}"

    # Build request body matching Gemini API format
    payload = {
        "contents": [
            {
                "parts": [
                    {"text": prompt}
                ]
            }
        ],
        "generationConfig": {
            "responseModalities": ["IMAGE"],
            "imageConfig": {
                "aspectRatio": "16:9",
                "imageSize": resolution,
            }
        }
    }

    req_data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=req_data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            response_data = json.loads(resp.read().decode("utf-8"))

        # Extract image from response
        for candidate in response_data.get("candidates", []):
            for part in candidate.get("content", {}).get("parts", []):
                if "inlineData" in part:
                    img_b64 = part["inlineData"]["data"]
                    img_bytes = base64.b64decode(img_b64)

                    image_path = os.path.join(output_dir, "images", f"slide-{slide_number:02d}.png")
                    with open(image_path, "wb") as f:
                        f.write(img_bytes)

                    print(f"  Slide {slide_number} saved: {image_path}")
                    return image_path

        print(f"  Slide {slide_number} failed: No image data received")
        return None

    except urllib.error.HTTPError as e:
        error_body = e.read().decode("utf-8", errors="replace")[:500]
        print(f"  Slide {slide_number} HTTP error {e.code}: {error_body}")
        return None
    except Exception as e:
        print(f"  Slide {slide_number} HTTP request failed: {e}")
        return None


# =============================================================================
# Image Generation - Google GenAI Client (standard)
# =============================================================================

def _get_gemini_client():
    """
    Initialize and return Gemini API client using google-genai library.

    Returns:
        Configured genai.Client instance.

    Raises:
        SystemExit: If google-genai is not installed or API key is missing.
    """
    try:
        from google import genai
    except ImportError:
        print("Error: google-genai library not installed")
        print("Please run: pip install google-genai")
        sys.exit(1)

    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        print("Error: GEMINI_API_KEY environment variable not set")
        print("Please set: export GEMINI_API_KEY='your-api-key'")
        sys.exit(1)

    # Check if custom base URL is configured
    base_url = os.environ.get("GEMINI_BASE_URL", "")
    if base_url:
        # Try to use http_options for custom endpoint
        try:
            from google.genai import types
            from urllib.parse import urlparse
            parsed = urlparse(base_url)
            client_base = f"{parsed.scheme}://{parsed.hostname}"
            return genai.Client(
                api_key=api_key,
                http_options=types.HttpOptions(base_url=client_base),
            )
        except Exception:
            return genai.Client(api_key=api_key)
    else:
        return genai.Client(api_key=api_key)


def _generate_slide_via_sdk(
    prompt: str,
    slide_number: int,
    output_dir: str,
    resolution: str = DEFAULT_RESOLUTION,
) -> Optional[str]:
    """
    Generate a slide using google-genai SDK.

    Args:
        prompt: The generation prompt.
        slide_number: Slide number for filename.
        output_dir: Output directory path.
        resolution: Image resolution (2K or 4K).

    Returns:
        Path to saved image, or None if generation failed.
    """
    from google.genai import types

    try:
        client = _get_gemini_client()
        response = client.models.generate_content(
            model=GEMINI_MODEL,
            contents=prompt,
            config=types.GenerateContentConfig(
                response_modalities=["IMAGE"],
                image_config=types.ImageConfig(
                    aspect_ratio="16:9",
                    image_size=resolution,
                ),
            ),
        )

        for part in response.parts:
            if part.inline_data is not None:
                image = part.as_image()
                image_path = os.path.join(output_dir, "images", f"slide-{slide_number:02d}.png")
                image.save(image_path)
                print(f"  Slide {slide_number} saved: {image_path}")
                return image_path

        print(f"  Slide {slide_number} failed: No image data received")
        return None

    except Exception as e:
        print(f"  Slide {slide_number} SDK call failed: {e}")
        return None


# =============================================================================
# Unified Slide Generation
# =============================================================================

def generate_slide(
    prompt: str,
    slide_number: int,
    output_dir: str,
    resolution: str = DEFAULT_RESOLUTION,
) -> Optional[str]:
    """
    Generate a single PPT slide image using Gemini API.
    Includes automatic retry logic (max 2 attempts).
    Supports custom GEMINI_BASE_URL for proxy endpoints.

    Args:
        prompt: The generation prompt.
        slide_number: Slide number for filename.
        output_dir: Output directory path.
        resolution: Image resolution (2K or 4K).

    Returns:
        Path to saved image, or None if generation failed.
    """
    print(f"Generating slide {slide_number}...")

    # Determine generation mode based on GEMINI_BASE_URL
    base_url = os.environ.get("GEMINI_BASE_URL", "")
    use_http_mode = bool(base_url)

    if use_http_mode:
        print(f"  Using custom endpoint: {base_url[:60]}...")

    max_retries = 2
    for attempt in range(max_retries):
        if use_http_mode:
            result = _generate_slide_via_http(prompt, slide_number, output_dir, resolution)
        else:
            result = _generate_slide_via_sdk(prompt, slide_number, output_dir, resolution)

        if result:
            return result

        print(f"  Slide {slide_number} attempt {attempt+1} failed")
        if attempt < max_retries - 1:
            print(f"  Retrying...")

    print(f"  Slide {slide_number} failed after {max_retries} attempts")
    return None


# =============================================================================
# Output Generation
# =============================================================================

def generate_viewer_html(
    output_dir: str,
    slide_count: int,
    template_path: str,
) -> str:
    """
    Generate HTML viewer for slides playback.

    Args:
        output_dir: Output directory path.
        slide_count: Total number of slides.
        template_path: Path to HTML template.

    Returns:
        Path to generated HTML file.
    """
    with open(template_path, "r", encoding="utf-8") as f:
        html_template = f.read()

    # Generate image list
    slides_list = [f"'images/slide-{i:02d}.png'" for i in range(1, slide_count + 1)]

    # Replace placeholder
    html_content = html_template.replace(
        "/* IMAGE_LIST_PLACEHOLDER */",
        ",\n            ".join(slides_list),
    )

    html_path = os.path.join(output_dir, "index.html")
    with open(html_path, "w", encoding="utf-8") as f:
        f.write(html_content)

    print(f"  Viewer HTML generated: {html_path}")
    return html_path


def save_prompts(output_dir: str, prompts_data: Dict[str, Any]) -> str:
    """
    Save all prompts to JSON file.

    Args:
        output_dir: Output directory path.
        prompts_data: Dictionary containing all prompts and metadata.

    Returns:
        Path to saved JSON file.
    """
    prompts_path = os.path.join(output_dir, "prompts.json")
    with open(prompts_path, "w", encoding="utf-8") as f:
        json.dump(prompts_data, f, ensure_ascii=False, indent=2)
    print(f"  Prompts saved: {prompts_path}")
    return prompts_path


# =============================================================================
# Main Entry Point
# =============================================================================

def create_argument_parser() -> argparse.ArgumentParser:
    """Create and configure argument parser."""
    parser = argparse.ArgumentParser(
        description="PPT Generator - Generate PPT images using Gemini API",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Example usage:
  python generate_ppt.py --plan slides_plan.json --style gradient-glass.md --resolution 2K

Environment variables:
  GEMINI_API_KEY: Google AI API key (required)
  GEMINI_BASE_URL: Custom API endpoint URL (optional, for proxy usage)
""",
    )

    parser.add_argument(
        "--plan",
        required=True,
        help="Path to slides plan JSON file (generated by Skill)",
    )
    parser.add_argument(
        "--style",
        required=True,
        help="Path to style template file",
    )
    parser.add_argument(
        "--resolution",
        choices=["2K", "4K"],
        default=DEFAULT_RESOLUTION,
        help=f"Image resolution (default: {DEFAULT_RESOLUTION})",
    )
    parser.add_argument(
        "--output",
        help="Output directory path (default: outputs/TIMESTAMP)",
    )
    parser.add_argument(
        "--template",
        default=DEFAULT_TEMPLATE_PATH,
        help=f"HTML template path (default: {DEFAULT_TEMPLATE_PATH})",
    )

    return parser


def main() -> None:
    """Main entry point for PPT generation."""
    # Load environment variables
    find_and_load_env()

    # Parse arguments
    parser = create_argument_parser()
    args = parser.parse_args()

    # Resolve relative paths relative to script directory
    for path_attr in ['plan', 'style', 'template']:
        path_val = getattr(args, path_attr, None)
        if path_val and not os.path.isabs(path_val):
            full_path = Path(path_val)
            if not full_path.exists():
                alt_path = SCRIPT_DIR / path_val
                if alt_path.exists():
                    setattr(args, path_attr, str(alt_path))
                    print(f"Resolved {path_attr}: {path_val} -> {alt_path}")

    # Load slides plan
    with open(args.plan, "r", encoding="utf-8") as f:
        slides_plan = json.load(f)

    # Load style template
    style_template = load_style_template(args.style)

    # Create output directory
    if args.output:
        output_dir = args.output
    else:
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        output_dir = f"{OUTPUT_BASE_DIR}/{timestamp}"

    os.makedirs(os.path.join(output_dir, "images"), exist_ok=True)

    # Print configuration
    slides = slides_plan["slides"]
    total_slides = len(slides)

    base_url = os.environ.get("GEMINI_BASE_URL", "")
    api_mode = f"Custom endpoint ({base_url[:40]}...)" if base_url else "Google GenAI SDK"

    print("=" * 60)
    print("PPT Generator Started")
    print("=" * 60)
    print(f"Style: {args.style}")
    print(f"Resolution: {args.resolution}")
    print(f"Slides: {total_slides}")
    print(f"API Mode: {api_mode}")
    print(f"Output: {output_dir}")
    print("=" * 60)
    print()

    # Initialize prompts data
    prompts_data: Dict[str, Any] = {
        "metadata": {
            "title": slides_plan.get("title", "Untitled Presentation"),
            "total_slides": total_slides,
            "resolution": args.resolution,
            "style": args.style,
            "generated_at": datetime.now().isoformat(),
        },
        "slides": [],
    }

    # Generate each slide
    for slide_info in slides:
        slide_number = slide_info["slide_number"]
        page_type = slide_info.get("page_type", "content")
        content_text = slide_info["content"]

        # Generate prompt
        prompt = generate_prompt(
            style_template,
            page_type,
            content_text,
            slide_number,
            total_slides,
        )

        # Generate image
        image_path = generate_slide(prompt, slide_number, output_dir, args.resolution)

        # Record prompt data
        prompts_data["slides"].append({
            "slide_number": slide_number,
            "page_type": page_type,
            "content": content_text,
            "prompt": prompt,
            "image_path": image_path,
        })

        print()

    # Save prompts
    save_prompts(output_dir, prompts_data)

    # Generate viewer HTML
    generate_viewer_html(output_dir, total_slides, args.template)

    # Print completion summary
    print()
    print("=" * 60)
    print("Generation Complete!")
    print("=" * 60)
    print(f"Output directory: {output_dir}")
    print(f"Viewer HTML: {os.path.join(output_dir, 'index.html')}")
    print()
    print("Open viewer in browser:")
    print(f"  open {os.path.join(output_dir, 'index.html')}")
    print()


if __name__ == "__main__":
    main()
