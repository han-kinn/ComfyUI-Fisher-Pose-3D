import base64
import importlib.util
import io
import json
from pathlib import Path
import sys
import unittest

from PIL import Image
import torch

ROOT = Path(__file__).resolve().parent.parent  # plugin root
spec = importlib.util.spec_from_file_location("fisher_test", ROOT / "__init__.py", submodule_search_locations=[str(ROOT)])
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)
from fisher_test.free_pose import FisherQwenFreePose, free_pose_prompt, identity_reference


class RecordingClip:
    def __init__(self):
        self.calls = []

    def tokenize(self, prompt, **kwargs):
        self.calls.append((prompt, kwargs))
        return prompt

    def encode_from_tokens_scheduled(self, tokens):
        return [[torch.zeros(1, 1, 1), {}]]


class DummyVae:
    def encode(self, image):
        return torch.zeros(1, 64, image.shape[1] // 16, image.shape[2] // 16)


def pose_json(size=(512, 768), color=(255, 255, 255)):
    buffer = io.BytesIO()
    Image.new('RGB', size, color).save(buffer, format='PNG')
    return json.dumps({'version': 1, 'poseReference': 'data:image/png;base64,' + base64.b64encode(buffer.getvalue()).decode()})


class FreePoseTests(unittest.TestCase):
    def args(self, **overrides):
        args = dict(clip=RecordingClip(), vae=DummyVae(), reference_image=torch.full((1, 64, 48, 3), .2),
                    width=512, height=768, reference_resolution=256, extra_prompt='', pose_json=pose_json())
        args.update(overrides)
        return args

    def test_vnccs_order_prompt_and_latent(self):
        args = self.args()
        positive, negative, latent, prompt, mannequin = FisherQwenFreePose().encode(**args)['result']
        self.assertEqual(prompt, 'Draw character from image2')
        calls = args['clip'].calls
        self.assertEqual(calls[0][0], prompt)
        self.assertEqual(calls[1][0], '')
        images = calls[0][1]['images']
        self.assertEqual(len(images), 2)
        self.assertAlmostEqual(float(images[0].mean()), 1.0, places=3)  # mannequin first
        self.assertAlmostEqual(float(images[1].mean()), .2, delta=1 / 255)  # character second
        self.assertEqual(tuple(latent['samples'].shape), (1, 64, 48, 32))
        self.assertEqual(tuple(mannequin.shape), (1, 768, 512, 3))
        self.assertIn('reference_latents', positive[0][1])

    def test_output_size_is_independent_of_mannequin_size(self):
        # Mannequin 1024x1024 from the editor, output 16:9 from a resolution selector.
        args = self.args(pose_json=pose_json((1024, 1024), (100, 100, 100)), width=1920, height=1088)
        positive, negative, latent, prompt, mannequin = FisherQwenFreePose().encode(**args)['result']
        self.assertEqual(tuple(mannequin.shape), (1, 1024, 1024, 3))
        encoded = args['clip'].calls[0][1]['images'][0]
        self.assertEqual(encoded.shape[1], encoded.shape[2])  # still square: not padded or stretched to 16:9
        self.assertEqual(tuple(latent['samples'].shape), (1, 64, 68, 120))

    def test_extra_prompt_follows_instruction(self):
        self.assertEqual(free_pose_prompt('  red dress \n\n studio light '), 'Draw character from image2\nred dress\nstudio light')

    def test_three_references_and_stable_sparse_slots(self):
        for slots in ([1, 2, 3], [2, 3], [2, 3, 1], [3, 1, 2]):
            saved = json.loads(pose_json())
            saved['characters'] = [{'slot': slot} for slot in slots]
            saved['roleAnchors'] = {'2':[0.5,0.8], '3':[0.8,0.5]}
            refs = {f'reference_image_{slot}': torch.full((1, 32, 32, 3), slot / 10) for slot in range(2, 4)}
            args = self.args(pose_json=json.dumps(saved), **refs)
            if 1 not in slots: args['reference_image'] = None
            result = FisherQwenFreePose().encode(**args)['result']
            images = args['clip'].calls[0][1]['images']
            self.assertIn('(50%, 80%)', result[3])
            self.assertIn('(80%, 50%)', result[3])
            self.assertEqual(len(images), 1 + len(slots))
            for index, slot in enumerate(sorted(slots), 2):
                self.assertIn(f'labeled {slot} in <image1> with the character from <image{index}>', result[3])
                self.assertAlmostEqual(float(images[index - 1][:, -16:].mean()), .2 if slot == 1 else slot / 10, delta=0.02)

    def test_identity_banner_preserves_photo_pixels_and_slot_color(self):
        for channels in (3,4):
            image=torch.rand(1,96,72,channels)
            original=image.clone()
            for slot in (1,2,3):
                tagged=identity_reference(image,slot)
                self.assertTrue(torch.equal(tagged[:,-96:],original))
                self.assertTrue(torch.equal(image,original))
                self.assertEqual(tagged.shape[-1],channels)
            self.assertFalse(torch.equal(identity_reference(image,2)[:,:48],identity_reference(image,3)[:,:48]))

    def test_color_badges_only_for_new_saved_guides(self):
        for version in (None, 1, 2):
            saved = json.loads(pose_json())
            saved['characters'] = [{'slot': 2}, {'slot': 3}]
            if version: saved['roleColorBadges'] = version
            args = self.args(pose_json=json.dumps(saved), reference_image=None,
                             reference_image_2=torch.zeros(1,32,32,3),
                             reference_image_3=torch.zeros(1,32,32,3))
            prompt = FisherQwenFreePose().encode(**args)['result'][3]
            self.assertEqual('green badge identifies' in prompt, version == 1)
            self.assertEqual('purple badge identifies' in prompt, version == 1)
            self.assertEqual('green mannequin and matching badge' in prompt, version == 2)
            self.assertEqual('purple mannequin and matching badge' in prompt, version == 2)
            self.assertIn('Use appearance and clothing colors from the reference photos', prompt)

    def test_background_is_last_reference_and_has_separate_instruction(self):
        for slots in ([1], [2, 3]):
            saved = json.loads(pose_json()); saved['characters'] = [{'slot': x} for x in slots]
            args = self.args(pose_json=json.dumps(saved),
                reference_image_2=torch.zeros(1,32,32,3), reference_image_3=torch.zeros(1,32,32,3),
                background_image=torch.full((1,32,32,3), 0.8))
            result = FisherQwenFreePose().encode(**args)['result']
            self.assertIn(f'Use <image{len(slots)+2}> as the background environment', result[3])
            images = args['clip'].calls[0][1]['images']
            self.assertEqual(len(images), len(slots)+2)
            self.assertAlmostEqual(float(images[-1].mean()), .8, delta=1/255)
        inputs = FisherQwenFreePose.INPUT_TYPES()['optional']
        self.assertEqual(set(inputs), {'reference_image','reference_image_2','reference_image_3','background_image'})
        for invalid in (torch.zeros(2,32,32,3), torch.zeros(32,32,3)):
            with self.assertRaises(ValueError):
                FisherQwenFreePose().encode(**self.args(background_image=invalid))

    def test_missing_role_reference_and_duplicate_slots_fail(self):
        for slots in ([1, 3], [1, 1], [4], [5], [6], []):
            saved = json.loads(pose_json()); saved['characters'] = [{'slot': slot} for slot in slots]
            saved['roleAnchors'] = {'2':[0.5,0.8], '3':[0.8,0.5]}
            args = self.args(pose_json=json.dumps(saved))
            with self.assertRaises(ValueError): FisherQwenFreePose().encode(**args)
            self.assertEqual(args['clip'].calls, [])

    def test_invalid_inputs_do_not_encode(self):
        cases = [
            self.args(pose_json='{}'),
            self.args(width=520),
            self.args(reference_image=torch.zeros(2, 64, 64, 3)),
        ]
        for args in cases:
            with self.subTest(), self.assertRaises(ValueError):
                FisherQwenFreePose().encode(**args)
            self.assertEqual(args['clip'].calls, [])


class OpenPoseLibraryTests(unittest.TestCase):
    def test_list_and_clear_only_touch_library_images(self):
        import tempfile
        from fisher_test.openpose_library import LIBRARY_SUBFOLDER, clear_library, list_library
        with tempfile.TemporaryDirectory() as root:
            self.assertEqual(list_library(root), [])
            folder = Path(root) / LIBRARY_SUBFOLDER
            folder.mkdir(parents=True)
            for name in ('b.png', 'a.JPG', 'notes.txt'):
                (folder / name).write_bytes(b'x')
            (Path(root) / 'outside.png').write_bytes(b'x')
            self.assertEqual(list_library(root), ['a.JPG', 'b.png'])
            self.assertEqual(clear_library(root), 2)
            self.assertEqual(sorted(p.name for p in folder.iterdir()), ['notes.txt'])
            self.assertTrue((Path(root) / 'outside.png').exists())

    def test_builtin_gallery_is_numbered(self):
        from fisher_test.openpose_library import list_builtin
        names = list_builtin()
        self.assertEqual(len(names), 209)
        self.assertEqual(names[:3], ['1.png', '2.png', '3.png'])
        self.assertEqual(names[-1], '209.png')


if __name__ == '__main__':
    # Pass the ComfyUI directory explicitly; no model weights are loaded.
    sys.path.insert(0, sys.argv[1])
    sys.argv = [sys.argv[0], '--cpu']
    from comfy_extras.nodes_qwen import TextEncodeQwenImage21
    sys.argv = [sys.argv[0]]
    unittest.main()
