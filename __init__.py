from .nodes import FisherPoseStudio
from .qwen_bridge import FisherQwenPose
from .gguf_clip import FisherQwen21GGUFCLIP
from .free_pose import FisherQwenFreePose
from .openpose_library import register_routes
from .duf_library import register_routes as register_duf_routes

register_routes()
register_duf_routes()

# Separate IDs allow the original Fisher Pose and this package to coexist.
NODE_CLASS_MAPPINGS = {
    "Fisher3DPoseStudio": FisherPoseStudio,
    "Fisher3DQwenPose": FisherQwenPose,
    "Fisher3DQwenFreePose": FisherQwenFreePose,
    "Fisher3DQwen21GGUFCLIP": FisherQwen21GGUFCLIP,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "Fisher3DPoseStudio": "Fisher 机位与姿态（3D）",
    "Fisher3DQwenPose": "Fisher Qwen2.1 人物与姿态编码（3D）",
    "Fisher3DQwenFreePose": "Fisher Qwen2.1 自由姿势（3D）",
    "Fisher3DQwen21GGUFCLIP": "Fisher Qwen2.1 GGUF CLIP加载器（3D）",
}
WEB_DIRECTORY = "./web"
__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
