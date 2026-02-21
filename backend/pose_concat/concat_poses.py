# backend/pose_concat/concat_poses.py
from __future__ import annotations

import itertools
import operator
from pathlib import Path
from typing import List

import numpy as np
import tensorflow as tf

from pose_format import Pose
from pose_format.pose_visualizer import PoseVisualizer
from spoken_to_signed.gloss_to_pose.concatenate import (
    reduce_holistic,
    normalize_pose,
    smooth_concatenate_poses,
    correct_wrists,
    trim_pose,
)

from .modified_trim_pose import list_components

# =========================================================
# 0) Load pretrained trim model (pose-detector.hdf5)
# =========================================================
# โครงสร้างของเธอ:
# backend/
#   pose_concat/
#     models/pose-detector.hdf5
#     concat_poses.py
MODEL_PATH = (Path(__file__).resolve().parent / "models" / "pose-detector.hdf5").resolve()

if not MODEL_PATH.exists():
    raise FileNotFoundError(
        f"❌ pose-detector model not found: {MODEL_PATH}\n"
        f"➡️ ตรวจสอบว่าไฟล์อยู่ที่: backend/pose_concat/models/pose-detector.hdf5"
    )

# โหลด model ครั้งเดียวตอน import
model = tf.keras.models.load_model(str(MODEL_PATH))


# =========================================================
# 1) Trim function (modified)  ✅ FIX: Keras input type
# =========================================================
def thsl_trim_pose(
    pose: Pose,
    model: tf.keras.Model,
    start: bool = True,
    end: bool = True,
    frame_padding: int = 5,
) -> Pose:
    """
    ตัดเฟรมช่วง "รอ" ออกจากต้น/ท้ายของ pose
    โดยใช้โมเดล binary classifier (0=waiting, 1=signing)
    """
    if pose is None or pose.body is None or pose.body.data is None:
        return pose
    if len(pose.body.data) <= 1:
        return pose

    df, _ = list_components(pose, normalize=False)

    # ✅ สำคัญ: อย่าใช้ tolist() ส่งเข้า keras (บางเวอร์ชันจะ error)
    # ให้เป็น numpy float32 เสมอ
    X = np.asarray(df.values, dtype=np.float32)

    # กัน shape แปลก ๆ (เผื่อ df ออกมาเป็น 1D)
    if X.ndim == 1:
        X = X.reshape(-1, 1)

    start_index = 0
    end_index = len(pose.body.data) - 1

    # predict -> (n,) หรือ (n,1)
    pred = model.predict(X, verbose=0)
    pred = np.asarray(pred).reshape(-1)
    pred = (pred >= 0.5).astype(np.int32)

    # หา segment 0 (waiting) ที่ยาวที่สุด
    try:
        r = max(
            (
                list(y)
                for (x, y) in itertools.groupby(enumerate(pred), operator.itemgetter(1))
                if x == 0
            ),
            key=len,
        )
    except ValueError:
        # ไม่มี 0 เลย -> ไม่ trim
        return pose

    if start:
        start_index = r[0][0] + frame_padding
    if end:
        end_index = r[-1][0] - frame_padding

    start_index = max(0, start_index)
    end_index = min(len(pose.body.data), end_index)

    # กัน trim เพี้ยน: ถ้าตัดแล้วเหลือเยอะผิดปกติ ใช้ของเดิมใน lib แทน
    minimum_require = np.floor(0.95 * len(pose.body.data))
    if (end_index - start_index) > minimum_require:
        return trim_pose(pose, start, end)

    if end_index <= start_index:
        return pose

    pose.body.data = pose.body.data[start_index:end_index]
    pose.body.confidence = pose.body.confidence[start_index:end_index]
    return pose


# =========================================================
# 2) Concatenate poses
# =========================================================
def modified_concatenate_poses(poses: List[Pose], model: tf.keras.Model) -> Pose:
    """
    รวม pose หลายคำให้เป็น pose เดียว
    - reduce_holistic
    - normalize_pose
    - trim waiting frames (thsl_trim_pose)
    - smooth concatenate
    - correct wrists
    - scale
    """
    if not poses:
        raise ValueError("poses list is empty")

    # 1) reduce + normalize
    poses = [reduce_holistic(p) for p in poses]
    poses = [normalize_pose(p) for p in poses]

    # 2) trim (คำแรก/คำท้าย ตัดด้านหนึ่งน้อยกว่า)
    trimmed: List[Pose] = []
    for i, p in enumerate(poses):
        trimmed.append(thsl_trim_pose(p, model, start=(i > 0), end=(i < len(poses) - 1)))
    poses = trimmed

    # 3) smooth concatenate
    pose = smooth_concatenate_poses(poses)

    # 4) correct wrists
    pose = correct_wrists(pose)

    # 5) scale
    new_width = 500
    shift = 1.25
    shift_vec = np.full(shape=(pose.body.data.shape[-1],), fill_value=shift, dtype=np.float32)
    pose.body.data = (pose.body.data + shift_vec) * new_width
    pose.header.dimensions.height = pose.header.dimensions.width = int(new_width * shift * 2)

    return pose


# =========================================================
# 3) Export video (robust)
# =========================================================
def pose_sequence(
    pose_list: List[Pose],
    output_path: str = "quick_test.mp4",
    fps: int = 24,
) -> str:
    """
    รวม pose หลายคำ แล้ว export เป็น mp4
    """
    if not pose_list:
        raise ValueError("pose_list is empty")

    out = Path(output_path).expanduser().resolve()
    out.parent.mkdir(parents=True, exist_ok=True)

    # 1) concatenate
    p = modified_concatenate_poses(pose_list, model)

    # 2) resize back (เหมือนของเดิม)
    scale = p.header.dimensions.width / 256
    if scale:
        p.header.dimensions.width = int(p.header.dimensions.width / scale)
        p.header.dimensions.height = int(p.header.dimensions.height / scale)
        p.body.data = p.body.data / scale

    # 3) export mp4
    v = PoseVisualizer(p)

    # ✅ บางเวอร์ชัน draw() เป็น generator -> แปลงเป็น list
    frames = list(v.draw())

    # ✅ บางเวอร์ชัน save_video ไม่รับ fps=
    try:
        v.save_video(str(out), frames, fps=fps)
    except TypeError:
        v.save_video(str(out), frames)

    return str(out)
