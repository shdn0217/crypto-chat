import os
from datetime import datetime
from flask import Flask, send_from_directory, request
from flask_socketio import SocketIO, join_room, leave_room, emit


app = Flask(__name__, static_folder="static", static_url_path="/static")
# CORS allowed for local demo; for production, restrict as needed
socketio = SocketIO(app, cors_allowed_origins="*")

# 房间管理：记录每个房间的成员 socket ID 集合
# 格式: {room_id: {socket_id1, socket_id2, ...}}
room_members = {}
MAX_ROOM_SIZE = 2  # 每个房间最多2人


@app.route("/")
def index():
    return send_from_directory("static", "index.html")


@socketio.on("join_room")
def handle_join(data):
    room_id = (data or {}).get("roomId")
    nickname = (data or {}).get("nickname")
    if not room_id:
        emit("join_error", {
            "code": "INVALID_ROOM_ID",
            "message": "房间ID无效"
        })
        return
    
    # 获取当前连接的 socket ID
    socket_id = request.sid
    
    # 检查房间是否已满
    current_members = room_members.get(room_id, set())
    if len(current_members) >= MAX_ROOM_SIZE:
        emit("join_error", {
            "code": "ROOM_FULL",
            "message": f"房间已满（最多 {MAX_ROOM_SIZE} 人）",
            "roomId": room_id,
            "currentSize": len(current_members),
            "maxSize": MAX_ROOM_SIZE
        })
        return
    
    # 加入房间
    join_room(room_id)
    
    # 记录成员
    if room_id not in room_members:
        room_members[room_id] = set()
    room_members[room_id].add(socket_id)
    
    # 通知其他成员
    emit(
        "system",
        {
            "type": "join",
            "roomId": room_id,
            "nickname": nickname or "匿名",
            "timestamp": datetime.utcnow().isoformat() + "Z",
        },
        room=room_id,
        include_self=False,
    )
    
    # 通知自己加入成功
    emit("join_success", {
        "roomId": room_id,
        "nickname": nickname or "匿名",
        "currentSize": len(room_members[room_id]),
        "maxSize": MAX_ROOM_SIZE
    })


@socketio.on("leave_room")
def handle_leave(data):
    room_id = (data or {}).get("roomId")
    nickname = (data or {}).get("nickname")
    if not room_id:
        return
    
    socket_id = request.sid
    leave_room(room_id)
    
    # 从房间成员中移除
    if room_id in room_members:
        room_members[room_id].discard(socket_id)
        # 如果房间为空，清理记录
        if len(room_members[room_id]) == 0:
            del room_members[room_id]
    
    emit(
        "system",
        {
            "type": "leave",
            "roomId": room_id,
            "nickname": nickname or "匿名",
            "timestamp": datetime.utcnow().isoformat() + "Z",
        },
        room=room_id,
        include_self=False,
    )


@socketio.on("chat_message")
def handle_chat_message(data):
    # Server仅转发，不解密、不检查内容
    room_id = (data or {}).get("roomId")
    if not room_id:
        return
    emit("chat_message", data, room=room_id, include_self=False)


@socketio.on("connect")
def handle_connect():
    # 可选：记录连接元数据（不记录消息内容）
    pass


@socketio.on("disconnect")
def handle_disconnect():
    # 清理断开连接的 socket 在所有房间中的记录
    socket_id = request.sid
    rooms_to_clean = []
    for room_id, members in room_members.items():
        if socket_id in members:
            members.discard(socket_id)
            if len(members) == 0:
                rooms_to_clean.append(room_id)
    for room_id in rooms_to_clean:
        del room_members[room_id]


def main():
    port = int(os.environ.get("PORT", "5000"))
    # eventlet用于WebSocket支持
    socketio.run(app, host="0.0.0.0", port=port)


if __name__ == "__main__":
    main()



