import numpy as np
import pandas as pd
from pose_format import Pose
from spoken_to_signed.gloss_to_pose.concatenate import concatenate_poses, reduce_holistic, normalize_pose

columns = ["LEFT_ELBOW_x", "LEFT_ELBOW_y", "LEFT_ELBOW_z", 
          "RIGHT_ELBOW_x", "RIGHT_ELBOW_y", "RIGHT_ELBOW_z",
          "LEFT_WRIST_x", "LEFT_WRIST_y", "LEFT_WRIST_z",
          "RIGHT_WRIST_x", "RIGHT_WRIST_y", "RIGHT_WRIST_z",
          "LEFT_THUMB_CMC_x", "LEFT_THUMB_CMC_y", "LEFT_THUMB_CMC_z",
          "LEFT_THUMB_MCP_x", "LEFT_THUMB_MCP_y", "LEFT_THUMB_MCP_z",
          "LEFT_INDEX_FINGER_MCP_x", "LEFT_INDEX_FINGER_MCP_y", "LEFT_INDEX_FINGER_MCP_z",
          "LEFT_INDEX_FINGER_PIP_x", "LEFT_INDEX_FINGER_PIP_y", "LEFT_INDEX_FINGER_PIP_z",
          "LEFT_INDEX_FINGER_DIP_x", "LEFT_INDEX_FINGER_DIP_y", "LEFT_INDEX_FINGER_DIP_z",
          "LEFT_INDEX_FINGER_TIP_x", "LEFT_INDEX_FINGER_TIP_y", "LEFT_INDEX_FINGER_TIP_z",
          "LEFT_MIDDLE_FINGER_MCP_x", "LEFT_MIDDLE_FINGER_MCP_y", "LEFT_MIDDLE_FINGER_MCP_z",
          "LEFT_MIDDLE_FINGER_PIP_x", "LEFT_MIDDLE_FINGER_PIP_y", "LEFT_MIDDLE_FINGER_PIP_z",
          "LEFT_MIDDLE_FINGER_DIP_x", "LEFT_MIDDLE_FINGER_DIP_y", "LEFT_MIDDLE_FINGER_DIP_z",
          "LEFT_MIDDLE_FINGER_TIP_x", "LEFT_MIDDLE_FINGER_TIP_y", "LEFT_MIDDLE_FINGER_TIP_z",
          "LEFT_RING_FINGER_MCP_x", "LEFT_RING_FINGER_MCP_y", "LEFT_RING_FINGER_MCP_z",
          "LEFT_RING_FINGER_PIP_x", "LEFT_RING_FINGER_PIP_y", "LEFT_RING_FINGER_PIP_z",
          "LEFT_RING_FINGER_DIP_x", "LEFT_RING_FINGER_DIP_y", "LEFT_RING_FINGER_DIP_z",
          "LEFT_RING_FINGER_TIP_x", "LEFT_RING_FINGER_TIP_y", "LEFT_RING_FINGER_TIP_z",
          "LEFT_PINKY_MCP_x", "LEFT_PINKY_MCP_y", "LEFT_PINKY_MCP_z",
          "LEFT_PINKY_PIP_x", "LEFT_PINKY_PIP_y", "LEFT_PINKY_PIP_z",
          "LEFT_PINKY_DIP_x", "LEFT_PINKY_DIP_y", "LEFT_PINKY_DIP_z",
          "LEFT_PINKY_TIP_x", "LEFT_PINKY_TIP_y", "LEFT_PINKY_TIP_z",
          "RIGHT_THUMB_CMC_x", "RIGHT_THUMB_CMC_y", "RIGHT_THUMB_CMC_z",
          "RIGHT_THUMB_MCP_x", "RIGHT_THUMB_MCP_y", "RIGHT_THUMB_MCP_z",
          "RIGHT_INDEX_FINGER_MCP_x", "RIGHT_INDEX_FINGER_MCP_y", "RIGHT_INDEX_FINGER_MCP_z",
          "RIGHT_INDEX_FINGER_PIP_x", "RIGHT_INDEX_FINGER_PIP_y", "RIGHT_INDEX_FINGER_PIP_z",
          "RIGHT_INDEX_FINGER_DIP_x", "RIGHT_INDEX_FINGER_DIP_y", "RIGHT_INDEX_FINGER_DIP_z",
          "RIGHT_INDEX_FINGER_TIP_x", "RIGHT_INDEX_FINGER_TIP_y", "RIGHT_INDEX_FINGER_TIP_z",
          "RIGHT_MIDDLE_FINGER_MCP_x", "RIGHT_MIDDLE_FINGER_MCP_y", "RIGHT_MIDDLE_FINGER_MCP_z",
          "RIGHT_MIDDLE_FINGER_PIP_x", "RIGHT_MIDDLE_FINGER_PIP_y", "RIGHT_MIDDLE_FINGER_PIP_z",
          "RIGHT_MIDDLE_FINGER_DIP_x", "RIGHT_MIDDLE_FINGER_DIP_y", "RIGHT_MIDDLE_FINGER_DIP_z",
          "RIGHT_MIDDLE_FINGER_TIP_x", "RIGHT_MIDDLE_FINGER_TIP_y", "RIGHT_MIDDLE_FINGER_TIP_z",
          "RIGHT_RING_FINGER_MCP_x", "RIGHT_RING_FINGER_MCP_y", "RIGHT_RING_FINGER_MCP_z",
          "RIGHT_RING_FINGER_PIP_x", "RIGHT_RING_FINGER_PIP_y", "RIGHT_RING_FINGER_PIP_z",
          "RIGHT_RING_FINGER_DIP_x", "RIGHT_RING_FINGER_DIP_y", "RIGHT_RING_FINGER_DIP_z",
          "RIGHT_RING_FINGER_TIP_x", "RIGHT_RING_FINGER_TIP_y", "RIGHT_RING_FINGER_TIP_z",
          "RIGHT_PINKY_MCP_x", "RIGHT_PINKY_MCP_y", "RIGHT_PINKY_MCP_z",
          "RIGHT_PINKY_PIP_x", "RIGHT_PINKY_PIP_y", "RIGHT_PINKY_PIP_z",
          "RIGHT_PINKY_DIP_x", "RIGHT_PINKY_DIP_y", "RIGHT_PINKY_DIP_z",
          "RIGHT_PINKY_TIP_x", "RIGHT_PINKY_TIP_y", "RIGHT_PINKY_TIP_z"]

