import rospy
from flask import Flask, request, jsonify, render_template, send_from_directory
from flask_socketio import SocketIO, emit
from flask_cors import CORS
import threading
import os
import time
from dotenv import load_dotenv
from app_client import main_api_client, api_get, get_route_list
from common import load_json
from call_ros import init_ros_api, call_ros_api


load_dotenv(".env")

app = Flask(__name__)
CORS(app)
socketio = SocketIO(app, cors_allowed_origins="*")

rospy.init_node('flask_node', anonymous=True, disable_signals=True)
threading.Thread(target=rospy.spin, daemon=True).start()
init_ros_api()  # 起動時に初期化

robot_id = os.getenv("ROBOT_ID")

# origin座標（空きスペースとのオフセット計算用）だけはローカルJSONに残す
vacant_routes = load_json('vacant_routes.json')

# --- 起動時にmap_idを取得 ---
map_id_result = main_api_client(robot_id, "get_map_id", {})
map_id = map_id_result.get("map_id") if map_id_result else None
print(f"map_id: {map_id}")

# --- 起動時にルート一覧を取得してキャッシュ ---
# ロボット側に登録済みのルート（waypoints/angle）を name で引けるようにしておく。
# ルートをロボット側で編集/更新した場合は、このFlaskアプリを再起動すれば反映される。
route_list = get_route_list(map_id) if map_id else None
print(f"route_list: {route_list}")

routes_by_name = {r["name"]: r for r in route_list} if route_list else {}


def get_route(name):
    """route_list（起動時にキャッシュ済み）から、名前でルートデータ({name, waypoints, angle})を取り出す。
    見つからない場合は None を返す。"""
    route = routes_by_name.get(name)
    if route is None:
        print(f"[エラー] ルート '{name}' が route_list に見つかりません")
    return route


def route_navigation_post(name, route_name, timeout=30):
    """route_list に登録されているルート名 route_name から route_navigation 用のpostデータを作る。
    見つからない場合は None を返す。"""
    route = get_route(route_name)
    if route is None:
        return None
    return {
        "name": name,
        "angle": float(route["angle"]),
        "waypoints": route["waypoints"],
        "timeout": timeout,
    }


@app.route('/navigation_start', methods=['POST'])
def navigation_start():
    data = request.get_json()
    print(data)
    goalPoint = data.get("goal_point")
    print(goalPoint)

    ###############################
    # 空き検知ルート走行
    route_nav_post = route_navigation_post(goalPoint, f"{goalPoint}_空き検知")
    if route_nav_post is None:
        socketio.emit('navigation_error', {'goal_point': goalPoint})
        return jsonify({'status': "error"})
    # ルート走行と空きスペース検出をロボット側で実行（空きを見つけたら自動停止）
    print(route_nav_post)
    route_empty_result = call_ros_api('route_navigation_empty', route_nav_post)
    print(route_empty_result)
    if route_empty_result and route_empty_result.get("status") != 3:
        socketio.emit('navigation_error', {'goal_point': goalPoint})
        return jsonify({'status': "error"})
    empty_result = route_empty_result["result"]["empty_result"]

    if empty_result["empty_area"] == -1:
        # 空きスペースが見つからなかった
        socketio.emit('navigation_no_space', {'goal_point': goalPoint})
        return jsonify({'status': "no_space"})

    space = str(empty_result["empty_area"])   # 空きスペースの番号
    area_points = empty_result["robot_area_list"]   # 検知場所の座標4点
    dx, dy = calc_offset(goalPoint, area_points)

    # 空きスペースへの進入・退出（荷降ろし）フェーズへ
    socketio.emit('navigation_unloading', {'goal_point': goalPoint})
    ###############################

    ###############################
    # 空きスペースへの進入ルート
    enter_post = build_route_post(space, f"{goalPoint}_進入", dx, dy)
    print(enter_post)
    if enter_post is None:
        socketio.emit('navigation_error', {'goal_point': goalPoint})
        return jsonify({'status': "error"})
    enter_result = call_ros_api('route_navigation', enter_post)
    if enter_result and enter_result.get("status") != 3:
        socketio.emit('navigation_error', {'goal_point': goalPoint})
        return jsonify({'status': "error"})
    ###############################

    ###############################
    # IO ON/OFF
    io_on_post = {
        "type": "output",
        "number": 3,
        "value": "true",
    }
    io_result = main_api_client(robot_id, 'io', io_on_post)

    io_off_post = {
        "type": "output",
        "number": 3,
        "value": "false",
    }
    io_result = main_api_client(robot_id, 'io', io_off_post)

    ###############################

    ###############################
    # 進入完了後、空きスペースからの退出ルート
    exit_post = build_route_post(space, f"{goalPoint}_脱出", dx, dy)
    print(exit_post)
    if exit_post is None:
        socketio.emit('navigation_error', {'goal_point': goalPoint})
        return jsonify({'status': "error"})
    exit_result = call_ros_api('route_navigation', exit_post)
    if exit_result and exit_result.get("status") != 3:
        socketio.emit('navigation_error', {'goal_point': goalPoint})
        return jsonify({'status': "error"})
    ###############################

    ###############################
    # 退出完了後、待機位置へ戻るフェーズへ
    socketio.emit('navigation_returning', {'goal_point': goalPoint})

    # 待機位置へ戻るルート走行
    route_nav_back_post = route_navigation_post(goalPoint, f"{goalPoint}_帰還")
    if route_nav_back_post is None:
        socketio.emit('navigation_error', {'goal_point': goalPoint})
        return jsonify({'status': "error"})
    back_result = call_ros_api('route_navigation', route_nav_back_post)
    if back_result and back_result.get("status") != 3:
        socketio.emit('navigation_error', {'goal_point': goalPoint})
        return jsonify({'status': "error"})
    ###############################

    # 待機位置への走行完了をフロントへ通知し、最初の選択画面に戻す
    socketio.emit('navigation_done', {'goal_point': goalPoint})
    ###############################

    return jsonify({'status': "success"})


def calc_offset(goalPoint, area_points):
    # 登録されたルートのorigin座標4点
    old_origin_points = vacant_routes[goalPoint]["origin"]
    old_origin = calc_center(old_origin_points)
    new_origin = calc_center(area_points)
    return new_origin["x"] - old_origin["x"], new_origin["y"] - old_origin["y"]


def build_route_post(space, route_name, dx, dy):
    """route_list に登録されているルート route_name を (dx, dy) だけずらした route_navigation 用のpostデータを作る。
    見つからない場合は None を返す。"""
    route_data = get_route(route_name)
    if route_data is None:
        return None
    moved_waypoints = [
        {"x": int(p["x"] + dx), "y": int(p["y"] + dy)}
        for p in route_data["waypoints"]
    ]
    return {
        "name": space,
        "angle": float(route_data["angle"]),
        "waypoints": moved_waypoints,
        "timeout": 30,
    }


def calc_center(points):
    """pointsの中心（頂点の平均）を返す"""
    n = len(points)
    return {
        "x": sum(p["x"] for p in points) / n,
        "y": sum(p["y"] for p in points) / n,
    }


@app.route('/')
def index():
    return render_template('index.html')


if __name__ == '__main__':
    app.run(host='0.0.0.0', port="5050")
