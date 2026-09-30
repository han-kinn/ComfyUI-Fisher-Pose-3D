"""Free-pose mode: VNCCS Pose Studio LoRA convention for Qwen Image 2.1.

The VNCCS_QI2_PoseStudio LoRA was trained with the mannequin render as image1,
the character photo as image2 and the fixed instruction below, so this node
keeps that order and wording for legacy single-character scenes. Multi-character
scenes bind numbered mannequins to up to five references via Qwen's multi-image input.
"""
import json
import numpy as np
import torch

from .pose_reference import reference_image

VNCCS_INSTRUCTION = "Draw character from image2"


def free_pose_prompt(extra=""):
    lines = [VNCCS_INSTRUCTION] + [line.strip() for line in str(extra or "").splitlines()]
    return "\n".join(line for line in lines if line)


def mannequin_tensor(pose_json):
    # The mannequin keeps the size chosen in the editor; the node's width/height only set the output latent.
    return torch.from_numpy(np.asarray(reference_image(pose_json)).astype(np.float32) / 255).unsqueeze(0)


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
        }, "optional": {"reference_image": ("IMAGE",), **{f"reference_image_{slot}": ("IMAGE",) for slot in range(2, 6)}}}

    RETURN_TYPES = ("CONDITIONING", "CONDITIONING", "LATENT", "STRING", "IMAGE")
    RETURN_NAMES = ("正向", "负向", "latent", "实际提示词", "人偶姿态图")
    FUNCTION = "encode"
    CATEGORY = "Fisher P3D/姿态与机位"
    DESCRIPTION = "支持1–5个独立角色；reference_image 对应角色1，reference_image_2–5 对应角色2–5。只需连接已添加角色的参考图。单人保留 VNCCS 指令；多人编号参考图绑定为实验性生成能力。节点 width/height 决定输出尺寸，编辑器设置人偶图尺寸。"

    def encode(self, clip, vae, reference_image=None, width=1024, height=1024, reference_resolution=1024, extra_prompt="", pose_json="{}",
               reference_image_2=None, reference_image_3=None, reference_image_4=None, reference_image_5=None):
        if width % 16 or height % 16:
            raise ValueError("Qwen 输出宽高须为16的倍数，请调整节点的 width/height。")
        saved = json.loads(pose_json)
        characters = saved.get("characters", [{"slot": 1}])
        slots = [character.get("slot") for character in characters]
        if not slots or len(slots) > 5 or any(type(slot) is not int or slot not in range(1, 6) for slot in slots) or len(set(slots)) != len(slots):
            raise ValueError("角色数据无效，请重新打开编辑器并应用到节点。")
        references = [reference_image, reference_image_2, reference_image_3, reference_image_4, reference_image_5]
        images = {"image_1": mannequin_tensor(pose_json)}
        bindings = []
        for slot in sorted(slots):
            image = references[slot - 1]
            if image is None or image.ndim != 4 or image.shape[0] != 1:
                raise ValueError(f"角色{slot}需要连接对应参考图{slot}，且必须是单张图片。")
            index = len(images) + 1
            images[f"image_{index}"] = image
            bindings.append(f"Replace mannequin labeled {slot} in <image1> with the character from <image{index}>; preserve that mannequin's pose, position and scale.")
        mannequin = images["image_1"]
        prompt = free_pose_prompt(extra_prompt) if slots == [1] else "\n".join([
            "Use <image1> as the composition and pose guide.", *bindings,
            "Keep each character's identity separate. Remove all numeric labels in the final image. Do not add extra people.",
            str(extra_prompt or "").strip(),
        ]).strip()
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
