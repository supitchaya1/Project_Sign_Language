# pip install spoken-to-signed
# pip install pose-format
from tensorflow import keras
from tensorflow.keras import layers
from tensorflow.keras.layers import TextVectorization

import keras as keras2
from tensorflow.keras.models import Model, Sequential
from tensorflow.keras.layers import Dense
from spoken_to_signed.gloss_to_pose.concatenate import concatenate_poses, reduce_holistic, normalize_pose, smooth_concatenate_poses, correct_wrists, trim_pose
from typing import List
from pose_format import Pose
from pose_format.utils.holistic import BODY_POINTS
from pose_format.pose_visualizer import PoseVisualizer
from modified_trim_pose import list_components
import itertools,operator
import numpy as np
import tensorflow as tf

## Modified Trim function
model = Sequential()
model.add(Dense(120, input_shape=(120,), activation="relu"))
model.add(Dense(60, activation="relu"))
model.add(Dense(1, activation="sigmoid"))
model.summary()


## Load Pretrained model
model = tf.keras.models.load_model('models/pose-detector.hdf5')
# type(model)

def thsl_trim_pose(pose, model: keras2.src.engine.sequential.Sequential, 
                   start=True, end=True, frame_padding=5) -> Pose:
    """
    This function trims out the waiting pose frames.

    Parameters:
        :param Pose pose: a pose file to be trimmed
        :param keras2.src.engine.sequential.Sequential model: the binary classifier model
        :param bool start: Is it a beginning pose in a sentence?
        :param bool end: Is it an ending pose in a sentence?
        :param int frame_padding: number of frames to be padded

    Returns: 
        :return: a trimmed pose
        :rtype: Pose
    """
    
    if len(pose.body.data)-1 == 0:
        return pose

    df, _ = list_components(pose, False)
    df_list = df.values.tolist()
    
    start_index = 0
    end_index = len(pose.body.data)-1

    data = model.predict(df_list)
    data = np.array([1 if x >= 0.5 else 0 for x in data])
    
    r = max((list(y) for (x,y) in itertools.groupby((enumerate(data)),operator.itemgetter(1)) if x == 0), key=len)
    if start == True:
        start_index = r[0][0] + frame_padding
    if end == True:
        end_index = r[-1][0] - frame_padding

    minimum_require = np.floor(0.95 * len(pose.body.data))
    if (end_index - start_index) > minimum_require:
        pose = trim_pose(pose, start, end)
        return pose

    print(start_index, end_index, start, end)
    pose.body.data = pose.body.data[start_index:end_index]
    pose.body.confidence = pose.body.confidence[start_index:end_index]
    return pose

def modified_concatenate_poses(poses: List[Pose], model: keras2.src.engine.sequential.Sequential) -> Pose:
    """
    This function concatenates the pose together, and is integrated with the new trim pose function

    Parameters:
        :param List[Pose] poses: a list of pose data to concatenate them together
        :param keras2.src.engine.sequential.Sequential model: the binary classifier model

    Returns: 
        :return: concatenated pose
        :rtype: Pose
    """
    print('Reducing poses...')
    poses = [reduce_holistic(p) for p in poses]

    print('Normalizing poses...')
    poses = [normalize_pose(p) for p in poses]

    # Trim the poses to only include the parts where the pose is the gloss
    print('Trimming poses...')
    poses = [thsl_trim_pose(p, model, i > 0, i < len(poses) - 1) for i, p in enumerate(poses)]

    # Concatenate all poses
    print('Smooth concatenating poses...')
    pose = smooth_concatenate_poses(poses)

    # Correct the wrists (should be after smoothing)
    print('Correcting wrists...')
    pose = correct_wrists(pose)

    # Scale the newly created pose
    print('Scaling pose...')
    new_width = 500
    shift = 1.25
    shift_vec = np.full(shape=(pose.body.data.shape[-1]), fill_value=shift, dtype=np.float32)
    pose.body.data = (pose.body.data + shift_vec) * new_width
    pose.header.dimensions.height = pose.header.dimensions.width = int(new_width * shift * 2)

    return pose

def pose_sequence(pose_list):
    """
    This function export the pose data into a .mp4 video.

    Parameters:
        :param List[Pose] pose_list: a list of poses to concatenate together
        :param keras2.src.engine.sequential.Sequential model: the binary classifier model

    Returns: 
        None
    """
    
    # p = pose_list
    p = modified_concatenate_poses(pose_list, model)
    # p.body.interpolate(60, kind='cubic')
    scale = p.header.dimensions.width / 256
    p.header.dimensions.width = int(p.header.dimensions.width / scale)
    p.header.dimensions.height = int(p.header.dimensions.height / scale)
    p.body.data = p.body.data / scale

    # Genearate .gif
    v = PoseVisualizer(p)
    
    v.save_video("quick_test.mp4", v.draw())