def list_components(pose: Pose, normalize: False):

  if normalize == True:
    print('Reducing poses...')
    pose = reduce_holistic(pose)
  
    print('Normalizing poses...')
    pose = normalize_pose(pose)
    
  left_elbow_index = pose.header._get_point_index('POSE_LANDMARKS', f'LEFT_ELBOW')
  right_elbow_index = pose.header._get_point_index('POSE_LANDMARKS', f'RIGHT_ELBOW')
  left_wrist_index = pose.header._get_point_index('POSE_LANDMARKS', f'LEFT_WRIST')
  right_wrist_index = pose.header._get_point_index('POSE_LANDMARKS', f'RIGHT_WRIST')  

  left_elbow = pose.body.data[:, :, left_elbow_index]
  right_elbow = pose.body.data[:, :, right_elbow_index]
  left_wrist = pose.body.data[:, :, left_wrist_index]
  right_wrist = pose.body.data[:, :, right_wrist_index]

  # Define the landmarks for the remaining fingers
  left_thumb_cmc_index = pose.header._get_point_index('LEFT_HAND_LANDMARKS', 'THUMB_CMC')
  left_thumb_mcp_index = pose.header._get_point_index('LEFT_HAND_LANDMARKS', 'THUMB_MCP')
  
  left_index_finger_mcp_index = pose.header._get_point_index('LEFT_HAND_LANDMARKS', 'INDEX_FINGER_MCP')
  left_index_finger_pip_index = pose.header._get_point_index('LEFT_HAND_LANDMARKS', 'INDEX_FINGER_PIP')
  left_index_finger_dip_index = pose.header._get_point_index('LEFT_HAND_LANDMARKS', 'INDEX_FINGER_DIP')
  left_index_finger_tip_index = pose.header._get_point_index('LEFT_HAND_LANDMARKS', 'INDEX_FINGER_TIP')
  
  left_middle_finger_mcp_index = pose.header._get_point_index('LEFT_HAND_LANDMARKS', 'MIDDLE_FINGER_MCP')
  left_middle_finger_pip_index = pose.header._get_point_index('LEFT_HAND_LANDMARKS', 'MIDDLE_FINGER_PIP')
  left_middle_finger_dip_index = pose.header._get_point_index('LEFT_HAND_LANDMARKS', 'MIDDLE_FINGER_DIP')
  left_middle_finger_tip_index = pose.header._get_point_index('LEFT_HAND_LANDMARKS', 'MIDDLE_FINGER_TIP')
  
  left_ring_finger_mcp_index = pose.header._get_point_index('LEFT_HAND_LANDMARKS', 'RING_FINGER_MCP')
  left_ring_finger_pip_index = pose.header._get_point_index('LEFT_HAND_LANDMARKS', 'RING_FINGER_PIP')
  left_ring_finger_dip_index = pose.header._get_point_index('LEFT_HAND_LANDMARKS', 'RING_FINGER_DIP')
  left_ring_finger_tip_index = pose.header._get_point_index('LEFT_HAND_LANDMARKS', 'RING_FINGER_TIP')
  
  left_pinky_mcp_index = pose.header._get_point_index('LEFT_HAND_LANDMARKS', 'PINKY_MCP')
  left_pinky_pip_index = pose.header._get_point_index('LEFT_HAND_LANDMARKS', 'PINKY_PIP')
  left_pinky_dip_index = pose.header._get_point_index('LEFT_HAND_LANDMARKS', 'PINKY_DIP')
  left_pinky_tip_index = pose.header._get_point_index('LEFT_HAND_LANDMARKS', 'PINKY_TIP')
  
  # Extract the landmarks for the remaining fingers
  left_thumb_cmc = pose.body.data[:, :, left_thumb_cmc_index]
  left_thumb_mcp = pose.body.data[:, :, left_thumb_mcp_index]
  
  left_index_finger_mcp = pose.body.data[:, :, left_index_finger_mcp_index]
  left_index_finger_pip = pose.body.data[:, :, left_index_finger_pip_index]
  left_index_finger_dip = pose.body.data[:, :, left_index_finger_dip_index]
  left_index_finger_tip = pose.body.data[:, :, left_index_finger_tip_index]
  
  left_middle_finger_mcp = pose.body.data[:, :, left_middle_finger_mcp_index]
  left_middle_finger_pip = pose.body.data[:, :, left_middle_finger_pip_index]
  left_middle_finger_dip = pose.body.data[:, :, left_middle_finger_dip_index]
  left_middle_finger_tip = pose.body.data[:, :, left_middle_finger_tip_index]
  
  left_ring_finger_mcp = pose.body.data[:, :, left_ring_finger_mcp_index]
  left_ring_finger_pip = pose.body.data[:, :, left_ring_finger_pip_index]
  left_ring_finger_dip = pose.body.data[:, :, left_ring_finger_dip_index]
  left_ring_finger_tip = pose.body.data[:, :, left_ring_finger_tip_index]
  
  left_pinky_mcp = pose.body.data[:, :, left_pinky_mcp_index]
  left_pinky_pip = pose.body.data[:, :, left_pinky_pip_index]
  left_pinky_dip = pose.body.data[:, :, left_pinky_dip_index]
  left_pinky_tip = pose.body.data[:, :, left_pinky_tip_index]

  # Define the landmarks for the right hand
  right_thumb_cmc_index = pose.header._get_point_index('RIGHT_HAND_LANDMARKS', 'THUMB_CMC')
  right_thumb_mcp_index = pose.header._get_point_index('RIGHT_HAND_LANDMARKS', 'THUMB_MCP')
  
  right_index_finger_mcp_index = pose.header._get_point_index('RIGHT_HAND_LANDMARKS', 'INDEX_FINGER_MCP')
  right_index_finger_pip_index = pose.header._get_point_index('RIGHT_HAND_LANDMARKS', 'INDEX_FINGER_PIP')
  right_index_finger_dip_index = pose.header._get_point_index('RIGHT_HAND_LANDMARKS', 'INDEX_FINGER_DIP')
  right_index_finger_tip_index = pose.header._get_point_index('RIGHT_HAND_LANDMARKS', 'INDEX_FINGER_TIP')
  
  right_middle_finger_mcp_index = pose.header._get_point_index('RIGHT_HAND_LANDMARKS', 'MIDDLE_FINGER_MCP')
  right_middle_finger_pip_index = pose.header._get_point_index('RIGHT_HAND_LANDMARKS', 'MIDDLE_FINGER_PIP')
  right_middle_finger_dip_index = pose.header._get_point_index('RIGHT_HAND_LANDMARKS', 'MIDDLE_FINGER_DIP')
  right_middle_finger_tip_index = pose.header._get_point_index('RIGHT_HAND_LANDMARKS', 'MIDDLE_FINGER_TIP')
  
  right_ring_finger_mcp_index = pose.header._get_point_index('RIGHT_HAND_LANDMARKS', 'RING_FINGER_MCP')
  right_ring_finger_pip_index = pose.header._get_point_index('RIGHT_HAND_LANDMARKS', 'RING_FINGER_PIP')
  right_ring_finger_dip_index = pose.header._get_point_index('RIGHT_HAND_LANDMARKS', 'RING_FINGER_DIP')
  right_ring_finger_tip_index = pose.header._get_point_index('RIGHT_HAND_LANDMARKS', 'RING_FINGER_TIP')
  
  right_pinky_mcp_index = pose.header._get_point_index('RIGHT_HAND_LANDMARKS', 'PINKY_MCP')
  right_pinky_pip_index = pose.header._get_point_index('RIGHT_HAND_LANDMARKS', 'PINKY_PIP')
  right_pinky_dip_index = pose.header._get_point_index('RIGHT_HAND_LANDMARKS', 'PINKY_DIP')
  right_pinky_tip_index = pose.header._get_point_index('RIGHT_HAND_LANDMARKS', 'PINKY_TIP')
  
  # Extract the landmarks for the right hand
  right_thumb_cmc = pose.body.data[:, :, right_thumb_cmc_index]
  right_thumb_mcp = pose.body.data[:, :, right_thumb_mcp_index]
  
  right_index_finger_mcp = pose.body.data[:, :, right_index_finger_mcp_index]
  right_index_finger_pip = pose.body.data[:, :, right_index_finger_pip_index]
  right_index_finger_dip = pose.body.data[:, :, right_index_finger_dip_index]
  right_index_finger_tip = pose.body.data[:, :, right_index_finger_tip_index]
  
  right_middle_finger_mcp = pose.body.data[:, :, right_middle_finger_mcp_index]
  right_middle_finger_pip = pose.body.data[:, :, right_middle_finger_pip_index]
  right_middle_finger_dip = pose.body.data[:, :, right_middle_finger_dip_index]
  right_middle_finger_tip = pose.body.data[:, :, right_middle_finger_tip_index]
  
  right_ring_finger_mcp = pose.body.data[:, :, right_ring_finger_mcp_index]
  right_ring_finger_pip = pose.body.data[:, :, right_ring_finger_pip_index]
  right_ring_finger_dip = pose.body.data[:, :, right_ring_finger_dip_index]
  right_ring_finger_tip = pose.body.data[:, :, right_ring_finger_tip_index]
  
  right_pinky_mcp = pose.body.data[:, :, right_pinky_mcp_index]
  right_pinky_pip = pose.body.data[:, :, right_pinky_pip_index]
  right_pinky_dip = pose.body.data[:, :, right_pinky_dip_index]
  right_pinky_tip = pose.body.data[:, :, right_pinky_tip_index]


  df_ind = 0
  data_list = []
  for x in range(len(pose.body.data)):
    main_components = np.hstack([left_elbow[x][0], right_elbow[x][0], left_wrist[x][0], right_wrist[x][0]])
    
    left_hand_fingers_components = np.hstack([
        left_thumb_cmc[x][0], left_thumb_mcp[x][0],  # Thumb components for left hand
        left_index_finger_mcp[x][0], left_index_finger_pip[x][0], left_index_finger_dip[x][0], left_index_finger_tip[x][0],  # Index finger components for left hand
        left_middle_finger_mcp[x][0], left_middle_finger_pip[x][0], left_middle_finger_dip[x][0], left_middle_finger_tip[x][0],  # Middle finger components for left hand
        left_ring_finger_mcp[x][0], left_ring_finger_pip[x][0], left_ring_finger_dip[x][0], left_ring_finger_tip[x][0],  # Ring finger components for left hand
        left_pinky_mcp[x][0], left_pinky_pip[x][0], left_pinky_dip[x][0], left_pinky_tip[x][0]  # Pinky finger components for left hand
    ])

    right_hand_fingers_components = np.hstack([
        right_thumb_cmc[x][0], right_thumb_mcp[x][0],  # Thumb components for right hand
        right_index_finger_mcp[x][0], right_index_finger_pip[x][0], right_index_finger_dip[x][0], right_index_finger_tip[x][0],  # Index finger components for right hand
        right_middle_finger_mcp[x][0], right_middle_finger_pip[x][0], right_middle_finger_dip[x][0], right_middle_finger_tip[x][0],  # Middle finger components for right hand
        right_ring_finger_mcp[x][0], right_ring_finger_pip[x][0], right_ring_finger_dip[x][0], right_ring_finger_tip[x][0],  # Ring finger components for right hand
        right_pinky_mcp[x][0], right_pinky_pip[x][0], right_pinky_dip[x][0], right_pinky_tip[x][0]  # Pinky finger components for right hand
    ])

    data = np.hstack([main_components, left_hand_fingers_components, right_hand_fingers_components])
    data_list.append(data)
    # print(data)
    # print(f"{x}: L|R elbow: {left_elbow[x][0]}, {right_elbow[x][0]}")
    # print(f"{x}: L|R wrist: {left_wrist[x][0]}, {right_wrist[x][0]}")
    # print("--------")
  df = pd.DataFrame(data_list, columns=columns)
  return df, pose
  # print(right_elbow)
  # print(left_wrist, right_wrist)