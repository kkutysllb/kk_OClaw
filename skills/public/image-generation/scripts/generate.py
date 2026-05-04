import base64
import mimetypes
import os

import requests
from PIL import Image

# MiniMax API base URL (domestic: api.minimaxi.com, international: api.minimax.io)
MINIMAX_API_BASE = os.getenv("MINIMAX_BASE_URL", "https://api.minimaxi.com").rstrip("/v1")


def validate_image(image_path: str) -> bool:
    """
    Validate if an image file can be opened and is not corrupted.
    
    Args:
        image_path: Path to the image file
        
    Returns:
        True if the image is valid and can be opened, False otherwise
    """
    try:
        with Image.open(image_path) as img:
            img.verify()  # Verify that it's a valid image
        # Re-open to check if it can be fully loaded (verify() may not catch all issues)
        with Image.open(image_path) as img:
            img.load()  # Force load the image data
        return True
    except Exception as e:
        print(f"Warning: Image '{image_path}' is invalid or corrupted: {e}")
        return False


def _get_mime_type(file_path: str) -> str:
    """Detect MIME type from file path, defaulting to image/jpeg."""
    mime_type, _ = mimetypes.guess_type(file_path)
    if mime_type and mime_type.startswith("image/"):
        return mime_type
    return "image/jpeg"


def generate_image(
    prompt_file: str,
    reference_images: list[str],
    output_file: str,
    aspect_ratio: str = "16:9",
) -> str:
    with open(prompt_file, "r", encoding="utf-8") as f:
        prompt = f.read()

    api_key = os.getenv("MINIMAX_API_KEY")
    if not api_key:
        return "MINIMAX_API_KEY is not set"

    # Build request body
    request_body: dict = {
        "model": "image-01",
        "prompt": prompt,
        "aspect_ratio": aspect_ratio,
        "response_format": "base64",
        "n": 1,
        "prompt_optimizer": False,
    }

    # Add reference images as subject_reference (image-to-image)
    valid_reference_images = []
    for ref_img in reference_images:
        if validate_image(ref_img):
            valid_reference_images.append(ref_img)
        else:
            print(f"Skipping invalid reference image: {ref_img}")

    if len(valid_reference_images) < len(reference_images):
        print(
            f"Note: {len(reference_images) - len(valid_reference_images)} "
            f"reference image(s) were skipped due to validation failure."
        )

    if valid_reference_images:
        subject_refs = []
        for ref_img in valid_reference_images:
            mime_type = _get_mime_type(ref_img)
            with open(ref_img, "rb") as f:
                image_b64 = base64.b64encode(f.read()).decode("utf-8")
            subject_refs.append({
                "type": "character",
                "image_file": f"data:{mime_type};base64,{image_b64}",
            })
        request_body["subject_reference"] = subject_refs

    response = requests.post(
        f"{MINIMAX_API_BASE}/v1/image_generation",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        json=request_body,
    )
    response.raise_for_status()
    result = response.json()

    # Check MiniMax error code
    base_resp = result.get("base_resp", {})
    if base_resp.get("status_code") != 0:
        raise Exception(
            f"MiniMax API error (code={base_resp.get('status_code')}): "
            f"{base_resp.get('status_msg', 'unknown error')}"
        )

    # Extract base64 image data
    data = result.get("data", {})
    image_base64_list = data.get("image_base64", [])
    if image_base64_list:
        base64_image = image_base64_list[0]
        with open(output_file, "wb") as f:
            f.write(base64.b64decode(base64_image))
        return f"Successfully generated image to {output_file}"
    else:
        raise Exception(
            f"Failed to generate image: no image data in response. "
            f"Response keys: {list(result.keys())}"
        )


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Generate images using MiniMax API")
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
        help="Output path for generated image",
    )
    parser.add_argument(
        "--aspect-ratio",
        required=False,
        default="16:9",
        help="Aspect ratio of the generated image",
    )

    args = parser.parse_args()

    try:
        print(
            generate_image(
                args.prompt_file,
                args.reference_images,
                args.output_file,
                args.aspect_ratio,
            )
        )
    except Exception as e:
        print(f"Error while generating image: {e}")
