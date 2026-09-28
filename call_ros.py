import rospy
import threading
import json
import uuid
import time
from std_msgs.msg import String, Bool
# from amr_robot_msgs.msg import Empty as VacantSpaceMsg

flask_request_pub = None
flask_response_callbacks = {}
vacant_space_pub = None
vacant_space_event = threading.Event()
vacant_space_result = {}


def init_ros_api():
    global flask_request_pub, vacant_space_pub
    flask_request_pub = rospy.Publisher(
        '/flask_request', String, queue_size=10)
    rospy.Subscriber('/flask_response', String, flask_response_callback)
    # vacant_space_pub = rospy.Publisher(
    #     '/empty', String, queue_size=10)
    # rospy.Subscriber('/empty_detect', VacantSpaceMsg,
    #                  vacant_space_response_callback)


def flask_response_callback(msg):
    data = json.loads(msg.data)
    request_id = data.get('request_id')
    if request_id in flask_response_callbacks:
        flask_response_callbacks[request_id](data)


def vacant_space_response_callback(msg):
    vacant_space_result['robot_area'] = msg.robot_area
    vacant_space_result['space'] = msg.empty_area
    vacant_space_result['points'] = [
        {"x": p.x, "y": p.y} for p in msg.robot_area_list
    ]
    vacant_space_event.set()


def call_ros_api(service_type, params={}, timeout=None):
    request_id = str(uuid.uuid4())
    result_container = {}
    event = threading.Event()

    def on_response(data):
        result_container['data'] = data
        event.set()

    flask_response_callbacks[request_id] = on_response

    payload = json.dumps({
        "service_type": service_type,
        "params": params,
        "request_id": request_id
    })
    flask_request_pub.publish(String(data=payload))

    # 完了まで待つ
    event.wait(timeout=None)
    flask_response_callbacks.pop(request_id, None)
    return result_container.get('data')


VACANT_SPACE_POLL_INTERVAL = 0.2  # 空きが見つからなかった場合の再pub間隔（秒）


def call_vacant_space_api(timeout=None):
    start_time = time.time()

    while True:
        vacant_space_event.clear()
        vacant_space_pub.publish(String(data=""))

        wait_timeout = None
        if timeout is not None:
            wait_timeout = timeout - (time.time() - start_time)
            if wait_timeout <= 0:
                return None

        # 1回のpubに対して必ずsubが返ってくるので、まずはその応答を待つ
        if not vacant_space_event.wait(timeout=wait_timeout):
            return None

        # 空きが見つかった（robot_area/empty_areaが-1でない）場合のみ結果を返す
        if (vacant_space_result.get('robot_area') != -1
                and vacant_space_result.get('space') != -1):
            print(vacant_space_result)
            return dict(vacant_space_result)

        if timeout is not None and time.time() - start_time >= timeout:
            return None

        time.sleep(VACANT_SPACE_POLL_INTERVAL)


# def call_vacant_space_api():
#     # TODO: 本物の検知ノードができたら、下のダミーを削除して
#     # 実際にpub/subする処理（call_ros_apiと同じ構造）に差し替える
#     time.sleep(10)
#     return {
#         "space": 1,
#         "points": [
#             {"x": 256, "y": 572},
#             {"x": 297, "y": 577},
#             {"x": 296, "y": 615},
#             {"x": 255, "y": 613},
#         ],
#     }
