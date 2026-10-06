"""Free-pose mode: VNCCS Pose Studio LoRA convention for Qwen Image 2.1.

The VNCCS_QI2_PoseStudio LoRA was trained with the mannequin render as image1,
the character photo as image2 and the fixed instruction below, so this node
keeps that order and wording for legacy single-character scenes. Multi-character
scenes bind numbered mannequins to up to five references via Qwen's multi-image input.
"""
import json
import math
import numpy as np
import torch
from PIL import Image, ImageDraw, ImageFont

from .pose_reference import reference_image

ROLE_COLOR_NAMES = ("orange", "green", "purple", "sky-blue", "vermilion")

VNCCS_INSTRUCTION = "Draw character from image2"


def free_pose_prompt(extra=""):
    lines = [VNCCS_INSTRUCTION] + [line.strip() for line in str(extra or "").splitlines()]
    return "\n".join(line for line in lines if line)


def mannequin_tensor(pose_json):
    # The mannequin keeps the size chosen in the editor; the node's width/height only set the output latent.
    return torch.from_numpy(np.asarray(reference_image(pose_json)).astype(np.float32) / 255).unsqueeze(0)


def identity_reference(image, slot):
    """Add an identity banner outside the photo; preserve all original pixels."""
    height, width, channels = image.shape[1:]
    band = max(48, round(height * 0.08))
    colors = ('#f4d6a0', '#a8dbc2', '#d9bbdd')
    header = Image.new('RGB', (width, band), colors[slot - 1])
    draw = ImageDraw.Draw(header)
    font = ImageFont.load_default(size=max(12, min(band // 2, width // 18)))
    draw.text((width // 2, band // 2), f'CHARACTER {slot} ONLY', font=font, fill='#17213b', anchor='mm')
    banner = torch.from_numpy(np.array(header).copy()).to(device=image.device, dtype=image.dtype).div(255).unsqueeze(0)
    if channels == 4:
        banner = torch.cat((banner, torch.ones_like(banner[..., :1])), dim=-1)
    return torch.cat((banner, image), dim=1)


class FisherQwenFreePose:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "clip": ("CLIP",), "vae": ("VAE",),
            "width": ("INT", {"default": 1024, "min": 64, "max": 4096, "step": 16}),
            "height": ("INT", {"default": 1024, "min": 64, "max": 4096, "step": 16}),
            "reference_resolution": ("INT", {"default": 1024, "min": 256, "max": 2048, "step": 32}),
            "extra_prompt": ("STRING", {"default": "", "multiline": True}),
            "pose_json": ("STRING", {"default": "{}", "multiline": True}),
        }, "optional": {"reference_image": ("IMAGE",), **{f"reference_image_{slot}": ("IMAGE",) for slot in range(2, 4)}, "background_image": ("IMAGE",)}}

    RETURN_TYPES = ("CONDITIONING", "CONDITIONING", "LATENT", "STRING", "IMAGE")
    RETURN_NAMES = ("正向", "负向", "latent", "实际提示词", "人偶姿态图")
    FUNCTION = "encode"
    CATEGORY = "Fisher P3D/姿态与机位"
    DESCRIPTION = "支持1–3个独立角色；reference_image 对应角色1，reference_image_2–3 对应角色2–3。只需连接已添加角色的参考图。单人保留 VNCCS 指令；多人编号参考图绑定为实验性生成能力。节点 width/height 决定输出尺寸，编辑器设置人偶图尺寸。"

    def encode(self, clip, vae, reference_image=None, width=1024, height=1024, reference_resolution=1024, extra_prompt="", pose_json="{}",
               reference_image_2=None, reference_image_3=None, background_image=None):
        if width % 16 or height % 16:
            raise ValueError("Qwen 输出宽高须为16的倍数，请调整节点的 width/height。")
        saved = json.loads(pose_json)
        characters = saved.get("characters", [{"slot": 1}])
        slots = [character.get("slot") for character in characters]
        if not slots or len(slots) > 3 or any(type(slot) is not int or slot not in range(1, 4) for slot in slots) or len(set(slots)) != len(slots):
            raise ValueError("角色数据无效，请重新打开编辑器并应用到节点。")
        references = [reference_image, reference_image_2, reference_image_3]
        images = {"image_1": mannequin_tensor(pose_json)}
        bindings = []
        for slot in sorted(slots):
            image = references[slot - 1]
            if image is None or image.ndim != 4 or image.shape[0] != 1:
                raise ValueError(f"角色{slot}需要连接对应参考图{slot}，且必须是单张图片。")
            index = len(images) + 1
            images[f"image_{index}"] = identity_reference(image, slot) if len(slots) > 1 else image
            bindings.append(f"Replace mannequin labeled {slot} in <image1> with the character from <image{index}>; preserve that mannequin's pose, position and scale.")
            if saved.get("roleColorBadges") == 1:
                bindings[-1] += f" The {ROLE_COLOR_NAMES[slot - 1]} badge identifies this mannequin only."
            elif saved.get("roleColorBadges") == 2:
                bindings[-1] += f" The {ROLE_COLOR_NAMES[slot - 1]} mannequin and matching badge identify this role only."
            if len(slots) > 1:
                bindings[-1] += f" The reference photo carries the matching CHARACTER {slot} ONLY banner. Use this identity for mannequin {slot} only, never for any other mannequin. If the reference shows multiple views, they describe one person, not extra people."
            anchors = saved.get("roleAnchors", {})
            point = anchors.get(str(slot)) if isinstance(anchors, dict) else None
            if isinstance(point, list) and len(point) == 2 and all(type(v) in (int,float) and math.isfinite(v) and 0 <= v <= 1 for v in point):
                bindings[-1] += f" This mannequin is centered at approximately ({math.floor(point[0]*100+0.5)}%, {math.floor(point[1]*100+0.5)}%) of the pose guide, measured from its top-left corner."
        mannequin = images["image_1"]
        prompt = free_pose_prompt(extra_prompt) if slots == [1] else "\n".join([
            "Use <image1> as the composition and pose guide.", *bindings,
            "Match each reference only to its explicitly assigned numbered mannequin. Do not infer identity from left-to-right position. Do not swap identities between mannequins. Copy the target mannequin's head, torso, arm and leg directions rather than the reference photo's pose. Keep each character's identity separate. Remove all numeric labels, color badges and CHARACTER banners in the final image. Use appearance and clothing colors from the reference photos, not the identification colors. Do not add extra people.",
            str(extra_prompt or "").strip(),
        ]).strip()
        if slots == [1] and saved.get("roleColorBadges") == 2:
            prompt = "\n".join([VNCCS_INSTRUCTION,
                "The orange mannequin identifies role 1 only. Use skin and clothing colors from image2, not the mannequin identification color.",
                str(extra_prompt or "").strip()]).strip()
        if background_image is not None:
            if background_image.ndim != 4 or background_image.shape[0] != 1:
                raise ValueError("背景参考图必须是单张图片。")
            background_index = len(images) + 1
            images[f"image_{background_index}"] = background_image
            prompt += f"\nUse <image{background_index}> as the background environment. Preserve its scenery and perspective behind the characters. This current background reference overrides any background visible in <image1>; do not copy the pose guide background. Do not treat it as a character reference."
        try:
            from comfy_extras.nodes_qwen import TextEncodeQwenImage21
        except ImportError as error:
            raise RuntimeError("此节点需要包含 TextEncodeQwenImage21 的新版 ComfyUI。") from error
        result = TextEncodeQwenImage21.execute(clip=clip, prompt=prompt, negative_prompt="", vae=vae,
                    resolution=reference_resolution, images=images)
        positive, negative, encoded_latent = result.result
        # Output size comes from the node, independent of the mannequin (the encoder would size it from image1).
        latent = {"samples": encoded_latent["samples"].new_zeros((1, 64, height // 16, width // 16))}
        return {"ui": {"fisher_3d_prompt": [prompt]}, "result": (positive, negative, latent, prompt, mannequin)}
